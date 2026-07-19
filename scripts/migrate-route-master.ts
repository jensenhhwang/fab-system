import "dotenv/config";
import { collections } from "../src/lib/db";
import type { RouteMasterDoc, RouteMasterEdge, RouteMasterNode } from "../src/lib/db";
import { M20_HBM_ROUTE_KEY, M20_HBM_ROUTE_VERSION } from "../src/lib/route-contract";

const apply = process.argv.includes("--apply");

// docs/route-master.md의 M20 · HBM 섹션을 그대로 옮긴 시드 데이터.
// 반복 횟수는 문서에 적힌 범위의 대표값이며 출처는 sourceRefs 참고.
const M20_NODES: RouteMasterNode[] = [
  { id: "gate-oxide", label: "산화막 형성 (STI 라이너, 게이트 산화막 등)", cycle: ["P01"], repeatCount: 4, stage: "FRONT_END" },
  { id: "cell-array", label: "셀 어레이(커패시터/트랜지스터) 형성 — 포토→식각→증착(또는 이온주입)→CMP", cycle: ["P03", "P04", "P02", "P07"], repeatCount: 22, stage: "FRONT_END" },
  { id: "beol-metal", label: "금속배선(BEOL, Cu 다마신) — 층(M1,M2,M3…)마다 반복", cycle: ["P02", "P03", "P04", "P06", "P07"], repeatCount: 5, stage: "FRONT_END" },
  { id: "wafer-test-1", label: "1차 웨이퍼테스트 (EDS/KGD 선별)", cycle: ["P09"], repeatCount: 1, stage: "TEST" },
  { id: "tsv-front", label: "TSV 프런트사이드 — 비아 식각·라이너/배리어/시드 증착·Cu 도금·CMP", cycle: ["P08"], repeatCount: 1, stage: "TSV_FRONT", operationCode: "TSV_FRONT", inputUnit: "WAFER", outputUnit: "WAFER" },
  { id: "edge-trim", label: "조건부 Edge Trim — Backgrind 전 wafer edge chipping 방지", cycle: ["P08"], repeatCount: 1, stage: "BACKGRIND", operationCode: "EDGE_TRIM", inputUnit: "WAFER", outputUnit: "WAFER" },
  { id: "backgrind", label: "백그라인딩(웨이퍼 뒷면 연마·박막화) 후 웨이퍼 뒤집기", cycle: ["P08"], repeatCount: 1, stage: "BACKGRIND", operationCode: "BACKGRIND_THINNING", inputUnit: "WAFER", outputUnit: "WAFER" },
  { id: "tsv-back", label: "TSV 백사이드 — TSV 노출(리빌)·백사이드 절연/배리어·마이크로범프 형성", cycle: ["P08"], repeatCount: 1, stage: "TSV_BACK", operationCode: "TSV_BACK", inputUnit: "WAFER", outputUnit: "WAFER" },
  { id: "wafer-test-2", label: "2차 웨이퍼테스트 (적층 전 재검)", cycle: ["P09"], repeatCount: 1, stage: "TEST", operationCode: "WAFER_TEST", inputUnit: "WAFER", outputUnit: "WAFER" },
  { id: "memory-dicing", label: "Memory wafer Dicing / Singulation", cycle: ["P10"], repeatCount: 1, stage: "SINGULATION", operationCode: "DICING", inputUnit: "WAFER", outputUnit: "MEMORY_KGD" },
  { id: "memory-die-sort", label: "Memory Die Sort · KGD staging", cycle: ["P10"], repeatCount: 1, stage: "SINGULATION", operationCode: "DIE_SORT_KGD", inputUnit: "MEMORY_KGD", outputUnit: "MEMORY_KGD" },
  { id: "hbm-base-die-attach", label: "P10 Packaging · 외부 Logic Base Die KGD 투입 · Base Die Attach", cycle: ["P10"], repeatCount: 1, stage: "ASSEMBLY", operationCode: "BASE_DIE_ATTACH", inputUnit: "MEMORY_KGD", outputUnit: "STACK" },
  { id: "hbm-dram-bond", label: "P10 Packaging · HBM4 Memory KGD 12-Hi 정렬·본딩", cycle: ["P10"], repeatCount: 12, stage: "ASSEMBLY", operationCode: "DRAM_BOND_12H", inputUnit: "STACK", outputUnit: "STACK" },
  { id: "hbm-muf-molding", label: "P10 Packaging · MR-MUF / Molding / Cure", cycle: ["P10"], repeatCount: 1, stage: "PACKAGING", operationCode: "MUF_MOLDING_CURE", inputUnit: "STACK", outputUnit: "STACK" },
  { id: "hbm-final-test", label: "P10 Packaging · HBM4 Final Test", cycle: ["P10"], repeatCount: 1, stage: "TEST", operationCode: "FINAL_TEST", inputUnit: "STACK", outputUnit: "GOOD_PACKAGE" },
];

function sequentialEdges(nodes: RouteMasterNode[]): RouteMasterEdge[] {
  const edges: RouteMasterEdge[] = [{ from: "START", to: nodes[0].id }];
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
  edges.push({ from: nodes[nodes.length - 1].id, to: "END" });
  return edges;
}

const SOURCE_REFS = [
  "https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html",
  "https://www.imec-int.com/en/articles/view-logic-technology-roadmap",
  "https://news.samsung.com/global/samsung-electronics-develops-industrys-first-12-layer-3d-tsv-chip-packaging-technology",
  "https://news.skhynix.com/semiconductor-back-end-process-episode-4-packages-part-2/",
];

async function main() {
  const { routeMasters } = await collections();
  const now = new Date();
  const doc: RouteMasterDoc = {
    _id: "M20:HBM:V3",
    fabId: "M20",
    product: "HBM",
    routeKey: M20_HBM_ROUTE_KEY,
    isActive: true,
    version: M20_HBM_ROUTE_VERSION,
    nodes: M20_NODES,
    edges: sequentialEdges(M20_NODES),
    source: "MODELED_BASELINE",
    sourceRefs: SOURCE_REFS,
    updatedAt: now,
  };
  const legacy = await routeMasters.findOne({ _id: "M20:HBM" });
  const totalSteps = doc.nodes.reduce((sum, node) => sum + node.cycle.length * node.repeatCount, 0);
  console.log(`[route-master] mode=${apply ? "APPLY" : "DRY_RUN"} target=${doc._id} nodes=${doc.nodes.length} steps=${totalSteps} legacy=${legacy ? "PRESERVE_AS_V1" : "NONE"}`);
  if (!apply) {
    process.exit(0);
  }
  // 기존 fabId+product unique index가 있으면 version 문서를 한 건도 추가할 수 없다.
  // 먼저 version-aware unique index를 만든 뒤 legacy unique만 정확히 제거한다.
  const indexes = await routeMasters.indexes();
  await routeMasters.createIndex({ fabId: 1, product: 1, version: 1 }, { unique: true });
  const legacyUnique = indexes.find((index) => index.unique && index.key?.fabId === 1 && index.key?.product === 1 && Object.keys(index.key).length === 2);
  if (legacyUnique?.name) await routeMasters.dropIndex(legacyUnique.name);
  // 기존 M20:HBM 문서 자체를 V1 이력으로 보존한다. 같은 version 복제본을 만들면
  // fabId+product+version unique 계약을 깨므로 별도 M20:HBM:V1 copy는 생성하지 않는다.
  await routeMasters.updateMany({ fabId: "M20", product: "HBM", _id: { $ne: doc._id } }, { $set: { isActive: false } });
  await routeMasters.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
  await routeMasters.createIndex({ fabId: 1, product: 1, isActive: 1 });
  console.log(`✅ routeMaster 시딩 완료: ${doc._id} (노드 ${doc.nodes.length}개, ${totalSteps}스텝)`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
