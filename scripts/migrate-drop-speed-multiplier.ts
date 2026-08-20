import "dotenv/config";
import { collections, getMongoClient } from "../src/lib/db";

// speedMultiplier는 운영시계가 읽지 않는 사문화 필드였고, 화면은 그 값(1)을 배속으로 표시했다.
// 진실원은 OPERATING_SPEED_MULTIPLIER 하나다. 문서에서 지워 재유입 경로를 없앤다.
async function main() {
  const { twinEngineState } = await collections();
  const res = await twinEngineState.updateOne({ _id: "singleton" }, { $unset: { speedMultiplier: "" } });
  console.log(`speedMultiplier 제거: matched=${res.matchedCount} modified=${res.modifiedCount}`);
  await (await getMongoClient()).close();
}

main().catch(e => { console.error(e); process.exit(1); });
