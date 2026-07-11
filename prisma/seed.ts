import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createAdapter(): any {
  if (process.env.TURSO_DATABASE_URL) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaLibSql } = require("@prisma/adapter-libsql/web");
    return new PrismaLibSql({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
  const dbPath = path.resolve(__dirname, "../dev.db");
  return new PrismaBetterSqlite3({ url: `file:${dbPath}` });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter: createAdapter() } as any);

async function main() {
  console.log("🌱 Seeding FAB Materials System...");

  // ─── 1. 사용자 계정 ───────────────────────────────────────
  const pw = await bcrypt.hash("fab1234!", 10);

  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: "admin@fab.skh" },
      update: {},
      create: { email: "admin@fab.skh", name: "황지훈", password: pw, role: "ADMIN", department: "구매본부 자재관리팀" },
    }),
    prisma.user.upsert({
      where: { email: "materials@fab.skh" },
      update: {},
      create: { email: "materials@fab.skh", name: "김재현", password: pw, role: "MATERIALS", department: "구매본부 자재관리팀" },
    }),
    prisma.user.upsert({
      where: { email: "production@fab.skh" },
      update: {},
      create: { email: "production@fab.skh", name: "이수진", password: pw, role: "PRODUCTION", department: "생산관리팀" },
    }),
    prisma.user.upsert({
      where: { email: "logistics@fab.skh" },
      update: {},
      create: { email: "logistics@fab.skh", name: "박민준", password: pw, role: "LOGISTICS", department: "물류/인프라팀" },
    }),
  ]);
  console.log(`✅ Users: ${users.length}명`);

  // ─── 2. 창고 ───────────────────────────────────────────────
  const warehouses = await Promise.all([
    prisma.warehouse.upsert({
      where: { code: "WH-A" },
      update: {},
      create: {
        code: "WH-A", name: "A동 — 자동화 창고 (AS/RS)", type: "AS_RS",
        totalCapacity: 7000, unit: "pallet",
        temperature: "20~25°C / 습도 45~55%",
        notes: "고층 자동화 창고, WMS 연동, CVD·증착용 케미컬 주 보관",
      },
    }),
    prisma.warehouse.upsert({
      where: { code: "WH-B" },
      update: {},
      create: {
        code: "WH-B", name: "B동 — 평치 창고 (일반)", type: "FLAT",
        totalCapacity: 2600, unit: "pallet",
        temperature: "실온 (10~30°C)",
        notes: "일반 자재, CMP 패드·슬러리 등 소모성 인프라 자재 보관",
      },
    }),
    prisma.warehouse.upsert({
      where: { code: "WH-C" },
      update: {},
      create: {
        code: "WH-C", name: "C동 — 위험물 전용 창고", type: "HAZMAT",
        totalCapacity: 800, unit: "pallet",
        temperature: "15~20°C / 방폭 설비",
        notes: "HF·NH₃·H₂O₂ 등 위험물 보관, 입고 수량 법적 제한",
      },
    }),
    prisma.warehouse.upsert({
      where: { code: "WH-D" },
      update: {},
      create: {
        code: "WH-D", name: "D동 — 공구·MRO 창고", type: "MRO",
        totalCapacity: 2200, unit: "slot",
        temperature: "실온",
        notes: "Probe Card·소모성 공구·교체 부품 보관",
      },
    }),
  ]);
  console.log(`✅ Warehouses: ${warehouses.length}개`);

  // ─── 3. 공급업체 ───────────────────────────────────────────
  const suppliers = await Promise.all([
    prisma.supplier.upsert({ where: { id: "sup-airproducts" }, update: {}, create: { id: "sup-airproducts", name: "Air Products Korea", country: "KR", notes: "N₂·Ar·He 벌크 가스 주 공급사" } }),
    prisma.supplier.upsert({ where: { id: "sup-skg" }, update: {}, create: { id: "sup-skg", name: "SK가스", country: "KR", notes: "H₂·O₂·SiH₄ 공급" } }),
    prisma.supplier.upsert({ where: { id: "sup-lindekorea" }, update: {}, create: { id: "sup-lindekorea", name: "린데코리아", country: "KR", notes: "특수가스 (NF₃·WF₆·NH₃) 공급" } }),
    prisma.supplier.upsert({ where: { id: "sup-soulbrain" }, update: {}, create: { id: "sup-soulbrain", name: "솔브레인", country: "KR", notes: "HF·H₂O₂·BOE 식각액 공급" } }),
    prisma.supplier.upsert({ where: { id: "sup-duksan" }, update: {}, create: { id: "sup-duksan", name: "덕산네오룩스", country: "KR", notes: "포토레지스트 PR 공급" } }),
    prisma.supplier.upsert({ where: { id: "sup-jsr" }, update: {}, create: { id: "sup-jsr", name: "JSR Corporation", country: "JP", notes: "ArF·KrF·EUV 포토레지스트 (일본 의존도 高)" } }),
    prisma.supplier.upsert({ where: { id: "sup-cmi" }, update: {}, create: { id: "sup-cmi", name: "CMC Materials (Entegris)", country: "US", notes: "CMP 슬러리 (Ceria·Silica) 공급" } }),
    prisma.supplier.upsert({ where: { id: "sup-cabot" }, update: {}, create: { id: "sup-cabot", name: "Cabot Microelectronics", country: "US", notes: "CMP 슬러리·패드 공급" } }),
    prisma.supplier.upsert({ where: { id: "sup-tokai" }, update: {}, create: { id: "sup-tokai", name: "Tokai Carbon", country: "JP", notes: "PVD 타겟 (Ti·TiN·W) 공급" } }),
    prisma.supplier.upsert({ where: { id: "sup-mks" }, update: {}, create: { id: "sup-mks", name: "MKS Korea", country: "KR", notes: "TEOS·HMDSO CVD 전구체 공급" } }),
    prisma.supplier.upsert({ where: { id: "sup-sumitomo" }, update: {}, create: { id: "sup-sumitomo", name: "Sumitomo Chemical", country: "JP", notes: "Si₃N₄ 전구체 (BDEAS) 공급" } }),
    prisma.supplier.upsert({ where: { id: "sup-formfactor" }, update: {}, create: { id: "sup-formfactor", name: "FormFactor Korea", country: "KR", notes: "Probe Card 공급 (웨이퍼 테스트용)" } }),
    prisma.supplier.upsert({ where: { id: "sup-atotech" }, update: {}, create: { id: "sup-atotech", name: "Atotech (MKS)", country: "DE", notes: "Cu ECD 도금액 (TSV Fill) 공급" } }),
    prisma.supplier.upsert({ where: { id: "sup-alpha" }, update: {}, create: { id: "sup-alpha", name: "Alpha Assembly Solutions", country: "US", notes: "SnAg μBump 솔더 공급 (HBM 전용)" } }),
  ]);
  console.log(`✅ Suppliers: ${suppliers.length}개`);

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
  ];

  const materials: Record<string, { id: string }> = {};
  for (const def of materialDefs) {
    const mat = await prisma.material.upsert({
      where: { code: def.code },
      update: {},
      create: def as Parameters<typeof prisma.material.create>[0]["data"],
    });
    materials[def.code] = mat;
  }
  console.log(`✅ Materials: ${materialDefs.length}종`);

  // ─── 5. 재고 (현재고 + 일평균사용량) ──────────────────────
  const inventoryData = [
    // GAS — A동 자동화창고
    { code: "GAS-001", whCode: "WH-A", qty: 2800, daily: 180 },
    { code: "GAS-002", whCode: "WH-A", qty: 340,  daily: 22  },
    { code: "GAS-003", whCode: "WH-A", qty: 920,  daily: 55  },
    { code: "GAS-004", whCode: "WH-A", qty: 210,  daily: 12  },
    { code: "GAS-008", whCode: "WH-A", qty: 580,  daily: 38  },
    { code: "GAS-009", whCode: "WH-A", qty: 280,  daily: 18  },
    { code: "GAS-010", whCode: "WH-A", qty: 95,   daily: 4.5 },
    { code: "GAS-014", whCode: "WH-A", qty: 140,  daily: 9   },
    { code: "GAS-015", whCode: "WH-A", qty: 88,   daily: 5.5 },
    { code: "GAS-016", whCode: "WH-A", qty: 32,   daily: 1.8 },
    { code: "GAS-017", whCode: "WH-A", qty: 55,   daily: 3.2 },
    { code: "GAS-018", whCode: "WH-A", qty: 28,   daily: 1.5 },
    { code: "GAS-019", whCode: "WH-A", qty: 18,   daily: 0.8 },
    { code: "GAS-020", whCode: "WH-A", qty: 22,   daily: 1.1 },
    // GAS 위험물 — C동
    { code: "GAS-005", whCode: "WH-C", qty: 72,   daily: 6.8 },
    { code: "GAS-006", whCode: "WH-C", qty: 45,   daily: 3.5 },
    { code: "GAS-007", whCode: "WH-C", qty: 28,   daily: 2.1 },
    { code: "GAS-011", whCode: "WH-C", qty: 58,   daily: 4.2 },
    { code: "GAS-012", whCode: "WH-C", qty: 42,   daily: 3.0 },
    { code: "GAS-013", whCode: "WH-C", qty: 38,   daily: 2.8 },
    // CHM — A동
    { code: "CHM-007", whCode: "WH-A", qty: 145,  daily: 8.5 },
    { code: "CHM-008", whCode: "WH-A", qty: 92,   daily: 6.2 },
    { code: "CHM-009", whCode: "WH-A", qty: 22,   daily: 1.2 },
    { code: "CHM-010", whCode: "WH-A", qty: 78,   daily: 5.8 },
    { code: "CHM-011", whCode: "WH-A", qty: 38,   daily: 2.2 },
    // CHM 위험물 — C동
    { code: "CHM-001", whCode: "WH-C", qty: 128,  daily: 14  },
    { code: "CHM-002", whCode: "WH-C", qty: 165,  daily: 22  },
    { code: "CHM-003", whCode: "WH-C", qty: 142,  daily: 18  },
    { code: "CHM-004", whCode: "WH-C", qty: 98,   daily: 12  },
    { code: "CHM-005", whCode: "WH-C", qty: 82,   daily: 10  },
    { code: "CHM-006", whCode: "WH-C", qty: 65,   daily: 7.5 },
    // CSM — B동
    { code: "CSM-001", whCode: "WH-B", qty: 420,  daily: 28  },
    { code: "CSM-002", whCode: "WH-B", qty: 380,  daily: 24  },
    { code: "CSM-003", whCode: "WH-B", qty: 255,  daily: 16  },
    { code: "CSM-004", whCode: "WH-B", qty: 95,   daily: 1.4 },
    { code: "CSM-005", whCode: "WH-B", qty: 52,   daily: 1.4 },
    { code: "CSM-011", whCode: "WH-B", qty: 145,  daily: 9.5 },
    { code: "CSM-012", whCode: "WH-B", qty: 18,   daily: 0.8 },
    { code: "CSM-013", whCode: "WH-B", qty: 62,   daily: 3.5 },
    // CSM MRO — D동
    { code: "CSM-006", whCode: "WH-D", qty: 14,   daily: 0.48 },
    { code: "CSM-007", whCode: "WH-D", qty: 11,   daily: 0.38 },
    { code: "CSM-008", whCode: "WH-D", qty: 9,    daily: 0.32 },
    { code: "CSM-009", whCode: "WH-D", qty: 6,    daily: 0.18 },
    { code: "CSM-010", whCode: "WH-D", qty: 8,    daily: 0.22 },
    // UTL·PKG
    { code: "UTL-001", whCode: "WH-A", qty: 0,    daily: 5000 },
    { code: "UTL-002", whCode: "WH-A", qty: 95,   daily: 6.5  },
    { code: "PKG-001", whCode: "WH-B", qty: 820,  daily: 52   },
  ];

  const warehouseMap: Record<string, string> = {};
  for (const wh of warehouses) {
    warehouseMap[(wh as { code: string; id: string }).code] = (wh as { code: string; id: string }).id;
  }

  for (const inv of inventoryData) {
    const matId = materials[inv.code]?.id;
    const whId  = warehouseMap[inv.whCode];
    if (!matId || !whId) continue;
    await prisma.inventory.upsert({
      where: { materialId_warehouseId: { materialId: matId, warehouseId: whId } },
      update: { quantity: inv.qty, avgDailyUsage: inv.daily },
      create: { materialId: matId, warehouseId: whId, quantity: inv.qty, avgDailyUsage: inv.daily },
    });
  }
  console.log(`✅ Inventory: ${inventoryData.length}건`);

  // ─── 6. 공정별 사용량 (Product × Process × Material) ──────
  // HBM 월 사용량 = 전체의 약 35%, DRAM 45%, NAND 20% 기준 추산
  const processUsageData = [
    // N₂ — 전 공정 (HBM)
    { code: "GAS-001", proc: "P01", product: "HBM",  qty: 1680 },
    { code: "GAS-001", proc: "P02", product: "HBM",  qty: 2100 },
    { code: "GAS-001", proc: "P03", product: "HBM",  qty: 980  },
    { code: "GAS-001", proc: "P07", product: "HBM",  qty: 840  },
    { code: "GAS-001", proc: "P08", product: "HBM",  qty: 1260 },
    // N₂ — DRAM
    { code: "GAS-001", proc: "P01", product: "DRAM", qty: 2200 },
    { code: "GAS-001", proc: "P02", product: "DRAM", qty: 2800 },
    { code: "GAS-001", proc: "P03", product: "DRAM", qty: 1200 },
    { code: "GAS-001", proc: "P07", product: "DRAM", qty: 1100 },
    // N₂ — NAND
    { code: "GAS-001", proc: "P02", product: "NAND", qty: 1200 },
    { code: "GAS-001", proc: "P04", product: "NAND", qty: 900  },
    // ArF PR — 포토 공정
    { code: "CHM-007", proc: "P03", product: "HBM",  qty: 85  },
    { code: "CHM-007", proc: "P03", product: "DRAM", qty: 112 },
    { code: "CHM-007", proc: "P03", product: "NAND", qty: 48  },
    // EUV PR
    { code: "CHM-009", proc: "P03", product: "HBM",  qty: 12  },
    { code: "CHM-009", proc: "P03", product: "DRAM", qty: 18  },
    // KrF PR
    { code: "CHM-008", proc: "P03", product: "HBM",  qty: 62  },
    { code: "CHM-008", proc: "P03", product: "DRAM", qty: 82  },
    { code: "CHM-008", proc: "P03", product: "NAND", qty: 120 },
    // HF
    { code: "CHM-001", proc: "P04", product: "HBM",  qty: 95  },
    { code: "CHM-001", proc: "P04", product: "DRAM", qty: 128 },
    { code: "CHM-001", proc: "P04", product: "NAND", qty: 82  },
    // H₂O₂
    { code: "CHM-002", proc: "P01", product: "HBM",  qty: 145 },
    { code: "CHM-002", proc: "P04", product: "HBM",  qty: 88  },
    { code: "CHM-002", proc: "P01", product: "DRAM", qty: 195 },
    { code: "CHM-002", proc: "P04", product: "DRAM", qty: 115 },
    // H₃PO₄ — NAND ONO
    { code: "CHM-006", proc: "P04", product: "NAND", qty: 210 },
    // CMP Ceria 슬러리
    { code: "CSM-001", proc: "P07", product: "HBM",  qty: 285 },  // TSV Reveal +18%
    { code: "CSM-001", proc: "P07", product: "DRAM", qty: 210 },
    { code: "CSM-001", proc: "P07", product: "NAND", qty: 95  },
    // CMP Silica 슬러리 (W)
    { code: "CSM-002", proc: "P07", product: "HBM",  qty: 195 },
    { code: "CSM-002", proc: "P07", product: "DRAM", qty: 245 },
    { code: "CSM-002", proc: "P07", product: "NAND", qty: 380 },  // NAND 워드라인
    // CMP Cu 슬러리
    { code: "CSM-003", proc: "P07", product: "HBM",  qty: 168 },
    { code: "CSM-003", proc: "P07", product: "DRAM", qty: 132 },
    // CMP 패드
    { code: "CSM-004", proc: "P07", product: "HBM",  qty: 38 },
    { code: "CSM-004", proc: "P07", product: "DRAM", qty: 28 },
    { code: "CSM-004", proc: "P07", product: "NAND", qty: 12 },
    // PVD Ti 타겟
    { code: "CSM-006", proc: "P06", product: "HBM",  qty: 3.5 },
    { code: "CSM-006", proc: "P06", product: "DRAM", qty: 4.2 },
    { code: "CSM-006", proc: "P06", product: "NAND", qty: 2.8 },
    // Cu ECD (HBM 전용 — TSV Fill)
    { code: "CHM-011", proc: "P08", product: "HBM",  qty: 38 },
    // SnAg μBump (HBM 전용)
    { code: "CSM-012", proc: "P08", product: "HBM",  qty: 18 },
    // Probe Card HBM
    { code: "CSM-009", proc: "P09", product: "HBM",  qty: 1.5 },
    // Probe Card DRAM
    { code: "CSM-010", proc: "P09", product: "DRAM", qty: 2.0 },
    // WF₆ — NAND W CVD
    { code: "GAS-007", proc: "P02", product: "NAND", qty: 38 },
    // BDEAS — NAND ONO ALD
    { code: "GAS-016", proc: "P02", product: "NAND", qty: 32 },
    // EMC — HBM 패키징
    { code: "PKG-001", proc: "P10", product: "HBM",  qty: 420 },
  ];

  for (const pu of processUsageData) {
    const matId = materials[pu.code]?.id;
    if (!matId) continue;
    await prisma.processUsage.upsert({
      where: { materialId_processCode_product: { materialId: matId, processCode: pu.proc, product: pu.product as "HBM" | "DRAM" | "NAND" } },
      update: { monthlyQty: pu.qty },
      create: { materialId: matId, processCode: pu.proc, product: pu.product as "HBM" | "DRAM" | "NAND", monthlyQty: pu.qty },
    });
  }
  console.log(`✅ ProcessUsage: ${processUsageData.length}건`);

  // ─── 7. 공급업체 매핑 ───────────────────────────────────────
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

  for (const sl of supplyLinks) {
    const matId = materials[sl.matCode]?.id;
    if (!matId) continue;
    await prisma.materialSupplier.upsert({
      where: { materialId_supplierId: { materialId: matId, supplierId: sl.supId } },
      update: {},
      create: { materialId: matId, supplierId: sl.supId, leadTimeDays: sl.days, isPrimary: sl.primary },
    });
  }
  console.log(`✅ SupplyLinks: ${supplyLinks.length}건`);

  // ─── 8. 인프라 교체주기 ─────────────────────────────────────
  const infraItems = [
    { name: "CMP 패드 (IC1000) — P07 라인 A", processCode: "P07", unit: "run", replacementCriteria: 1500, currentUsage: 1120, lastReplacedAt: new Date("2026-05-02"), notes: "잔여 380 run, 약 8일 후 교체 예상" },
    { name: "CMP 패드 (IC1000) — P07 라인 B", processCode: "P07", unit: "run", replacementCriteria: 1500, currentUsage: 240,  lastReplacedAt: new Date("2026-06-18"), notes: "교체 후 정상 운영 중" },
    { name: "PVD Ti 타겟 — P06 챔버 1",       processCode: "P06", unit: "kWh", replacementCriteria: 200,  currentUsage: 168,  lastReplacedAt: new Date("2026-05-14"), notes: "잔여 32 kWh, 약 6일 후 교체 예상" },
    { name: "PVD Ti 타겟 — P06 챔버 2",       processCode: "P06", unit: "kWh", replacementCriteria: 200,  currentUsage: 45,   lastReplacedAt: new Date("2026-06-25"), notes: "정상" },
    { name: "PVD W 타겟 — P06 챔버 3",        processCode: "P06", unit: "kWh", replacementCriteria: 250,  currentUsage: 198,  lastReplacedAt: new Date("2026-05-20"), notes: "잔여 52 kWh, 약 10일 후 교체" },
    { name: "Probe Card HBM — P09 테스터 1",  processCode: "P09", unit: "K touches", replacementCriteria: 250, currentUsage: 218, lastReplacedAt: new Date("2026-04-10"), notes: "잔여 32K, 약 7일. 교체 카드 재고 확인 필요" },
    { name: "Probe Card DRAM — P09 테스터 2", processCode: "P09", unit: "K touches", replacementCriteria: 250, currentUsage: 88,  lastReplacedAt: new Date("2026-06-01"), notes: "정상" },
  ];

  for (const item of infraItems) {
    await prisma.infraEquipment.upsert({
      where: { id: `infra-${item.name.replace(/\s/g, "-").toLowerCase().slice(0, 30)}` },
      update: { currentUsage: item.currentUsage },
      create: { id: `infra-${item.name.replace(/\s/g, "-").toLowerCase().slice(0, 30)}`, ...item },
    });
  }
  console.log(`✅ InfraEquipment: ${infraItems.length}건`);

  // ─── 9. 리스크 ──────────────────────────────────────────────
  const risks = [
    { title: "EUV 포토레지스트 수급 불안 (JSR — 일본 수출 규제)", level: "HIGH" as const, category: "공급망", owner: "황지훈", status: "Active", description: "CHM-009 EUV PR: 단일 공급사(JSR) 의존도 100%, 리드타임 45일. 수출 규제 재발 시 즉시 생산 차질", mitigation: "국산 PR 대체 테스트 착수(덕산 3세대), 안전재고 2개월분 확보 계획" },
    { title: "C동 위험물창고 Capacity 초과 임박 (91%)", level: "HIGH" as const, category: "창고 운영", owner: "박민준", status: "Active", description: "HF·NH₃ 추가 입고 시 법적 허용 한도 초과 위험. 7월 말 HF 정기 입고 예정과 충돌", mitigation: "HF 입고 분할 (2차 분납), C동 소분 창고 임시 지정 협의 중" },
    { title: "He(헬륨) 글로벌 수급 불안 — 이온주입 라인 리스크", level: "MEDIUM" as const, category: "공급망", owner: "황지훈", status: "Active", description: "글로벌 He 생산 감소로 Air Products 납기 지연 통보. 현 재고 21일치", mitigation: "He 리사이클링 설비 점검, 대체 공급사(린데) 견적 진행 중" },
    { title: "CMP Probe Card HBM 교체 임박 (P09 테스터 1)", level: "MEDIUM" as const, category: "인프라", owner: "박민준", status: "Active", description: "KGD 스크리닝용 Probe Card 잔여 사용량 32K. 약 7일 후 교체 필요. 교체 카드 재고 6장뿐", mitigation: "FormFactor 긴급 발주 진행 (납기 확인 중), 테스터 2 우선 배정 검토" },
  ];

  for (const risk of risks) {
    await prisma.risk.create({ data: risk }).catch(() => {});
  }
  console.log(`✅ Risks: ${risks.length}건`);

  // ─── 10. 업무 일지 ──────────────────────────────────────────
  const admin = users[0];
  await prisma.wikiEntry.create({
    data: {
      date: new Date("2026-07-08"),
      title: "공정별 사용량 통합 자재 리스트 개편 + VISION.md 작성",
      category: "자동화계획",
      content: "기존 공정별 카드 10개에서 통합 자재 리스트 47종으로 개편.\n품번 체계: GAS-001 형식 (카테고리 + 일련번호, 공정번호 제거).\nGAS/CHM/CSM/UTL/PKG 카테고리 필터 추가.\n제품별 사용량(HBM) 탭 신설 — KGD 스크리닝 강조.\nVISION.md: 5대 개발 원칙 정의.",
      result: "HBM은 CMP 스텝 +1 (TSV Reveal), 금속배선에 Cu Fill ECD + μBump 추가 확인",
      nextAction: "자재 입고 시뮬레이션 UI 착수, 재고·DOH 페이지 실데이터 전환",
      userId: admin.id,
    },
  }).catch(() => {});
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
  .finally(() => prisma.$disconnect());
