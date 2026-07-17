import "dotenv/config";
import { collections } from "../src/lib/db";
import type { AgentPolicyDoc, AgentRole, AgentRoleModeDoc } from "../src/lib/db";
import { M20_PROCUREMENT_POLICY_V1 } from "../src/lib/m20-agent-policy";

const ROLES: AgentRole[] = ["PROCUREMENT", "WMS", "MES", "PROCESS"];

async function main() {
  const { agentPolicies, agentRoleModes } = await collections();
  const now = new Date();

  const policy: AgentPolicyDoc = {
    _id: `M20:${M20_PROCUREMENT_POLICY_V1.materialId}`,
    fabId: "M20",
    materialId: M20_PROCUREMENT_POLICY_V1.materialId,
    supplierId: M20_PROCUREMENT_POLICY_V1.supplierId,
    supplierName: M20_PROCUREMENT_POLICY_V1.supplierName,
    moq: M20_PROCUREMENT_POLICY_V1.moq,
    orderMultiple: M20_PROCUREMENT_POLICY_V1.orderMultiple,
    leadTimeDays: M20_PROCUREMENT_POLICY_V1.leadTimeDays,
    unitPrice: M20_PROCUREMENT_POLICY_V1.unitPrice,
    currency: M20_PROCUREMENT_POLICY_V1.currency,
    effectiveFrom: M20_PROCUREMENT_POLICY_V1.effectiveFrom,
    updatedBy: "migrate-agent-policies",
    updatedAt: now,
  };
  await agentPolicies.updateOne(
    { _id: policy._id },
    { $set: policy },
    { upsert: true },
  );

  for (const role of ROLES) {
    const doc: AgentRoleModeDoc = { _id: role, mode: "AGENT", updatedBy: "migrate-agent-policies", updatedAt: now };
    await agentRoleModes.updateOne(
      { _id: role },
      { $setOnInsert: doc },
      { upsert: true },
    );
  }

  await agentPolicies.createIndex({ fabId: 1, materialId: 1 }, { unique: true });

  console.log(`✅ 에이전트 정책 데이터화 완료: ${policy._id}, 역할 모드 ${ROLES.length}건 기본값(AGENT) 준비`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
