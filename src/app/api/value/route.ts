import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createBenefitCase } from "@/lib/queries";
import type { BenefitCategory, BenefitValueType } from "@/lib/db";

const CATEGORIES = new Set<BenefitCategory>(["COST", "TIME", "RISK", "QUALITY", "CONTROL"]);
const VALUE_TYPES = new Set<BenefitValueType>(["CASH_SAVING", "WORKING_CAPITAL", "COST_AVOIDANCE", "TIME_VALUE", "RISK_AVOIDANCE", "FORECAST_QUALITY"]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body.title?.trim() || !body.baselineDescription?.trim() || !body.systemFinding?.trim()) {
    return NextResponse.json({ error: "제목, 기준 상황, 시스템 기여는 필수입니다." }, { status: 400 });
  }
  if (!CATEGORIES.has(body.category) || !VALUE_TYPES.has(body.valueType)) {
    return NextResponse.json({ error: "효과 분류가 올바르지 않습니다." }, { status: 400 });
  }
  const ownerId = (session.user as { id?: string }).id;
  if (!ownerId) return NextResponse.json({ error: "User ID not found" }, { status: 400 });
  const quantity = body.affectedQuantity === "" ? null : Number(body.affectedQuantity);
  const unitPrice = body.unitPrice === "" ? null : Number(body.unitPrice);
  if ((quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) || (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0))) {
    return NextResponse.json({ error: "수량과 단가는 0 이상의 숫자여야 합니다." }, { status: 400 });
  }
  const calculatedAmount = quantity !== null && unitPrice !== null ? quantity * unitPrice : null;
  const now = new Date();
  await createBenefitCase({
    title: body.title.trim(), category: body.category, valueType: body.valueType, status: calculatedAmount === null ? "OBSERVED" : "CALCULATED",
    materialId: body.materialId || null, baselineDescription: body.baselineDescription.trim(), systemFinding: body.systemFinding.trim(),
    actionTaken: body.actionTaken?.trim() || null, actualOutcome: null, affectedQuantity: quantity, unit: body.unit?.trim() || null,
    unitPrice, calculationFormula: calculatedAmount === null ? null : `${quantity} × ${unitPrice}`, calculatedAmount, approvedAmount: null,
    evidence: body.evidence?.trim() || null, ownerId, validatorId: null, detectedAt: now, validatedAt: null, createdAt: now, updatedAt: now,
  });
  return NextResponse.json({ ok: true });
}
