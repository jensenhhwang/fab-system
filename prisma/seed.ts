import "dotenv/config"; // tsx로 직접 실행 시 .env 로드
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";
import { randomUUID } from "crypto";
import { FACILITY_MASTER, getCanonicalFacility, getSupplyProfile } from "../src/lib/warehouse-storage-rules";

// MongoDB(Atlas) 네이티브 드라이버로 시드. _id는 자연키(코드) 사용.
const client = new MongoClient(process.env.DATABASE_URL as string);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 미설정 (MongoDB 연결 문자열 필요)");
  console.log("🌱 Seeding FAB Materials System (MongoDB)...");
  await client.connect();
  const db = client.db();
  // string _id 를 허용하는 컬렉션 헬퍼
  const col = (name: string) => db.collection<{ _id: string } & Record<string, unknown>>(name);

  // 깨끗한 시드: 기존 컬렉션 비우기
  const cols = ["users", "warehouses", "suppliers", "materials", "inventory",
    "processUsage", "materialSuppliers", "infraEquipment", "risks", "wikiEntries"];
  for (const c of cols) await db.collection(c).deleteMany({});

  // ─── 1. 사용자 계정 ───────────────────────────────────────
  const pw = await bcrypt.hash("fab1234!", 10);

  const usersData = [
    { _id: "admin@fab.skh",      email: "admin@fab.skh",      name: "황지훈", password: pw, role: "ADMIN",      department: "구매본부 자재관리팀", createdAt: new Date() },
    { _id: "materials@fab.skh",  email: "materials@fab.skh",  name: "김재현", password: pw, role: "MATERIALS",  department: "구매본부 자재관리팀", createdAt: new Date() },
    { _id: "production@fab.skh", email: "production@fab.skh", name: "이수진", password: pw, role: "PRODUCTION", department: "생산관리팀",       createdAt: new Date() },
    { _id: "logistics@fab.skh",  email: "logistics@fab.skh",  name: "박민준", password: pw, role: "LOGISTICS",  department: "물류/인프라팀",     createdAt: new Date() },
  ];
  await col("users").insertMany(usersData);
  console.log(`✅ Users: ${usersData.length}명`);

  // ─── 2. 창고 ───────────────────────────────────────────────
  const warehousesData = FACILITY_MASTER.map((facility) => ({ ...facility }));
  await col("warehouses").insertMany(warehousesData);
  console.log(`✅ Warehouses: ${warehousesData.length}개`);

  // ─── 3. 공급업체 ───────────────────────────────────────────
  const suppliersData = [
    { _id: "sup-airproducts", name: "Air Products Korea", country: "KR", notes: "N₂·Ar·He 벌크 가스 주 공급사" },
    { _id: "sup-skg", name: "SK가스", country: "KR", notes: "H₂·O₂·SiH₄ 공급" },
    { _id: "sup-lindekorea", name: "린데코리아", country: "KR", notes: "특수가스 (NF₃·WF₆·NH₃) 공급" },
    { _id: "sup-soulbrain", name: "솔브레인", country: "KR", notes: "HF·H₂O₂·BOE 식각액 공급" },
    { _id: "sup-duksan", name: "덕산네오룩스", country: "KR", notes: "포토레지스트 PR 공급" },
    { _id: "sup-jsr", name: "JSR Corporation", country: "JP", notes: "ArF·KrF·EUV 포토레지스트 (일본 의존도 高)" },
    { _id: "sup-cmi", name: "CMC Materials (Entegris)", country: "US", notes: "CMP 슬러리 (Ceria·Silica) 공급" },
    { _id: "sup-cabot", name: "Cabot Microelectronics", country: "US", notes: "CMP 슬러리·패드 공급" },
    { _id: "sup-tokai", name: "Tokai Carbon", country: "JP", notes: "PVD 타겟 (Ti·TiN·W) 공급" },
    { _id: "sup-mks", name: "MKS Korea", country: "KR", notes: "TEOS·HMDSO CVD 전구체 공급" },
    { _id: "sup-sumitomo", name: "Sumitomo Chemical", country: "JP", notes: "Si₃N₄ 전구체 (BDEAS) 공급" },
    { _id: "sup-formfactor", name: "FormFactor Korea", country: "KR", notes: "Probe Card 공급 (웨이퍼 테스트용)" },
    { _id: "sup-atotech", name: "Atotech (MKS)", country: "DE", notes: "Cu ECD 도금액 (TSV Fill) 공급" },
    { _id: "sup-alpha", name: "Alpha Assembly Solutions", country: "US", notes: "SnAg μBump 솔더 공급 (HBM 전용)" },
  ];
  await col("suppliers").insertMany(suppliersData);
  console.log(`✅ Suppliers: ${suppliersData.length}개`);

  // ─── 4. 자재 마스터 ────────────────────────────────────────
  // 공정 코드: P01=산화막, P02=CVD, P03=포토, P04=식각, P05=이온주입
  //            P06=금속배선1, P07=CMP, P08=금속배선2(TSV), P09=웨이퍼테스트, P10=패키징

  const materialDefs = [
    // ── GAS 계열 ──────────────────────────────────────
    { code: "GAS-001", name: "질소 (N₂)", nameEn: "Nitrogen", category: "GAS", unit: "봄베", safetyStock: 500, ropDays: 10, notes: "퍼지·블랭킷·운반 가스. 전 공정 필수" },
    { code: "GAS-002", name: "수소 (H₂)", nameEn: "Hydrogen", category: "GAS", unit: "봄베", safetyStock: 120, ropDays: 7, notes: "산화막 어닐 및 금속 환원에 사용" },
    { code: "GAS-003", name: "아르곤 (Ar)", nameEn: "Argon", category: "GAS", unit: "봄베", safetyStock: 300, ropDays: 10, notes: "PVD 스퍼터링 가스, CVD 희석 가스" },
    { code: "GAS-004", name: "실란 (SiH₄)", nameEn: "Silane", category: "GAS", unit: "봄베", safetyStock: 80, ropDays: 14, notes: "LPCVD Si 박막 전구체. 리드타임 길어 여유 재고 필요" },
    { code: "GAS-005", name: "암모니아 (NH₃)", nameEn: "Ammonia", category: "GAS", unit: "봄베", safetyStock: 60, ropDays: 14, notes: "Si₃N₄ CVD, 위험물창고 보관 필수" },
    { code: "GAS-006", name: "삼불화질소 (NF₃)", nameEn: "Nitrogen Trifluoride", category: "GAS", unit: "봄베", safetyStock: 40, ropDays: 21, notes: "CVD 챔버 세정(in-situ clean). 수입 의존" },
    { code: "GAS-007", name: "육불화텅스텐 (WF₆)", nameEn: "Tungsten Hexafluoride", category: "GAS", unit: "봄베", safetyStock: 30, ropDays: 21, notes: "W CVD 전구체 (NAND 워드라인). 독성 고위험" },
    { code: "GAS-008", name: "산소 (O₂)", nameEn: "Oxygen", category: "GAS", unit: "봄베", safetyStock: 200, ropDays: 7, notes: "산화막 성장, 애싱 공정" },
    { code: "GAS-009", name: "이산화탄소 (CO₂)", nameEn: "Carbon Dioxide", category: "GAS", unit: "봄베", safetyStock: 100, ropDays: 7, notes: "세정 및 초임계 CO₂ dry clean" },
    { code: "GAS-010", name: "헬륨 (He)", nameEn: "Helium", category: "GAS", unit: "봄베", safetyStock: 80, ropDays: 21, notes: "이온주입 냉각, 리크 검사. 수급 불안정 품목" },
    { code: "GAS-011", name: "사불화탄소 (CF₄)", nameEn: "Carbon Tetrafluoride", category: "GAS", unit: "봄베", safetyStock: 50, ropDays: 14, notes: "드라이 식각 (SiO₂·Si₃N₄)" },
    { code: "GAS-012", name: "팔불화황 (SF₆)", nameEn: "Sulfur Hexafluoride", category: "GAS", unit: "봄베", safetyStock: 40, ropDays: 14, notes: "Si 등방성 식각" },
    { code: "GAS-013", name: "염소 (Cl₂)", nameEn: "Chlorine", category: "GAS", unit: "봄베", safetyStock: 35, ropDays: 14, notes: "Al·W 이방성 식각. 독성 관리 필수" },
    { code: "GAS-014", name: "TEOS", nameEn: "Tetraethyl Orthosilicate", category: "GAS", unit: "드럼", safetyStock: 60, ropDays: 14, notes: "PECVD SiO₂ 전구체. DRAM·NAND ILD용" },
    { code: "GAS-015", name: "DCS (SiH₂Cl₂)", nameEn: "Dichlorosilane", category: "GAS", unit: "봄베", safetyStock: 45, ropDays: 21, notes: "LPCVD Si₃N₄·폴리실리콘 전구체" },
    { code: "GAS-016", name: "BDEAS", nameEn: "Bis(diethylamino)silane", category: "GAS", unit: "봄베", safetyStock: 25, ropDays: 30, notes: "ALD Si₃N₄ 전구체 (ONO 스택, NAND 핵심)" },
    { code: "GAS-017", name: "TiCl₄", nameEn: "Titanium Tetrachloride", category: "GAS", unit: "봄베", safetyStock: 30, ropDays: 21, notes: "ALD TiN 배리어 금속. DRAM·NAND" },
    { code: "GAS-018", name: "TDMAT (Ti 전구체)", nameEn: "Tetrakis(dimethylamido)titanium", category: "GAS", unit: "봄베", safetyStock: 20, ropDays: 30, notes: "ALD TiN 배리어, HBM TSV 라이너" },
    { code: "GAS-019", name: "TEMAHf (Hf 전구체)", nameEn: "Tetrakis(ethylmethylamido)hafnium", category: "GAS", unit: "봄베", safetyStock: 15, ropDays: 45, notes: "ALD HfO₂ High-k 게이트 절연막. DRAM 핵심" },
    { code: "GAS-020", name: "DIPAS (Si 전구체)", nameEn: "Diisopropylaminosilane", category: "GAS", unit: "봄베", safetyStock: 18, ropDays: 30, notes: "ALD SiO₂ 스페이서. EUV 더블패터닝" },

    // ── CHM 계열 ──────────────────────────────────────
    { code: "CHM-001", name: "불산 (HF)", nameEn: "Hydrofluoric Acid", category: "CHM", unit: "병(20L)", safetyStock: 150, ropDays: 10, notes: "웨이퍼 세정, SiO₂ 습식 식각. 위험물창고 보관" },
    { code: "CHM-002", name: "과산화수소 (H₂O₂)", nameEn: "Hydrogen Peroxide", category: "CHM", unit: "드럼", safetyStock: 200, ropDays: 7, notes: "SC1/SC2 세정 주 약품. 산화제" },
    { code: "CHM-003", name: "황산 (H₂SO₄)", nameEn: "Sulfuric Acid", category: "CHM", unit: "드럼", safetyStock: 180, ropDays: 7, notes: "SPM(피라냐) 세정. 유기물 제거" },
    { code: "CHM-004", name: "암모니아수 (NH₄OH)", nameEn: "Ammonium Hydroxide", category: "CHM", unit: "드럼", safetyStock: 120, ropDays: 10, notes: "SC1(APM) 세정. 파티클 제거" },
    { code: "CHM-005", name: "염산 (HCl)", nameEn: "Hydrochloric Acid", category: "CHM", unit: "드럼", safetyStock: 100, ropDays: 10, notes: "SC2(HPM) 금속 오염 제거" },
    { code: "CHM-006", name: "인산 (H₃PO₄)", nameEn: "Phosphoric Acid", category: "CHM", unit: "드럼", safetyStock: 80, ropDays: 14, notes: "Si₃N₄ 선택적 습식 식각 (NAND ONO 스택)" },
    { code: "CHM-007", name: "ArF 포토레지스트", nameEn: "ArF Photoresist (193nm)", category: "CHM", unit: "캔(1L)", safetyStock: 120, ropDays: 21, notes: "193nm ArF 노광용 PR. JSR·TOK 공급. 리드타임 21일+" },
    { code: "CHM-008", name: "KrF 포토레지스트", nameEn: "KrF Photoresist (248nm)", category: "CHM", unit: "캔(1L)", safetyStock: 80, ropDays: 14, notes: "248nm KrF 노광용 PR. 구조층에 사용" },
    { code: "CHM-009", name: "EUV 포토레지스트", nameEn: "EUV Photoresist (13.5nm)", category: "CHM", unit: "캔(1L)", safetyStock: 30, ropDays: 45, notes: "13.5nm EUV용. 일본 의존도 高, 리드타임 45일. 수급 리스크 1순위" },
    { code: "CHM-010", name: "포토레지스트 현상액 (TMAH)", nameEn: "TMAH Developer", category: "CHM", unit: "드럼", safetyStock: 60, ropDays: 10, notes: "알카리 현상액. 2.38% TMAH 표준" },
    { code: "CHM-011", name: "Cu ECD 도금액", nameEn: "Copper Electroplating Solution", category: "CHM", unit: "드럼", safetyStock: 40, ropDays: 21, notes: "TSV Cu Fill·배선 도금. HBM 전용 공정. Atotech 공급" },

    // ── CSM 계열 (소모성 소재) ─────────────────────────
    { code: "CSM-001", name: "CMP 슬러리 — Ceria (산화막)", nameEn: "Ceria Slurry (SiO₂)", category: "CSM", unit: "캔(20L)", safetyStock: 300, ropDays: 10, notes: "PETEOS·STI CMP. HBM TSV Reveal CMP에서 사용량 18% 증가" },
    { code: "CSM-002", name: "CMP 슬러리 — Silica (텅스텐)", nameEn: "Silica Slurry (W)", category: "CSM", unit: "캔(20L)", safetyStock: 250, ropDays: 10, notes: "W 플러그 CMP. NAND 워드라인 CMP 소모량 大" },
    { code: "CSM-003", name: "CMP 슬러리 — 구리 (Cu)", nameEn: "Copper CMP Slurry", category: "CSM", unit: "캔(20L)", safetyStock: 180, ropDays: 14, notes: "Cu 배선 CMP. DRAM·HBM 금속배선 공정" },
    { code: "CSM-004", name: "CMP 패드 (IC1000)", nameEn: "CMP Pad IC1000", category: "CSM", unit: "장", safetyStock: 80, ropDays: 14, notes: "폴리우레탄 패드. 1,500 run마다 교체. 연간 약 520장 소모" },
    { code: "CSM-005", name: "CMP 패드 컨디셔너 디스크", nameEn: "CMP Conditioner Disk", category: "CSM", unit: "개", safetyStock: 40, ropDays: 14, notes: "다이아몬드 드레서. 패드 교체 시 함께 교체" },
    { code: "CSM-006", name: "PVD 타겟 — Ti", nameEn: "PVD Target Titanium", category: "CSM", unit: "개", safetyStock: 15, ropDays: 30, notes: "Ti 배리어 스퍼터 타겟. 200kWh 소모 후 교체. Tokai 공급" },
    { code: "CSM-007", name: "PVD 타겟 — W", nameEn: "PVD Target Tungsten", category: "CSM", unit: "개", safetyStock: 12, ropDays: 30, notes: "W 글루 레이어 타겟. 250kWh 교체 기준" },
    { code: "CSM-008", name: "PVD 타겟 — TiN", nameEn: "PVD Target TiN", category: "CSM", unit: "개", safetyStock: 10, ropDays: 30, notes: "반응성 스퍼터 TiN 배리어" },
    { code: "CSM-009", name: "Probe Card — HBM", nameEn: "Probe Card HBM KGD", category: "CSM", unit: "장", safetyStock: 8, ropDays: 45, notes: "KGD 스크리닝용 Probe Card. HBM 스택 전 완전검사 필수. FormFactor 공급" },
    { code: "CSM-010", name: "Probe Card — DRAM", nameEn: "Probe Card DRAM", category: "CSM", unit: "장", safetyStock: 10, ropDays: 45, notes: "DRAM 웨이퍼 테스트용. 250K 터치다운마다 교체" },
    { code: "CSM-011", name: "포토 세정액 (PRS)", nameEn: "Photoresist Stripper", category: "CSM", unit: "드럼", safetyStock: 100, ropDays: 10, notes: "애싱 후 잔류 PR 습식 제거" },
    { code: "CSM-012", name: "SnAg 솔더 범프 (μBump)", nameEn: "SnAg Solder Bump", category: "CSM", unit: "wafer-lot", safetyStock: 20, ropDays: 30, notes: "HBM Die 간 μBump 접합. Alpha Assembly 공급. HBM 전용" },
    { code: "CSM-013", name: "연마 테이프 (백그라인딩)", nameEn: "Backgrinding Tape", category: "CSM", unit: "롤", safetyStock: 50, ropDays: 14, notes: "웨이퍼 박화(thin wafer) 보호 테이프. HBM TSV 후 박화 필수" },

    // ── UTL 계열 (유틸리티) ────────────────────────────
    { code: "UTL-001", name: "초순수 (UPW)", nameEn: "Ultra Pure Water", category: "UTL", unit: "톤", safetyStock: 0, ropDays: 0, notes: "현장 생산. 일 소비량 약 5,000톤/Line. 수질 모니터링 상시" },
    { code: "UTL-002", name: "배기 스크러버액 (NaOH)", nameEn: "Scrubber Liquid NaOH", category: "UTL", unit: "드럼", safetyStock: 80, ropDays: 7, notes: "산성 배기가스 중화. 환경 설비 운영 필수" },

    // ── PKG 계열 (패키징) ──────────────────────────────
    { code: "PKG-001", name: "EMC (에폭시 몰딩 컴파운드)", nameEn: "Epoxy Molding Compound", category: "PKG", unit: "kg", safetyStock: 500, ropDays: 14, notes: "HBM MR-MUF 공정용 몰딩재. 리드타임 길고 수급 주의" },

    // ── 이온주입 도판트 가스 (P05) ──────────────────────
    { code: "GAS-021", name: "삼불화붕소 (BF₃)", nameEn: "Boron Trifluoride", category: "GAS", unit: "봄베", safetyStock: 25, ropDays: 21, notes: "붕소(B) 도판트 소스. P형 이온주입. 독성·부식성 고위험" },
    { code: "GAS-022", name: "포스핀 (PH₃)", nameEn: "Phosphine", category: "GAS", unit: "봄베", safetyStock: 20, ropDays: 21, notes: "인(P) 도판트 소스. N형 주입. 맹독성, 위험물 보관 필수" },
    { code: "GAS-023", name: "아르신 (AsH₃)", nameEn: "Arsine", category: "GAS", unit: "봄베", safetyStock: 15, ropDays: 30, notes: "비소(As) 도판트 소스. N형 주입. 초고독성, 취급 규제 최상위" },
    { code: "GAS-024", name: "디보란 (B₂H₆)", nameEn: "Diborane", category: "GAS", unit: "봄베", safetyStock: 12, ropDays: 30, notes: "붕소 도핑·PECVD 도핑막. 자연발화성, 희석 공급" },
    // ── 식각 특수가스 (P04) ─────────────────────────────
    { code: "GAS-025", name: "브롬화수소 (HBr)", nameEn: "Hydrogen Bromide", category: "GAS", unit: "봄베", safetyStock: 30, ropDays: 14, notes: "게이트·고종횡비 실리콘 식각. 높은 선택비" },
    { code: "GAS-026", name: "옥타플루오로시클로부탄 (C₄F₈)", nameEn: "Octafluorocyclobutane", category: "GAS", unit: "봄베", safetyStock: 28, ropDays: 14, notes: "산화막 이방성 식각·측벽 보호막. Contact/Via 식각" },
    // ── 케미컬 보강 ─────────────────────────────────────
    { code: "CHM-012", name: "EBR 신너 (에지비드 제거)", nameEn: "Edge Bead Remover", category: "CHM", unit: "드럼", safetyStock: 70, ropDays: 10, notes: "웨이퍼 가장자리 PR 제거. 포토 도포 공정 소모" },
    { code: "CHM-013", name: "Post-CMP 세정액", nameEn: "Post-CMP Cleaning Solution", category: "CHM", unit: "드럼", safetyStock: 90, ropDays: 10, notes: "CMP 후 슬러리 잔류·금속 오염 제거" },
    // ── CSM / PKG 보강 ──────────────────────────────────
    { code: "CSM-014", name: "HBM 언더필 (TC-NCF)", nameEn: "Non-Conductive Film (TC-NCF)", category: "CSM", unit: "롤", safetyStock: 30, ropDays: 30, notes: "HBM 스택 열압착 본딩용 비전도성 필름. HBM 전용" },
    { code: "CSM-015", name: "챔버 석영 파츠 (Quartz Kit)", nameEn: "Quartz Chamber Parts", category: "CSM", unit: "세트", safetyStock: 12, ropDays: 45, notes: "식각·증착 챔버 소모성 석영/세라믹 파츠. PM 시 교체" },
    { code: "PKG-002", name: "다이접착필름 (DAF)", nameEn: "Die Attach Film", category: "PKG", unit: "롤", safetyStock: 120, ropDays: 21, notes: "다이 적층 접착 필름. HBM 다단 스택 본딩" },
  ];

  await col("materials").insertMany(
    materialDefs.map((def) => ({ _id: def.code, ...def, supplyMode: getSupplyProfile(def.code).mode, createdAt: new Date() }))
  );
  // 자재 코드가 곧 _id (관계 참조용)
  const materials: Record<string, { id: string }> = {};
  for (const def of materialDefs) materials[def.code] = { id: def.code };
  console.log(`✅ Materials: ${materialDefs.length}종`);

  // ─── 5. 재고 (현재고 + 일평균사용량) ──────────────────────
  // 창고별 재고 배율 (업계 기준 점유율 달성):
  // MWH-01 실질 자재 ×7 → 목표 68%  / MWH-02 자재 ×13 → 목표 51%
  // HZW-01 가스 실린더 ×7 → 목표 75%  (totalCapacity 7500)
  // MRO-01 MRO qty ×16, daily ×4 → 목표 46%
  const inventoryData = [
    // GAS — 벌크가스 야드(BGY-01)·전구체실(PRS-01) 행: 공급형태 기준으로 재배치되므로 qty 그대로 유지
    { code: "GAS-001", whCode: "MWH-01", qty: 2800, daily: 180 },
    { code: "GAS-002", whCode: "MWH-01", qty: 340,  daily: 22  },
    { code: "GAS-003", whCode: "MWH-01", qty: 920,  daily: 55  },
    { code: "GAS-008", whCode: "MWH-01", qty: 580,  daily: 38  },
    { code: "GAS-009", whCode: "MWH-01", qty: 280,  daily: 18  },
    { code: "GAS-010", whCode: "MWH-01", qty: 95,   daily: 4.5 },
    { code: "GAS-014", whCode: "MWH-01", qty: 140,  daily: 9   },
    { code: "GAS-016", whCode: "MWH-01", qty: 32,   daily: 1.8 },
    { code: "GAS-017", whCode: "MWH-01", qty: 55,   daily: 3.2 },
    { code: "GAS-018", whCode: "MWH-01", qty: 28,   daily: 1.5 },
    { code: "GAS-019", whCode: "MWH-01", qty: 18,   daily: 0.8 },
    { code: "GAS-020", whCode: "MWH-01", qty: 22,   daily: 1.1 },
    // CHM 벌크 — BCY-01: 그대로 유지
    { code: "CHM-001", whCode: "HZW-01", qty: 128,  daily: 14  },
    { code: "CHM-002", whCode: "HZW-01", qty: 165,  daily: 22  },
    { code: "CHM-003", whCode: "HZW-01", qty: 142,  daily: 18  },
    { code: "CHM-004", whCode: "HZW-01", qty: 98,   daily: 12  },
    { code: "CHM-005", whCode: "HZW-01", qty: 82,   daily: 10  },
    { code: "CHM-006", whCode: "HZW-01", qty: 65,   daily: 7.5 },
    { code: "CHM-010", whCode: "MWH-01", qty: 78,   daily: 5.8 },
    // UTL
    { code: "UTL-001", whCode: "MWH-01", qty: 0,    daily: 5000 },
    // HZW-01 특수가스 실린더 ×7 (totalCapacity 7500 기준 목표 75%)
    { code: "GAS-004", whCode: "MWH-01", qty: 1470, daily: 84   },
    { code: "GAS-005", whCode: "HZW-01", qty: 504,  daily: 47.6 },
    { code: "GAS-006", whCode: "HZW-01", qty: 315,  daily: 24.5 },
    { code: "GAS-007", whCode: "HZW-01", qty: 196,  daily: 14.7 },
    { code: "GAS-011", whCode: "HZW-01", qty: 406,  daily: 29.4 },
    { code: "GAS-012", whCode: "HZW-01", qty: 294,  daily: 21.0 },
    { code: "GAS-013", whCode: "HZW-01", qty: 266,  daily: 19.6 },
    { code: "GAS-015", whCode: "MWH-01", qty: 616,  daily: 38.5 },
    { code: "GAS-021", whCode: "HZW-01", qty: 336,  daily: 22.4 },
    { code: "GAS-022", whCode: "HZW-01", qty: 252,  daily: 17.5 },
    { code: "GAS-023", whCode: "HZW-01", qty: 154,  daily: 9.8  },
    { code: "GAS-024", whCode: "HZW-01", qty: 126,  daily: 7.7  },
    { code: "GAS-025", whCode: "HZW-01", qty: 364,  daily: 28.0 },
    { code: "GAS-026", whCode: "HZW-01", qty: 322,  daily: 25.2 },
    // MWH-01 실질 소모품 ×7 (totalCapacity 2000 기준 목표 68%)
    { code: "CSM-001", whCode: "MWH-02", qty: 2940, daily: 196  },
    { code: "CSM-002", whCode: "MWH-02", qty: 2660, daily: 168  },
    { code: "CSM-003", whCode: "MWH-02", qty: 1785, daily: 112  },
    { code: "CSM-004", whCode: "MWH-02", qty: 665,  daily: 9.8  },
    { code: "CSM-005", whCode: "MWH-02", qty: 364,  daily: 9.8  },
    { code: "CSM-011", whCode: "MWH-02", qty: 1015, daily: 66.5 },
    { code: "CSM-012", whCode: "MWH-02", qty: 126,  daily: 5.6  },
    { code: "CSM-013", whCode: "MWH-02", qty: 434,  daily: 24.5 },
    { code: "CHM-011", whCode: "MWH-01", qty: 266,  daily: 15.4 },
    { code: "UTL-002", whCode: "MWH-01", qty: 665,  daily: 45.5 },
    // MWH-02 PR·PKG 자재 ×13 (totalCapacity 2600 기준 목표 51%)
    { code: "CHM-007", whCode: "MWH-01", qty: 1885, daily: 110.5 },
    { code: "CHM-008", whCode: "MWH-01", qty: 1196, daily: 80.6  },
    { code: "CHM-009", whCode: "MWH-01", qty: 286,  daily: 15.6  },
    { code: "CHM-012", whCode: "MWH-01", qty: 806,  daily: 65.0  },
    { code: "CHM-013", whCode: "MWH-01", qty: 1092, daily: 84.5  },
    { code: "PKG-001", whCode: "MWH-02", qty: 10660,daily: 676   },
    { code: "PKG-002", whCode: "MWH-02", qty: 2730, daily: 117   },
    { code: "CSM-014", whCode: "MWH-02", qty: 520,  daily: 20.8  },
    // MRO-01 MRO qty ×16, daily ×4 (totalCapacity 2200 기준 목표 46%)
    { code: "CSM-006", whCode: "MRO-01", qty: 224,  daily: 1.92 },
    { code: "CSM-007", whCode: "MRO-01", qty: 176,  daily: 1.52 },
    { code: "CSM-008", whCode: "MRO-01", qty: 144,  daily: 1.28 },
    { code: "CSM-009", whCode: "MRO-01", qty: 96,   daily: 0.72 },
    { code: "CSM-010", whCode: "MRO-01", qty: 128,  daily: 0.88 },
    { code: "CSM-015", whCode: "MRO-01", qty: 240,  daily: 1.6  },
  ];

  const validMat = (code: string) => Boolean(materials[code]);
  await col("inventory").insertMany(
    inventoryData
      .filter((inv) => validMat(inv.code))
      .map((inv) => ({
        _id: `${inv.code}__${inv.whCode}`,
        materialId: inv.code, warehouseId: getCanonicalFacility(inv.code),
        quantity: inv.qty, avgDailyUsage: inv.daily, status: "AVAILABLE",
        capacityLimit: inv.qty > 0 ? Math.ceil(inv.qty / 0.68) : undefined,
        updatedAt: new Date(),
      }))
  );
  console.log(`✅ Inventory: ${inventoryData.length}건`);

  // ─── 6. 공정별 사용량 (Product × Process × Material) ──────
  // HBM 월 사용량 = 전체의 약 35%, DRAM 45%, NAND 20% 기준 추산
  // processUsage: 생산 규모 ×7 반영 (WH-D 관련 소모품은 ×4 — 교체주기 기준)
  const processUsageData = [
    // N₂ — 전 공정 (HBM) ×7
    { code: "GAS-001", proc: "P01", product: "HBM",  qty: 11760 },
    { code: "GAS-001", proc: "P02", product: "HBM",  qty: 14700 },
    { code: "GAS-001", proc: "P03", product: "HBM",  qty: 6860  },
    { code: "GAS-001", proc: "P07", product: "HBM",  qty: 5880  },
    { code: "GAS-001", proc: "P08", product: "HBM",  qty: 8820  },
    // N₂ — DRAM ×7
    { code: "GAS-001", proc: "P01", product: "DRAM", qty: 15400 },
    { code: "GAS-001", proc: "P02", product: "DRAM", qty: 19600 },
    { code: "GAS-001", proc: "P03", product: "DRAM", qty: 8400  },
    { code: "GAS-001", proc: "P07", product: "DRAM", qty: 7700  },
    // N₂ — NAND ×7
    { code: "GAS-001", proc: "P02", product: "NAND", qty: 8400  },
    { code: "GAS-001", proc: "P04", product: "NAND", qty: 6300  },
    // ArF PR ×7
    { code: "CHM-007", proc: "P03", product: "HBM",  qty: 595  },
    { code: "CHM-007", proc: "P03", product: "DRAM", qty: 784  },
    { code: "CHM-007", proc: "P03", product: "NAND", qty: 336  },
    // EUV PR ×7
    { code: "CHM-009", proc: "P03", product: "HBM",  qty: 84   },
    { code: "CHM-009", proc: "P03", product: "DRAM", qty: 126  },
    // KrF PR ×7
    { code: "CHM-008", proc: "P03", product: "HBM",  qty: 434  },
    { code: "CHM-008", proc: "P03", product: "DRAM", qty: 574  },
    { code: "CHM-008", proc: "P03", product: "NAND", qty: 840  },
    // HF ×7
    { code: "CHM-001", proc: "P04", product: "HBM",  qty: 665  },
    { code: "CHM-001", proc: "P04", product: "DRAM", qty: 896  },
    { code: "CHM-001", proc: "P04", product: "NAND", qty: 574  },
    // H₂O₂ ×7
    { code: "CHM-002", proc: "P01", product: "HBM",  qty: 1015 },
    { code: "CHM-002", proc: "P04", product: "HBM",  qty: 616  },
    { code: "CHM-002", proc: "P01", product: "DRAM", qty: 1365 },
    { code: "CHM-002", proc: "P04", product: "DRAM", qty: 805  },
    // H₃PO₄ ×7
    { code: "CHM-006", proc: "P04", product: "NAND", qty: 1470 },
    // CMP Ceria 슬러리 ×7
    { code: "CSM-001", proc: "P07", product: "HBM",  qty: 1995 },
    { code: "CSM-001", proc: "P07", product: "DRAM", qty: 1470 },
    { code: "CSM-001", proc: "P07", product: "NAND", qty: 665  },
    // CMP Silica 슬러리 (W) ×7
    { code: "CSM-002", proc: "P07", product: "HBM",  qty: 1365 },
    { code: "CSM-002", proc: "P07", product: "DRAM", qty: 1715 },
    { code: "CSM-002", proc: "P07", product: "NAND", qty: 2660 },
    // CMP Cu 슬러리 ×7
    { code: "CSM-003", proc: "P07", product: "HBM",  qty: 1176 },
    { code: "CSM-003", proc: "P07", product: "DRAM", qty: 924  },
    // CMP 패드 ×7
    { code: "CSM-004", proc: "P07", product: "HBM",  qty: 266  },
    { code: "CSM-004", proc: "P07", product: "DRAM", qty: 196  },
    { code: "CSM-004", proc: "P07", product: "NAND", qty: 84   },
    // PVD Ti 타겟 ×4 (WH-D)
    { code: "CSM-006", proc: "P06", product: "HBM",  qty: 14   },
    { code: "CSM-006", proc: "P06", product: "DRAM", qty: 16.8 },
    { code: "CSM-006", proc: "P06", product: "NAND", qty: 11.2 },
    // Cu ECD ×7
    { code: "CHM-011", proc: "P08", product: "HBM",  qty: 266  },
    // SnAg μBump ×7
    { code: "CSM-012", proc: "P08", product: "HBM",  qty: 126  },
    // Probe Card ×4 (WH-D)
    { code: "CSM-009", proc: "P09", product: "HBM",  qty: 6.0  },
    { code: "CSM-010", proc: "P09", product: "DRAM", qty: 8.0  },
    // WF₆ ×7
    { code: "GAS-007", proc: "P02", product: "NAND", qty: 266  },
    // BDEAS ×7
    { code: "GAS-016", proc: "P02", product: "NAND", qty: 224  },
    // EMC ×7
    { code: "PKG-001", proc: "P10", product: "HBM",  qty: 2940 },
    // 도판트 가스 ×7
    { code: "GAS-021", proc: "P05", product: "DRAM", qty: 294  },
    { code: "GAS-021", proc: "P05", product: "NAND", qty: 385  },
    { code: "GAS-022", proc: "P05", product: "DRAM", qty: 266  },
    { code: "GAS-023", proc: "P05", product: "NAND", qty: 196  },
    { code: "GAS-024", proc: "P05", product: "HBM",  qty: 126  },
    // 식각 특수가스 ×7
    { code: "GAS-025", proc: "P04", product: "NAND", qty: 476  },
    { code: "GAS-026", proc: "P04", product: "DRAM", qty: 364  },
    // 세정·EBR ×7
    { code: "CHM-013", proc: "P07", product: "HBM",  qty: 434  },
    { code: "CHM-012", proc: "P03", product: "DRAM", qty: 336  },
    // HBM 패키징 ×7
    { code: "CSM-014", proc: "P10", product: "HBM",  qty: 245  },
    { code: "PKG-002", proc: "P10", product: "HBM",  qty: 1260 },
    // GAS-002 H₂ ×7
    { code: "GAS-002", proc: "P07", product: "HBM",  qty: 1610 },
    { code: "GAS-002", proc: "P07", product: "DRAM", qty: 2079 },
    { code: "GAS-002", proc: "P07", product: "NAND", qty: 931  },
    // GAS-003 Ar ×7
    { code: "GAS-003", proc: "P06", product: "HBM",  qty: 4046 },
    { code: "GAS-003", proc: "P06", product: "DRAM", qty: 5194 },
    { code: "GAS-003", proc: "P06", product: "NAND", qty: 2310 },
    // GAS-004 SiH₄ ×7
    { code: "GAS-004", proc: "P02", product: "HBM",  qty: 630  },
    { code: "GAS-004", proc: "P02", product: "DRAM", qty: 1134 },
    { code: "GAS-004", proc: "P02", product: "NAND", qty: 756  },
    // GAS-005 NH₃ ×7
    { code: "GAS-005", proc: "P02", product: "DRAM", qty: 574  },
    { code: "GAS-005", proc: "P02", product: "NAND", qty: 854  },
    // GAS-006 NF₃ ×7
    { code: "GAS-006", proc: "P02", product: "HBM",  qty: 259  },
    { code: "GAS-006", proc: "P02", product: "DRAM", qty: 329  },
    { code: "GAS-006", proc: "P02", product: "NAND", qty: 147  },
    // GAS-008 O₂ ×7
    { code: "GAS-008", proc: "P01", product: "HBM",  qty: 2800 },
    { code: "GAS-008", proc: "P01", product: "DRAM", qty: 3584 },
    { code: "GAS-008", proc: "P01", product: "NAND", qty: 1596 },
    // GAS-009 CO₂ ×7
    { code: "GAS-009", proc: "P03", product: "HBM",  qty: 1512 },
    { code: "GAS-009", proc: "P03", product: "DRAM", qty: 1512 },
    { code: "GAS-009", proc: "P03", product: "NAND", qty: 756  },
    // GAS-010 He ×7
    { code: "GAS-010", proc: "P05", product: "HBM",  qty: 329  },
    { code: "GAS-010", proc: "P05", product: "DRAM", qty: 427  },
    { code: "GAS-010", proc: "P05", product: "NAND", qty: 189  },
    // GAS-011 CF₄ ×7
    { code: "GAS-011", proc: "P04", product: "HBM",  qty: 308  },
    { code: "GAS-011", proc: "P04", product: "DRAM", qty: 399  },
    { code: "GAS-011", proc: "P04", product: "NAND", qty: 175  },
    // GAS-012 SF₆ ×7
    { code: "GAS-012", proc: "P04", product: "DRAM", qty: 252  },
    { code: "GAS-012", proc: "P04", product: "NAND", qty: 378  },
    // GAS-013 Cl₂ ×7
    { code: "GAS-013", proc: "P04", product: "HBM",  qty: 203  },
    { code: "GAS-013", proc: "P04", product: "DRAM", qty: 266  },
    { code: "GAS-013", proc: "P04", product: "NAND", qty: 119  },
    // GAS-014 TEOS ×7
    { code: "GAS-014", proc: "P02", product: "HBM",  qty: 665  },
    { code: "GAS-014", proc: "P02", product: "DRAM", qty: 847  },
    { code: "GAS-014", proc: "P02", product: "NAND", qty: 378  },
    // GAS-015 DCS ×7
    { code: "GAS-015", proc: "P02", product: "DRAM", qty: 518  },
    { code: "GAS-015", proc: "P02", product: "NAND", qty: 637  },
    // GAS-017 TiCl₄ ×7
    { code: "GAS-017", proc: "P06", product: "HBM",  qty: 238  },
    { code: "GAS-017", proc: "P06", product: "DRAM", qty: 301  },
    { code: "GAS-017", proc: "P06", product: "NAND", qty: 133  },
    // GAS-018 TDMAT ×7
    { code: "GAS-018", proc: "P07", product: "HBM",  qty: 203  },
    { code: "GAS-018", proc: "P07", product: "DRAM", qty: 112  },
    // GAS-019 TEMAHf ×7
    { code: "GAS-019", proc: "P01", product: "DRAM", qty: 112  },
    { code: "GAS-019", proc: "P01", product: "HBM",  qty: 56   },
    // GAS-020 DIPAS ×7
    { code: "GAS-020", proc: "P04", product: "HBM",  qty: 91   },
    { code: "GAS-020", proc: "P04", product: "DRAM", qty: 140  },
    // CHM-003 H₂SO₄ ×7
    { code: "CHM-003", proc: "P03", product: "HBM",  qty: 1323 },
    { code: "CHM-003", proc: "P03", product: "DRAM", qty: 1701 },
    { code: "CHM-003", proc: "P03", product: "NAND", qty: 756  },
    // CHM-004 NH₄OH ×7
    { code: "CHM-004", proc: "P03", product: "HBM",  qty: 882  },
    { code: "CHM-004", proc: "P03", product: "DRAM", qty: 1134 },
    { code: "CHM-004", proc: "P03", product: "NAND", qty: 504  },
    // CHM-005 HCl ×7
    { code: "CHM-005", proc: "P03", product: "HBM",  qty: 735  },
    { code: "CHM-005", proc: "P03", product: "DRAM", qty: 945  },
    { code: "CHM-005", proc: "P03", product: "NAND", qty: 420  },
    // CHM-010 TMAH ×7
    { code: "CHM-010", proc: "P03", product: "HBM",  qty: 427  },
    { code: "CHM-010", proc: "P03", product: "DRAM", qty: 546  },
    { code: "CHM-010", proc: "P03", product: "NAND", qty: 245  },
    // CSM-005 CMP 컨디셔너 디스크 ×7
    { code: "CSM-005", proc: "P07", product: "HBM",  qty: 105  },
    { code: "CSM-005", proc: "P07", product: "DRAM", qty: 133  },
    { code: "CSM-005", proc: "P07", product: "NAND", qty: 56   },
    // CSM-007 PVD W 타겟 ×4 (WH-D)
    { code: "CSM-007", proc: "P06", product: "HBM",  qty: 16.8 },
    { code: "CSM-007", proc: "P06", product: "DRAM", qty: 21.6 },
    { code: "CSM-007", proc: "P06", product: "NAND", qty: 9.6  },
    // CSM-008 PVD TiN 타겟 ×4 (WH-D)
    { code: "CSM-008", proc: "P06", product: "HBM",  qty: 14   },
    { code: "CSM-008", proc: "P06", product: "DRAM", qty: 18   },
    { code: "CSM-008", proc: "P06", product: "NAND", qty: 8.0  },
    // CSM-011 PR 스트리퍼 ×7
    { code: "CSM-011", proc: "P03", product: "HBM",  qty: 700  },
    { code: "CSM-011", proc: "P03", product: "DRAM", qty: 896  },
    { code: "CSM-011", proc: "P03", product: "NAND", qty: 399  },
    // CSM-013 백그라인딩 테이프 ×7
    { code: "CSM-013", proc: "P08", product: "HBM",  qty: 511  },
    { code: "CSM-013", proc: "P08", product: "DRAM", qty: 224  },
    // CSM-015 석영 파츠 ×4 (WH-D)
    { code: "CSM-015", proc: "P04", product: "HBM",  qty: 16.8 },
    { code: "CSM-015", proc: "P04", product: "DRAM", qty: 21.6 },
    { code: "CSM-015", proc: "P04", product: "NAND", qty: 9.6  },
  ];

  await col("processUsage").insertMany(
    processUsageData
      .filter((pu) => materials[pu.code])
      .map((pu) => ({
        _id: `${pu.code}__${pu.proc}__${pu.product}`,
        materialId: pu.code, processCode: pu.proc, product: pu.product, monthlyQty: pu.qty,
      }))
  );
  console.log(`✅ ProcessUsage: ${processUsageData.length}건`);

  // 운영 시작 재고 기준: 공정 사용량 스케일과 동일한 ROP 기간을 확보한다.
  // 초기 현재고는 최소 안전재고 + 1일 수요 이상이며, ROP가 더 크면 ROP 수요를 적용한다.
  const materialDefMap = new Map(materialDefs.map(def => [def.code, def]));
  const monthlyUsageByMaterial = new Map<string, number>();
  for (const usage of processUsageData) monthlyUsageByMaterial.set(usage.code, (monthlyUsageByMaterial.get(usage.code) ?? 0) + usage.qty);
  for (const inv of inventoryData) {
    const material = materialDefMap.get(inv.code);
    if (!material || material.ropDays <= 0) continue;
    const dailyUsage = (monthlyUsageByMaterial.get(inv.code) ?? inv.daily * 30) / 30;
    const openingQuantity = Math.ceil(Math.max(inv.qty, material.safetyStock + dailyUsage, dailyUsage * material.ropDays));
    await col("inventory").updateOne({ _id: `${inv.code}__${inv.whCode}` }, {
      $set: { quantity: openingQuantity, avgDailyUsage: dailyUsage,
        capacityLimit: Math.ceil(openingQuantity / 0.68), updatedAt: new Date() },
    });
  }
  console.log("✅ Inventory opening baseline: safety stock + ROP demand");

  // ─── 7. Lot 초기 데이터 ────────────────────────────────────
  await db.collection("inventoryLots").deleteMany({});

  const now = new Date("2026-07-13");
  const d = (daysOffset: number) => new Date(now.getTime() + daysOffset * 86400000);

  const lotsData = [
    // CHM-007 ArF PR — 유효기간 촉박한 Lot 먼저 (FEFO 시연)
    { _id: "LOT-CHM007-001", materialId: "CHM-007", lotNo: "LOT-CHM007-001", warehouseId: "MWH-01", quantity: 60, availableQuantity: 60, receivedAt: d(-30), manufactureDate: d(-45), expiryDate: d(25), qualityStatus: "AVAILABLE", updatedAt: now },
    { _id: "LOT-CHM007-002", materialId: "CHM-007", lotNo: "LOT-CHM007-002", warehouseId: "MWH-01", quantity: 48, availableQuantity: 48, receivedAt: d(-10), manufactureDate: d(-20), expiryDate: d(55), qualityStatus: "AVAILABLE", updatedAt: now },
    { _id: "LOT-CHM007-003", materialId: "CHM-007", lotNo: "LOT-CHM007-003", warehouseId: "MWH-01", quantity: 36, availableQuantity: 36, receivedAt: d(0),   manufactureDate: d(-5),  expiryDate: d(88), qualityStatus: "AVAILABLE", updatedAt: now },
    // CHM-009 EUV PR — 유효기간 짧음
    { _id: "LOT-CHM009-001", materialId: "CHM-009", lotNo: "LOT-CHM009-001", warehouseId: "MWH-01", quantity: 12, availableQuantity: 12, receivedAt: d(-20), manufactureDate: d(-30), expiryDate: d(18), qualityStatus: "AVAILABLE", updatedAt: now },
    { _id: "LOT-CHM009-002", materialId: "CHM-009", lotNo: "LOT-CHM009-002", warehouseId: "MWH-01", quantity: 18, availableQuantity: 18, receivedAt: d(-5),  manufactureDate: d(-10), expiryDate: d(45), qualityStatus: "AVAILABLE", updatedAt: now },
    // CHM-001 HF
    { _id: "LOT-CHM001-001", materialId: "CHM-001", lotNo: "LOT-CHM001-001", warehouseId: "HZW-01", quantity: 70, availableQuantity: 70, receivedAt: d(-15), expiryDate: d(90),  qualityStatus: "AVAILABLE", updatedAt: now },
    { _id: "LOT-CHM001-002", materialId: "CHM-001", lotNo: "LOT-CHM001-002", warehouseId: "HZW-01", quantity: 58, availableQuantity: 58, receivedAt: d(-5),  expiryDate: d(120), qualityStatus: "AVAILABLE", updatedAt: now },
    // GAS-019 TEMAHf 전구체 — 리드타임 45일
    { _id: "LOT-GAS019-001", materialId: "GAS-019", lotNo: "LOT-GAS019-001", warehouseId: "PRS-01", quantity: 10, availableQuantity: 10, receivedAt: d(-40), expiryDate: d(30),  qualityStatus: "AVAILABLE", updatedAt: now },
    { _id: "LOT-GAS019-002", materialId: "GAS-019", lotNo: "LOT-GAS019-002", warehouseId: "PRS-01", quantity: 8,  availableQuantity: 8,  receivedAt: d(-10), expiryDate: d(80),  qualityStatus: "AVAILABLE", updatedAt: now },
    // GAS-016 BDEAS
    { _id: "LOT-GAS016-001", materialId: "GAS-016", lotNo: "LOT-GAS016-001", warehouseId: "PRS-01", quantity: 18, availableQuantity: 18, receivedAt: d(-20), expiryDate: d(40),  qualityStatus: "AVAILABLE", updatedAt: now },
    { _id: "LOT-GAS016-002", materialId: "GAS-016", lotNo: "LOT-GAS016-002", warehouseId: "PRS-01", quantity: 14, availableQuantity: 14, receivedAt: d(-5),  expiryDate: d(95),  qualityStatus: "AVAILABLE", updatedAt: now },
    // PKG-001 EMC — 유효기간 없음 (FIFO)
    { _id: "LOT-PKG001-001", materialId: "PKG-001", lotNo: "LOT-PKG001-001", warehouseId: "MWH-02", quantity: 3000, availableQuantity: 3000, receivedAt: d(-60), qualityStatus: "AVAILABLE", updatedAt: now },
    { _id: "LOT-PKG001-002", materialId: "PKG-001", lotNo: "LOT-PKG001-002", warehouseId: "MWH-02", quantity: 7660, availableQuantity: 7660, receivedAt: d(-20), qualityStatus: "AVAILABLE", updatedAt: now },
  ];

  await db.collection("inventoryLots").insertMany(lotsData as never[]);
  console.log(`✅ InventoryLots: ${lotsData.length}건`);

  // ─── 8. 공급업체 매핑 ───────────────────────────────────────
  const supplyLinks = [
    { matCode: "GAS-001", supId: "sup-airproducts", days: 3,  primary: true  },
    { matCode: "GAS-001", supId: "sup-skg",         days: 5,  primary: false },
    { matCode: "GAS-002", supId: "sup-skg",         days: 5,  primary: true  },
    { matCode: "GAS-003", supId: "sup-airproducts", days: 3,  primary: true  },
    { matCode: "GAS-004", supId: "sup-skg",         days: 14, primary: true  },
    { matCode: "GAS-005", supId: "sup-lindekorea",  days: 14, primary: true  },
    { matCode: "GAS-006", supId: "sup-lindekorea",  days: 21, primary: true  },
    { matCode: "GAS-007", supId: "sup-lindekorea",  days: 21, primary: true  },
    { matCode: "GAS-008", supId: "sup-airproducts", days: 3,  primary: true  },
    { matCode: "GAS-010", supId: "sup-airproducts", days: 21, primary: true  },
    { matCode: "GAS-014", supId: "sup-mks",         days: 14, primary: true  },
    { matCode: "GAS-016", supId: "sup-sumitomo",    days: 30, primary: true  },
    { matCode: "GAS-018", supId: "sup-mks",         days: 30, primary: true  },
    { matCode: "GAS-019", supId: "sup-mks",         days: 45, primary: true  },
    { matCode: "CHM-001", supId: "sup-soulbrain",   days: 10, primary: true  },
    { matCode: "CHM-002", supId: "sup-soulbrain",   days: 7,  primary: true  },
    { matCode: "CHM-003", supId: "sup-soulbrain",   days: 7,  primary: true  },
    { matCode: "CHM-007", supId: "sup-duksan",      days: 14, primary: true  },
    { matCode: "CHM-007", supId: "sup-jsr",         days: 21, primary: false },
    { matCode: "CHM-008", supId: "sup-duksan",      days: 14, primary: true  },
    { matCode: "CHM-009", supId: "sup-jsr",         days: 45, primary: true  },
    { matCode: "CHM-011", supId: "sup-atotech",     days: 21, primary: true  },
    { matCode: "CSM-001", supId: "sup-cmi",         days: 10, primary: true  },
    { matCode: "CSM-001", supId: "sup-cabot",       days: 12, primary: false },
    { matCode: "CSM-002", supId: "sup-cabot",       days: 10, primary: true  },
    { matCode: "CSM-003", supId: "sup-cmi",         days: 14, primary: true  },
    { matCode: "CSM-004", supId: "sup-cabot",       days: 14, primary: true  },
    { matCode: "CSM-006", supId: "sup-tokai",       days: 30, primary: true  },
    { matCode: "CSM-007", supId: "sup-tokai",       days: 30, primary: true  },
    { matCode: "CSM-008", supId: "sup-tokai",       days: 30, primary: true  },
    { matCode: "CSM-009", supId: "sup-formfactor",  days: 45, primary: true  },
    { matCode: "CSM-010", supId: "sup-formfactor",  days: 45, primary: true  },
    { matCode: "CSM-012", supId: "sup-alpha",       days: 30, primary: true  },
  ];

  await col("materialSuppliers").insertMany(
    supplyLinks
      .filter((sl) => materials[sl.matCode])
      .map((sl) => ({
        _id: `${sl.matCode}__${sl.supId}`,
        materialId: sl.matCode, supplierId: sl.supId, leadTimeDays: sl.days, isPrimary: sl.primary,
        standardLeadTimeDays: sl.days, qualificationStatus: "APPROVED",
        sourcingRole: sl.primary ? "PRIMARY" : "SECONDARY", emergencyOrderAllowed: false,
      }))
  );
  console.log(`✅ SupplyLinks: ${supplyLinks.length}건`);

  // ─── 9. 인프라 교체주기 ─────────────────────────────────────
  const infraItems = [
    { name: "CMP 패드 (IC1000) — P07 라인 A", processCode: "P07", unit: "run", replacementCriteria: 1500, currentUsage: 1120, lastReplacedAt: new Date("2026-05-02"), notes: "잔여 380 run, 약 8일 후 교체 예상" },
    { name: "CMP 패드 (IC1000) — P07 라인 B", processCode: "P07", unit: "run", replacementCriteria: 1500, currentUsage: 240,  lastReplacedAt: new Date("2026-06-18"), notes: "교체 후 정상 운영 중" },
    { name: "PVD Ti 타겟 — P06 챔버 1",       processCode: "P06", unit: "kWh", replacementCriteria: 200,  currentUsage: 168,  lastReplacedAt: new Date("2026-05-14"), notes: "잔여 32 kWh, 약 6일 후 교체 예상" },
    { name: "PVD Ti 타겟 — P06 챔버 2",       processCode: "P06", unit: "kWh", replacementCriteria: 200,  currentUsage: 45,   lastReplacedAt: new Date("2026-06-25"), notes: "정상" },
    { name: "PVD W 타겟 — P06 챔버 3",        processCode: "P06", unit: "kWh", replacementCriteria: 250,  currentUsage: 198,  lastReplacedAt: new Date("2026-05-20"), notes: "잔여 52 kWh, 약 10일 후 교체" },
    { name: "Probe Card HBM — P09 테스터 1",  processCode: "P09", unit: "K touches", replacementCriteria: 250, currentUsage: 218, lastReplacedAt: new Date("2026-04-10"), notes: "잔여 32K, 약 7일. 교체 카드 재고 확인 필요" },
    { name: "Probe Card DRAM — P09 테스터 2", processCode: "P09", unit: "K touches", replacementCriteria: 250, currentUsage: 88,  lastReplacedAt: new Date("2026-06-01"), notes: "정상" },
  ];

  await col("infraEquipment").insertMany(
    infraItems.map((item) => ({
      _id: `infra-${item.name.replace(/\s/g, "-").toLowerCase().slice(0, 30)}`,
      ...item, updatedAt: new Date(),
    }))
  );
  console.log(`✅ InfraEquipment: ${infraItems.length}건`);

  // ─── 10. 리스크 ──────────────────────────────────────────────
  const risks = [
    { title: "EUV 포토레지스트 수급 불안 (JSR — 일본 수출 규제)", level: "HIGH" as const, category: "공급망", owner: "황지훈", status: "Active", description: "CHM-009 EUV PR: 단일 공급사(JSR) 의존도 100%, 리드타임 45일. 수출 규제 재발 시 즉시 생산 차질", mitigation: "국산 PR 대체 테스트 착수(덕산 3세대), 안전재고 2개월분 확보 계획" },
    { title: "C동 위험물창고 Capacity 초과 임박 (91%)", level: "HIGH" as const, category: "창고 운영", owner: "박민준", status: "Active", description: "HF·NH₃ 추가 입고 시 법적 허용 한도 초과 위험. 7월 말 HF 정기 입고 예정과 충돌", mitigation: "HF 입고 분할 (2차 분납), C동 소분 창고 임시 지정 협의 중" },
    { title: "He(헬륨) 글로벌 수급 불안 — 이온주입 라인 리스크", level: "MEDIUM" as const, category: "공급망", owner: "황지훈", status: "Active", description: "글로벌 He 생산 감소로 Air Products 납기 지연 통보. 현 재고 21일치", mitigation: "He 리사이클링 설비 점검, 대체 공급사(린데) 견적 진행 중" },
    { title: "CMP Probe Card HBM 교체 임박 (P09 테스터 1)", level: "MEDIUM" as const, category: "인프라", owner: "박민준", status: "Active", description: "KGD 스크리닝용 Probe Card 잔여 사용량 32K. 약 7일 후 교체 필요. 교체 카드 재고 6장뿐", mitigation: "FormFactor 긴급 발주 진행 (납기 확인 중), 테스터 2 우선 배정 검토" },
  ];

  await col("risks").insertMany(
    risks.map((r) => ({ _id: randomUUID(), ...r }))
  );
  console.log(`✅ Risks: ${risks.length}건`);

  // ─── 11. 업무 일지 ──────────────────────────────────────────
  await col("wikiEntries").insertOne({
    _id: randomUUID(),
    date: new Date("2026-07-08"),
    title: "공정별 사용량 통합 자재 리스트 개편 + VISION.md 작성",
    category: "자동화계획",
    content: "기존 공정별 카드 10개에서 통합 자재 리스트 47종으로 개편.\n품번 체계: GAS-001 형식 (카테고리 + 일련번호, 공정번호 제거).\nGAS/CHM/CSM/UTL/PKG 카테고리 필터 추가.\n제품별 사용량(HBM) 탭 신설 — KGD 스크리닝 강조.\nVISION.md: 5대 개발 원칙 정의.",
    result: "HBM은 CMP 스텝 +1 (TSV Reveal), 금속배선에 Cu Fill ECD + μBump 추가 확인",
    nextAction: "자재 입고 시뮬레이션 UI 착수, 재고·DOH 페이지 실데이터 전환",
    userId: "admin@fab.skh",
    createdAt: new Date(),
  });
  console.log("✅ WikiEntry: 1건");

  console.log("\n🎉 Seed 완료!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📋 계정 목록 (비밀번호: fab1234!)");
  console.log("  ADMIN:      admin@fab.skh      (황지훈 — 전체 접근)");
  console.log("  MATERIALS:  materials@fab.skh  (김재현 — 자재관리팀)");
  console.log("  PRODUCTION: production@fab.skh (이수진 — 생산관리팀)");
  console.log("  LOGISTICS:  logistics@fab.skh  (박민준 — 물류/인프라팀)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main()
  .catch(console.error)
  .finally(() => client.close());
