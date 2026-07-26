import type { Collection, Document, IndexDescription, IndexDescriptionInfo } from "mongodb";
import type {
  InventoryBalanceV2Doc,
  InventoryMovementV2Doc,
  MaterialUomRuleV2Doc,
} from "@/lib/inventory-v2-contract";

export interface InventoryV2IndexCollections {
  inventoryBalancesV2: Collection<InventoryBalanceV2Doc>;
  inventoryMovementsV2: Collection<InventoryMovementV2Doc>;
  materialUomRulesV2: Collection<MaterialUomRuleV2Doc>;
}

export interface InventoryV2IndexInstallResult {
  created: string[];
  existing: string[];
  planned: string[];
}

type NamedIndex = IndexDescription & { name: string };

const MOVEMENT_INDEXES: readonly NamedIndex[] = [
  {
    name: "INV_V2_MOVEMENT_REQUEST_ID_UQ",
    key: { requestId: 1 },
    unique: true,
  },
  {
    name: "INV_V2_MOVEMENT_REVERSAL_UQ",
    key: { reversalOfMovementId: 1 },
    unique: true,
    partialFilterExpression: {
      type: "REVERSAL",
      reversalOfMovementId: { $type: "string" },
    },
  },
  {
    name: "INV_V2_MOVEMENT_SOURCE_OCCURRED",
    key: { sourceDocumentType: 1, sourceDocumentId: 1, occurredAt: -1 },
  },
  {
    name: "INV_V2_MOVEMENT_FROM_LOT",
    key: { "lines.from.lotId": 1, occurredAt: -1 },
  },
  {
    name: "INV_V2_MOVEMENT_TO_LOT",
    key: { "lines.to.lotId": 1, occurredAt: -1 },
  },
  {
    name: "INV_V2_MOVEMENT_FROM_HU",
    key: { "lines.from.handlingUnitId": 1, occurredAt: -1 },
  },
  {
    name: "INV_V2_MOVEMENT_TO_HU",
    key: { "lines.to.handlingUnitId": 1, occurredAt: -1 },
  },
];

const BALANCE_INDEXES: readonly NamedIndex[] = [
  {
    name: "INV_V2_BALANCE_OPERATIONAL",
    key: {
      materialId: 1,
      siteId: 1,
      facilityId: 1,
      locationId: 1,
      qualityStatus: 1,
      logisticsStatus: 1,
      commitmentStatus: 1,
    },
  },
  {
    name: "INV_V2_BALANCE_LOT",
    key: { materialId: 1, lotId: 1, quantityMinor: 1 },
  },
  {
    name: "INV_V2_BALANCE_HU",
    key: { handlingUnitId: 1, quantityMinor: 1 },
  },
];

const UOM_INDEXES: readonly NamedIndex[] = [
  {
    name: "INV_V2_UOM_MATERIAL_EFFECTIVE_UQ",
    key: { materialId: 1, effectiveFrom: 1 },
    unique: true,
  },
  {
    name: "INV_V2_UOM_ACTIVE_LOOKUP",
    key: { materialId: 1, effectiveFrom: -1, effectiveTo: 1 },
  },
];

function normalizeDocument(value: Document | undefined): string {
  if (!value) return "{}";
  return JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function matches(existing: IndexDescriptionInfo, desired: NamedIndex): boolean {
  return JSON.stringify(existing.key) === JSON.stringify(desired.key)
    && Boolean(existing.unique) === Boolean(desired.unique)
    && normalizeDocument(existing.partialFilterExpression) === normalizeDocument(
      desired.partialFilterExpression as Document | undefined,
    );
}

async function ensureCollectionIndexes<TSchema extends Document>(
  collection: Collection<TSchema>,
  indexes: readonly NamedIndex[],
  apply: boolean,
  result: InventoryV2IndexInstallResult,
): Promise<void> {
  const existingIndexes = await collection.listIndexes().toArray().catch((error: unknown) => {
    const candidate = error as { code?: number };
    if (candidate.code === 26) return [] as IndexDescriptionInfo[];
    throw error;
  });
  const byName = new Map(existingIndexes.map((index) => [index.name, index]));
  for (const desired of indexes) {
    const existing = byName.get(desired.name);
    if (existing) {
      if (!matches(existing, desired)) {
        throw new Error(`INDEX_DEFINITION_MISMATCH:${collection.collectionName}:${desired.name}`);
      }
      result.existing.push(`${collection.collectionName}.${desired.name}`);
      continue;
    }
    if (!apply) {
      result.planned.push(`${collection.collectionName}.${desired.name}`);
      continue;
    }
    const { key, ...options } = desired;
    await collection.createIndex(key, options);
    result.created.push(`${collection.collectionName}.${desired.name}`);
  }
}

export async function installInventoryV2Indexes(
  collections: InventoryV2IndexCollections,
  options: { apply: boolean },
): Promise<InventoryV2IndexInstallResult> {
  const result: InventoryV2IndexInstallResult = { created: [], existing: [], planned: [] };
  await ensureCollectionIndexes(collections.inventoryMovementsV2, MOVEMENT_INDEXES, options.apply, result);
  await ensureCollectionIndexes(collections.inventoryBalancesV2, BALANCE_INDEXES, options.apply, result);
  await ensureCollectionIndexes(collections.materialUomRulesV2, UOM_INDEXES, options.apply, result);
  return result;
}
