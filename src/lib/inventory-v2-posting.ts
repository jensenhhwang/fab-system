import { createHash, randomUUID } from "crypto";
import type { ClientSession, Collection, MongoClient } from "mongodb";
import { collections, getMongoClient } from "@/lib/db";
import {
  INVENTORY_V2_SCHEMA_VERSION,
  convertToBaseMinorUnits,
  inventoryBalanceKey,
  validateInventoryMovementV2,
  type InventoryBalanceV2Doc,
  type InventoryDimensionV2,
  type InventoryMovementLineV2,
  type InventoryMovementTypeV2,
  type InventoryMovementV2Doc,
  type MaterialUomLockV2Doc,
  type MaterialUomRuleV2Doc,
  type UomConversionV2,
} from "@/lib/inventory-v2-contract";

export const MAX_INVENTORY_POSTING_LINES = 100;
export const INVENTORY_REQUEST_HASH_VERSION = 1 as const;

export const SUPPORTED_INVENTORY_POSTING_TYPES = [
  "RECEIPT",
  "QUALITY_CHANGE",
  "RESERVE",
  "RELEASE_RESERVATION",
  "ALLOCATE",
  "DEALLOCATE",
] as const satisfies readonly InventoryMovementTypeV2[];

export type SupportedInventoryPostingType = typeof SUPPORTED_INVENTORY_POSTING_TYPES[number];

export type InventoryPostingErrorCode =
  | "INVALID_COMMAND"
  | "UNSUPPORTED_MOVEMENT_TYPE"
  | "TRANSITION_NOT_ALLOWED"
  | "UOM_RULE_NOT_FOUND"
  | "UOM_CONVERSION_NOT_FOUND"
  | "UOM_RULE_AMBIGUOUS"
  | "UOM_PROFILE_LOCKED"
  | "IDEMPOTENCY_CONFLICT"
  | "INSUFFICIENT_BALANCE"
  | "BALANCE_OVERFLOW"
  | "BALANCE_UOM_MISMATCH"
  | "BALANCE_CONFLICT"
  | "TRANSACTION_UNAVAILABLE"
  | "INTERNAL_INVARIANT_VIOLATION";

export class InventoryPostingError extends Error {
  constructor(
    readonly code: InventoryPostingErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "InventoryPostingError";
  }
}

export function inventoryPostingHttpStatus(code: InventoryPostingErrorCode): number {
  if (code === "INVALID_COMMAND") return 400;
  if (
    code === "UNSUPPORTED_MOVEMENT_TYPE"
    || code === "TRANSITION_NOT_ALLOWED"
    || code === "UOM_RULE_NOT_FOUND"
    || code === "UOM_CONVERSION_NOT_FOUND"
  ) return 422;
  if (code === "TRANSACTION_UNAVAILABLE") return 503;
  if (code === "INTERNAL_INVARIANT_VIOLATION") return 500;
  return 409;
}

export interface PostInventoryCommandLine {
  quantity: string;
  sourceUom: string;
  from?: InventoryDimensionV2 | null;
  to?: InventoryDimensionV2 | null;
}

export interface PostInventoryCommand {
  requestId: string;
  type: InventoryMovementTypeV2;
  lines: PostInventoryCommandLine[];
  reasonCode: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  occurredAt: Date;
}

export interface InventoryPostingContext {
  actorId: string;
}

export interface InventoryPostingResult {
  movement: InventoryMovementV2Doc;
  duplicate: boolean;
}

export interface InventoryV2PostingCollections {
  inventoryBalancesV2: Collection<InventoryBalanceV2Doc>;
  inventoryMovementsV2: Collection<InventoryMovementV2Doc>;
  materialUomLocksV2: Collection<MaterialUomLockV2Doc>;
  materialUomRulesV2: Collection<MaterialUomRuleV2Doc>;
}

export interface InventoryPostingDependencies {
  client: MongoClient;
  store: InventoryV2PostingCollections;
  now?: () => Date;
  newId?: () => string;
}

export interface BalanceMutationPlanV2 {
  key: string;
  dimension: InventoryDimensionV2;
  baseUom: string;
  uomScale: number;
  totalDebitMinor: number;
  totalCreditMinor: number;
}

const SUPPORTED_SET = new Set<InventoryMovementTypeV2>(SUPPORTED_INVENTORY_POSTING_TYPES);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new InventoryPostingError("INVALID_COMMAND", `${field} is required`);
  return normalized;
}

export function normalizeDecimalQuantity(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new InventoryPostingError("INVALID_COMMAND", "quantity must be a non-negative plain decimal string");
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  const normalized = fraction ? `${whole}.${fraction}` : whole;
  if (normalized === "0") throw new InventoryPostingError("INVALID_COMMAND", "quantity must be greater than zero");
  return normalized;
}

function dimensionChanges(from: InventoryDimensionV2, to: InventoryDimensionV2): string[] {
  const fields = [
    "materialId",
    "siteId",
    "facilityId",
    "warehouseId",
    "zoneId",
    "locationId",
    "lotId",
    "handlingUnitId",
    "qualityStatus",
    "logisticsStatus",
    "commitmentStatus",
  ] as const;
  return fields.filter((field) => (from[field] ?? null) !== (to[field] ?? null));
}

function requireOnlyChange(
  from: InventoryDimensionV2,
  to: InventoryDimensionV2,
  field: keyof InventoryDimensionV2,
  type: InventoryMovementTypeV2,
): void {
  const changes = dimensionChanges(from, to);
  if (changes.length !== 1 || changes[0] !== field) {
    throw new InventoryPostingError(
      "TRANSITION_NOT_ALLOWED",
      `${type} must only change ${field}`,
      { changes },
    );
  }
}

export function assertPostingTransition(
  type: InventoryMovementTypeV2,
  line: Pick<PostInventoryCommandLine, "from" | "to">,
): void {
  const from = line.from ?? null;
  const to = line.to ?? null;
  if (type === "RECEIPT") {
    if (
      from
      || !to
      || to.qualityStatus !== "INSPECTION_PENDING"
      || to.logisticsStatus !== "STORED"
      || to.commitmentStatus !== "FREE"
    ) {
      throw new InventoryPostingError(
        "TRANSITION_NOT_ALLOWED",
        "RECEIPT requires only an INSPECTION_PENDING/STORED/FREE destination",
      );
    }
    return;
  }
  if (!from || !to) {
    throw new InventoryPostingError("TRANSITION_NOT_ALLOWED", `${type} requires from and to balances`);
  }
  if (type === "QUALITY_CHANGE") {
    requireOnlyChange(from, to, "qualityStatus", type);
    if (from.commitmentStatus !== "FREE" || to.commitmentStatus !== "FREE") {
      throw new InventoryPostingError("TRANSITION_NOT_ALLOWED", "QUALITY_CHANGE requires FREE stock");
    }
    return;
  }
  requireOnlyChange(from, to, "commitmentStatus", type);
  const expected: Record<Exclude<SupportedInventoryPostingType, "RECEIPT" | "QUALITY_CHANGE">, readonly [string, string]> = {
    RESERVE: ["FREE", "RESERVED"],
    RELEASE_RESERVATION: ["RESERVED", "FREE"],
    ALLOCATE: ["RESERVED", "ALLOCATED"],
    DEALLOCATE: ["ALLOCATED", "RESERVED"],
  };
  const transition = expected[type as keyof typeof expected];
  if (!transition || from.commitmentStatus !== transition[0] || to.commitmentStatus !== transition[1]) {
    throw new InventoryPostingError(
      "TRANSITION_NOT_ALLOWED",
      `${type} does not allow ${from.commitmentStatus} -> ${to.commitmentStatus}`,
    );
  }
}

function activeAt(
  item: { validFrom?: Date | null; validTo?: Date | null },
  occurredAt: Date,
): boolean {
  return (!item.validFrom || item.validFrom <= occurredAt)
    && (!item.validTo || occurredAt < item.validTo);
}

function activeRuleAt(rule: MaterialUomRuleV2Doc, occurredAt: Date): boolean {
  return rule.effectiveFrom <= occurredAt && (!rule.effectiveTo || occurredAt < rule.effectiveTo);
}

function lineMaterialId(line: PostInventoryCommandLine): string {
  const fromMaterialId = line.from?.materialId;
  const toMaterialId = line.to?.materialId;
  if (fromMaterialId && toMaterialId && fromMaterialId !== toMaterialId) {
    throw new InventoryPostingError("TRANSITION_NOT_ALLOWED", "materialId cannot change");
  }
  const materialId = fromMaterialId ?? toMaterialId;
  if (!materialId) throw new InventoryPostingError("INVALID_COMMAND", "line requires from or to");
  return materialId;
}

function resolveRule(
  rules: readonly MaterialUomRuleV2Doc[],
  materialId: string,
  occurredAt: Date,
): MaterialUomRuleV2Doc {
  const active = rules.filter((rule) => rule.materialId === materialId && activeRuleAt(rule, occurredAt));
  if (!active.length) {
    throw new InventoryPostingError("UOM_RULE_NOT_FOUND", `No active UOM rule for ${materialId}`);
  }
  if (active.length !== 1) {
    throw new InventoryPostingError("UOM_RULE_AMBIGUOUS", `Multiple active UOM rules for ${materialId}`);
  }
  if (!active[0].approvedBy?.trim() || !(active[0].approvedAt instanceof Date) || active[0].approvedAt > occurredAt) {
    throw new InventoryPostingError("UOM_RULE_NOT_FOUND", `UOM rule for ${materialId} is not approved at occurredAt`);
  }
  return active[0];
}

function resolveConversion(
  rule: MaterialUomRuleV2Doc,
  sourceUom: string,
  occurredAt: Date,
): Pick<UomConversionV2, "numerator" | "denominator"> {
  if (sourceUom === rule.baseUom) return { numerator: 1, denominator: 1 };
  const active = rule.conversions.filter((conversion) => (
    conversion.sourceUom === sourceUom && activeAt(conversion, occurredAt)
  ));
  if (!active.length) {
    throw new InventoryPostingError(
      "UOM_CONVERSION_NOT_FOUND",
      `No active ${sourceUom} -> ${rule.baseUom} conversion for ${rule.materialId}`,
    );
  }
  if (active.length !== 1) {
    throw new InventoryPostingError(
      "UOM_RULE_AMBIGUOUS",
      `Multiple active ${sourceUom} conversions for ${rule.materialId}`,
    );
  }
  return active[0];
}

function requestHash(
  command: PostInventoryCommand,
  actorId: string,
  lines: readonly InventoryMovementLineV2[],
): string {
  const normalizedLines = lines.map((line) => ({
    sourceQuantity: line.sourceQuantity,
    sourceUom: line.sourceUom,
    quantityMinor: line.quantityMinor,
    baseUom: line.baseUom,
    uomScale: line.uomScale,
    uomRuleId: line.uomRuleId,
    conversionNumerator: line.conversionNumerator,
    conversionDenominator: line.conversionDenominator,
    from: line.from ? inventoryBalanceKey(line.from) : null,
    to: line.to ? inventoryBalanceKey(line.to) : null,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: INVENTORY_V2_SCHEMA_VERSION,
    hashVersion: INVENTORY_REQUEST_HASH_VERSION,
    requestId: command.requestId.trim(),
    type: command.type,
    actorId,
    occurredAt: command.occurredAt.toISOString(),
    reasonCode: command.reasonCode.trim(),
    sourceDocumentType: command.sourceDocumentType.trim(),
    sourceDocumentId: command.sourceDocumentId.trim(),
    lines: normalizedLines,
  })).digest("hex");
}

function assertCommand(command: PostInventoryCommand, actorId: string): void {
  required(command.requestId, "requestId");
  required(command.reasonCode, "reasonCode");
  required(command.sourceDocumentType, "sourceDocumentType");
  required(command.sourceDocumentId, "sourceDocumentId");
  required(actorId, "actorId");
  if (!(command.occurredAt instanceof Date) || Number.isNaN(command.occurredAt.getTime())) {
    throw new InventoryPostingError("INVALID_COMMAND", "occurredAt must be a valid Date");
  }
  if (!SUPPORTED_SET.has(command.type)) {
    throw new InventoryPostingError("UNSUPPORTED_MOVEMENT_TYPE", `${command.type} is not enabled in the first V2 slice`);
  }
  if (!Array.isArray(command.lines) || !command.lines.length || command.lines.length > MAX_INVENTORY_POSTING_LINES) {
    throw new InventoryPostingError(
      "INVALID_COMMAND",
      `lines must contain between 1 and ${MAX_INVENTORY_POSTING_LINES} entries`,
    );
  }
}

export function prepareInventoryMovementV2(
  command: PostInventoryCommand,
  context: InventoryPostingContext,
  rules: readonly MaterialUomRuleV2Doc[],
  server: { movementId: string; recordedAt: Date },
): InventoryMovementV2Doc {
  const actorId = required(context.actorId, "actorId");
  assertCommand(command, actorId);
  const lines = command.lines.map((input, index): InventoryMovementLineV2 => {
    assertPostingTransition(command.type, input);
    const materialId = lineMaterialId(input);
    const sourceQuantity = normalizeDecimalQuantity(input.quantity);
    const sourceUom = required(input.sourceUom, `lines[${index}].sourceUom`);
    const rule = resolveRule(rules, materialId, command.occurredAt);
    const conversion = resolveConversion(rule, sourceUom, command.occurredAt);
    const quantityMinor = convertToBaseMinorUnits(sourceQuantity, rule, conversion);
    if (quantityMinor <= 0) {
      throw new InventoryPostingError("INVALID_COMMAND", "quantity rounds to zero in the base UOM");
    }
    return {
      lineNo: index + 1,
      sourceQuantity,
      sourceUom,
      quantityMinor,
      baseUom: rule.baseUom,
      uomScale: rule.quantityScale,
      uomRuleId: rule._id,
      conversionNumerator: conversion.numerator,
      conversionDenominator: conversion.denominator,
      from: input.from,
      to: input.to,
    };
  });
  const movement: InventoryMovementV2Doc = {
    _id: server.movementId,
    schemaVersion: INVENTORY_V2_SCHEMA_VERSION,
    requestId: required(command.requestId, "requestId"),
    requestHash: requestHash(command, actorId, lines),
    hashVersion: INVENTORY_REQUEST_HASH_VERSION,
    type: command.type,
    lines,
    reasonCode: required(command.reasonCode, "reasonCode"),
    sourceDocumentType: required(command.sourceDocumentType, "sourceDocumentType"),
    sourceDocumentId: required(command.sourceDocumentId, "sourceDocumentId"),
    actorId,
    occurredAt: command.occurredAt,
    recordedAt: server.recordedAt,
  };
  const errors = validateInventoryMovementV2(movement);
  if (errors.length) {
    throw new InventoryPostingError("INVALID_COMMAND", "Movement contract validation failed", { errors });
  }
  return movement;
}

export function buildBalanceMutationPlan(
  lines: readonly InventoryMovementLineV2[],
): BalanceMutationPlanV2[] {
  type Accumulator = Omit<BalanceMutationPlanV2, "totalDebitMinor" | "totalCreditMinor"> & {
    totalDebitMinor: bigint;
    totalCreditMinor: bigint;
  };
  const byKey = new Map<string, Accumulator>();
  const add = (
    dimension: InventoryDimensionV2,
    line: InventoryMovementLineV2,
    side: "DEBIT" | "CREDIT",
  ) => {
    const key = inventoryBalanceKey(dimension);
    const current = byKey.get(key) ?? {
      key,
      dimension,
      baseUom: line.baseUom,
      uomScale: line.uomScale,
      totalDebitMinor: BigInt(0),
      totalCreditMinor: BigInt(0),
    };
    if (current.baseUom !== line.baseUom || current.uomScale !== line.uomScale) {
      throw new InventoryPostingError("BALANCE_UOM_MISMATCH", `Multiple UOM profiles target balance ${key}`);
    }
    if (side === "DEBIT") current.totalDebitMinor += BigInt(line.quantityMinor);
    else current.totalCreditMinor += BigInt(line.quantityMinor);
    if (current.totalDebitMinor > MAX_SAFE_BIGINT || current.totalCreditMinor > MAX_SAFE_BIGINT) {
      throw new InventoryPostingError("BALANCE_OVERFLOW", `Balance mutation exceeds safe integer range: ${key}`);
    }
    byKey.set(key, current);
  };
  for (const line of lines) {
    if (line.from) add(line.from, line, "DEBIT");
    if (line.to) add(line.to, line, "CREDIT");
  }
  return [...byKey.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((item) => ({
      ...item,
      totalDebitMinor: Number(item.totalDebitMinor),
      totalCreditMinor: Number(item.totalCreditMinor),
    }));
}

async function activeRulesFor(
  store: InventoryV2PostingCollections,
  materialIds: readonly string[],
  occurredAt: Date,
  session: ClientSession,
): Promise<MaterialUomRuleV2Doc[]> {
  return store.materialUomRulesV2.find({
    materialId: { $in: [...materialIds] },
    effectiveFrom: { $lte: occurredAt },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $exists: false } },
      { effectiveTo: { $gt: occurredAt } },
    ],
  }, { session }).toArray();
}

async function ensureUomLocks(
  store: InventoryV2PostingCollections,
  movement: InventoryMovementV2Doc,
  session: ClientSession,
): Promise<void> {
  const profiles = new Map<string, { baseUom: string; quantityScale: number }>();
  for (const line of movement.lines) {
    const materialId = (line.from ?? line.to)!.materialId;
    const profile = profiles.get(materialId);
    if (profile && (profile.baseUom !== line.baseUom || profile.quantityScale !== line.uomScale)) {
      throw new InventoryPostingError("UOM_RULE_AMBIGUOUS", `Multiple UOM profiles in movement for ${materialId}`);
    }
    profiles.set(materialId, { baseUom: line.baseUom, quantityScale: line.uomScale });
  }
  for (const [materialId, profile] of [...profiles].sort(([a], [b]) => a.localeCompare(b))) {
    await store.materialUomLocksV2.updateOne(
      { _id: materialId },
      {
        $setOnInsert: {
          schemaVersion: INVENTORY_V2_SCHEMA_VERSION,
          materialId,
          baseUom: profile.baseUom,
          quantityScale: profile.quantityScale,
          firstMovementId: movement._id,
          lockedAt: movement.recordedAt,
        },
      },
      { upsert: true, session },
    );
    const lock = await store.materialUomLocksV2.findOne({ _id: materialId }, { session });
    if (!lock || lock.baseUom !== profile.baseUom || lock.quantityScale !== profile.quantityScale) {
      throw new InventoryPostingError(
        "UOM_PROFILE_LOCKED",
        `UOM profile for ${materialId} is locked`,
        { locked: lock, attempted: profile },
      );
    }
  }
}

async function applyBalancePlan(
  store: InventoryV2PostingCollections,
  plan: readonly BalanceMutationPlanV2[],
  movement: InventoryMovementV2Doc,
  session: ClientSession,
): Promise<void> {
  const currentDocs = await store.inventoryBalancesV2.find(
    { _id: { $in: plan.map((item) => item.key) } },
    { session },
  ).toArray();
  const currentByKey = new Map(currentDocs.map((doc) => [doc._id, doc]));
  const nextByKey = new Map<string, number>();
  for (const item of plan) {
    const current = currentByKey.get(item.key);
    if (current && (current.baseUom !== item.baseUom || current.uomScale !== item.uomScale)) {
      throw new InventoryPostingError("BALANCE_UOM_MISMATCH", `Balance UOM profile mismatch: ${item.key}`);
    }
    const currentQuantity = current?.quantityMinor ?? 0;
    if (currentQuantity < item.totalDebitMinor) {
      throw new InventoryPostingError(
        "INSUFFICIENT_BALANCE",
        `Insufficient balance: ${item.key}`,
        { currentQuantity, required: item.totalDebitMinor },
      );
    }
    const next = BigInt(currentQuantity) - BigInt(item.totalDebitMinor) + BigInt(item.totalCreditMinor);
    if (next < BigInt(0) || next > MAX_SAFE_BIGINT) {
      throw new InventoryPostingError("BALANCE_OVERFLOW", `Balance result exceeds safe integer range: ${item.key}`);
    }
    nextByKey.set(item.key, Number(next));
  }

  for (const item of plan) {
    const current = currentByKey.get(item.key);
    const quantityMinor = nextByKey.get(item.key)!;
    if (!current) {
      await store.inventoryBalancesV2.insertOne({
        _id: item.key,
        schemaVersion: INVENTORY_V2_SCHEMA_VERSION,
        ...item.dimension,
        quantityMinor,
        baseUom: item.baseUom,
        uomScale: item.uomScale,
        version: 1,
        lastMovementId: movement._id,
        updatedAt: movement.recordedAt,
      }, { session });
      continue;
    }
    const result = await store.inventoryBalancesV2.updateOne(
      { _id: item.key, version: current.version, quantityMinor: current.quantityMinor },
      {
        $set: {
          quantityMinor,
          lastMovementId: movement._id,
          updatedAt: movement.recordedAt,
        },
        $inc: { version: 1 },
      },
      { session },
    );
    if (!result.modifiedCount) {
      throw new InventoryPostingError("BALANCE_CONFLICT", `Balance changed concurrently: ${item.key}`);
    }
  }
}

function isRequestIdDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 11000) return false;
  const duplicate = error as { keyPattern?: Record<string, number>; message?: string };
  return duplicate.keyPattern?.requestId === 1
    || duplicate.message?.includes("INV_V2_MOVEMENT_REQUEST_ID_UQ") === true;
}

function isTransactionUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: number; codeName?: string; message?: string };
  return candidate.code === 20
    || candidate.codeName === "IllegalOperation"
    || candidate.message?.includes("Transaction numbers are only allowed") === true;
}

async function defaultDependencies(): Promise<InventoryPostingDependencies> {
  const [client, dbCollections] = await Promise.all([getMongoClient(), collections()]);
  return {
    client,
    store: {
      inventoryBalancesV2: dbCollections.inventoryBalancesV2,
      inventoryMovementsV2: dbCollections.inventoryMovementsV2,
      materialUomLocksV2: dbCollections.materialUomLocksV2,
      materialUomRulesV2: dbCollections.materialUomRulesV2,
    },
  };
}

export async function postInventoryV2(
  command: PostInventoryCommand,
  context: InventoryPostingContext,
  providedDependencies?: InventoryPostingDependencies,
): Promise<InventoryPostingResult> {
  const dependencies = providedDependencies ?? await defaultDependencies();
  assertCommand(command, context.actorId);
  const movementId = (dependencies.newId ?? randomUUID)();
  const recordedAt = (dependencies.now ?? (() => new Date()))();
  const materialIds = [...new Set(command.lines.map(lineMaterialId))].sort();
  const attempt: { movement?: InventoryMovementV2Doc } = {};
  const session = dependencies.client.startSession();
  try {
    const result = await session.withTransaction(async (): Promise<InventoryPostingResult> => {
      const rules = await activeRulesFor(
        dependencies.store,
        materialIds,
        command.occurredAt,
        session,
      );
      const movement = prepareInventoryMovementV2(command, context, rules, { movementId, recordedAt });
      attempt.movement = movement;
      const existing = await dependencies.store.inventoryMovementsV2.findOne(
        { requestId: movement.requestId },
        { session },
      );
      if (existing) {
        if (existing.requestHash !== movement.requestHash) {
          throw new InventoryPostingError(
            "IDEMPOTENCY_CONFLICT",
            `requestId ${movement.requestId} was already used for a different command`,
          );
        }
        return { movement: existing, duplicate: true };
      }

      const plan = buildBalanceMutationPlan(movement.lines);
      await ensureUomLocks(dependencies.store, movement, session);
      await dependencies.store.inventoryMovementsV2.insertOne(movement, { session });
      await applyBalancePlan(dependencies.store, plan, movement, session);
      return { movement, duplicate: false };
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
    if (!result) {
      throw new InventoryPostingError("INTERNAL_INVARIANT_VIOLATION", "Transaction returned no result");
    }
    return result;
  } catch (error) {
    const attemptedMovement = attempt.movement;
    if (isRequestIdDuplicate(error) && attemptedMovement) {
      const existing = await dependencies.store.inventoryMovementsV2.findOne({
        requestId: attemptedMovement.requestId,
      });
      if (existing && existing.requestHash === attemptedMovement.requestHash) {
        return { movement: existing, duplicate: true };
      }
      if (existing) {
        throw new InventoryPostingError(
          "IDEMPOTENCY_CONFLICT",
          `requestId ${attemptedMovement.requestId} was already used for a different command`,
        );
      }
    }
    if (isTransactionUnavailable(error)) {
      throw new InventoryPostingError(
        "TRANSACTION_UNAVAILABLE",
        "MongoDB replica-set transactions are required for inventory V2 posting",
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
