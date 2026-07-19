import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { getLiveFabScenario, setFabUtilization } from "../src/lib/fab-scenario";

async function main() {
  const { fabScenarios } = await collections();
  await fabScenarios.deleteOne({ _id: "M20" });

  const before = await getLiveFabScenario("M20");
  assert.equal(before.utilization, 0.90, "DB에 문서가 없으면 정적 FAB_SCENARIO 값(0.90)으로 폴백해야 합니다");
  assert.equal(before.nominalWspm, 130_000, "nominalWspm은 항상 정적 값이어야 합니다");
  console.log("✅ 1) DB 문서 없을 때 정적값 폴백 확인");

  const updated = await setFabUtilization("M20", 0.75, "test-script");
  assert.equal(updated.utilization, 0.75);
  console.log("✅ 2) setFabUtilization 반환값 확인");

  const after = await getLiveFabScenario("M20");
  assert.equal(after.utilization, 0.75, "DB에 저장된 가동률이 반영되어야 합니다");
  assert.equal(after.nominalWspm, 130_000, "nominalWspm은 여전히 정적 값이어야 합니다");
  console.log("✅ 3) DB 저장 후 getLiveFabScenario 반영 확인");

  await assert.rejects(() => setFabUtilization("M20", 1.5, "test-script"), /가동률/, "1 초과 가동률은 거부되어야 합니다");
  console.log("✅ 4) 범위 밖 가동률 거부 확인");

  await fabScenarios.deleteOne({ _id: "M20" });
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
