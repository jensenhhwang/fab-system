export type HazmatZoneCode = "TOXIC_GAS" | "PYROPHORIC_GAS" | "OXIDIZING_GAS" | "ACID" | "ALKALI" | "OXIDIZER";
export type SupplyMode = "ON_SITE" | "BULK_GAS" | "SPECIALTY_CYLINDER" | "BULK_CHEMICAL" | "DRUM_CHEMICAL" | "PRECURSOR_CANISTER" | "GENERAL_STORAGE";

export type SupplyProfile = {
  mode: SupplyMode;
  label: string;
  flow: string;
  targetFacility: string;
};

export const FACILITY_MASTER = [
  { _id: "MWH-01", code: "MWH-01", name: "자동화 자재창고 (AS/RS)", type: "AS_RS", capacityMode: "SPACE", totalCapacity: 2000, unit: "pallet", temperature: "20~25°C / 습도 45~55%", notes: "표준 팔레트 일반 소모품·슬러리·포장 자재 자동보관" },
  { _id: "MWH-02", code: "MWH-02", name: "항온 자재창고", type: "FLAT", capacityMode: "SPACE", totalCapacity: 2600, unit: "pallet", temperature: "항온 Zone 5~25°C", notes: "포토레지스트·필름·온도민감 자재 보관" },
  { _id: "HZW-01", code: "HZW-01", name: "특수가스 위험물창고", type: "HAZMAT", capacityMode: "SPACE", totalCapacity: 7500, unit: "cylinder-slot", temperature: "15~20°C / 방폭·강제배기", notes: "독성·부식성·자연발화성 특수가스 예비 실린더 보관", legalLimit: 6750 },
  { _id: "MRO-01", code: "MRO-01", name: "공구·MRO 창고", type: "MRO", capacityMode: "SPACE", totalCapacity: 2200, unit: "slot", temperature: "실온", notes: "Probe Card·PVD Target·Quartz Kit 등 개체관리" },
  { _id: "BGY-01", code: "BGY-01", name: "벌크가스 야드", type: "BULK_GAS", capacityMode: "TANK_LEVEL", totalCapacity: 100, unit: "%", temperature: "옥외 탱크·기화기·정제기", notes: "N₂·Ar·O₂·H₂·He·CO₂ 중앙공급" },
  { _id: "BCY-01", code: "BCY-01", name: "벌크케미컬 야드", type: "BULK_CHEM", capacityMode: "TANK_LEVEL", totalCapacity: 100, unit: "%", temperature: "물질별 탱크·방유 구획", notes: "HF·H₂O₂·H₂SO₄·NH₄OH·HCl·H₃PO₄·TMAH BCDS" },
  { _id: "PRS-01", code: "PRS-01", name: "전구체 공급실", type: "PRECURSOR", capacityMode: "SPACE", totalCapacity: 500, unit: "canister-slot", temperature: "물질별 항온·건조", notes: "TEOS·BDEAS·TiCl₄·TDMAT·TEMAHf·DIPAS 캐니스터" },
  { _id: "UPW-01", code: "UPW-01", name: "초순수 생산시설", type: "ON_SITE", capacityMode: "CONTINUOUS", totalCapacity: 100, unit: "%", temperature: "연속 수질 모니터링", notes: "UPW 현장 생산·순환 Loop 공급" },
] as const;

export type StorageRule = {
  zoneCode: HazmatZoneCode;
  zoneName: string;
  hazard: string;
  rationale: string;
  controls: string[];
};

const RULES: Record<string, StorageRule> = {
  "GAS-004": gas("PYROPHORIC_GAS", "자연발화성 가스실", "자연발화성·가연성", "SiH₄는 공기 접촉 시 자연발화 위험이 있어 산화성 가스와 방화 구획으로 분리합니다."),
  "GAS-005": gas("TOXIC_GAS", "독성·부식성 가스실", "독성·부식성", "암모니아 누출 시 흡입 위험과 부식성이 있어 환기형 전용 캐비닛에 격리합니다."),
  "GAS-006": gas("OXIDIZING_GAS", "산화성·불활성 가스실", "산화성 가스", "NF₃는 산화성 고압가스로 가연성·자연발화성 가스와 분리합니다."),
  "GAS-007": gas("TOXIC_GAS", "독성·부식성 가스실", "고독성·부식성", "WF₆는 수분과 반응해 부식성 부산물을 만들 수 있어 건조한 전용 가스 캐비닛에 둡니다."),
  "GAS-011": gas("OXIDIZING_GAS", "산화성·불활성 가스실", "고압 공정가스", "CF₄는 고압 실린더 전도 방지와 누출 관리가 필요한 공정가스로 별도 실린더 랙에 둡니다."),
  "GAS-012": gas("OXIDIZING_GAS", "산화성·불활성 가스실", "고압 공정가스", "SF₆는 고압 용기 상태와 누출을 관리하는 전용 실린더 구역에 둡니다."),
  "GAS-013": gas("TOXIC_GAS", "독성·부식성 가스실", "독성·산화성·부식성", "Cl₂는 독성과 부식성이 강해 가스 감지·국소배기·자동 차단이 있는 캐비닛에 격리합니다."),
  "GAS-015": gas("PYROPHORIC_GAS", "자연발화성 가스실", "가연성·부식성", "DCS는 가연성과 부식성이 있는 특수가스로 점화원·산화성 가스에서 격리하고 건조 상태를 유지합니다."),
  "GAS-021": gas("TOXIC_GAS", "독성·부식성 가스실", "고독성·부식성", "BF₃는 독성·부식성 도판트 가스로 밀폐 캐비닛과 전용 배기가 필요합니다."),
  "GAS-022": gas("PYROPHORIC_GAS", "자연발화성 가스실", "고독성·가연성", "PH₃는 고독성·가연성 도판트 가스로 점화원과 산화성 가스에서 격리합니다."),
  "GAS-023": gas("PYROPHORIC_GAS", "자연발화성 가스실", "고독성·가연성", "AsH₃는 초고독성 가스로 연속 감지와 자동 차단이 가능한 격리 캐비닛에 둡니다."),
  "GAS-024": gas("PYROPHORIC_GAS", "자연발화성 가스실", "자연발화성·독성", "B₂H₆는 공기 접촉 시 발화 위험이 있어 산화제와 방화 구획으로 분리합니다."),
  "GAS-025": gas("TOXIC_GAS", "독성·부식성 가스실", "독성·부식성", "HBr은 독성·부식성 가스로 내식성 캐비닛과 전용 배기가 필요합니다."),
  "GAS-026": gas("OXIDIZING_GAS", "산화성·불활성 가스실", "고압 공정가스", "C₄F₈은 액화 고압가스로 전도 방지와 온도·누출 관리가 가능한 랙에 둡니다."),
  "CHM-001": liquid("ACID", "산성 케미컬실", "강산·고독성", "HF는 심각한 독성과 부식성이 있어 내식성 선반과 독립 누출받이에 보관합니다."),
  "CHM-002": liquid("OXIDIZER", "산화제실", "강산화제", "H₂O₂는 다른 물질의 연소·분해반응을 촉진할 수 있어 산·알칼리·유기물과 분리합니다."),
  "CHM-003": liquid("ACID", "산성 케미컬실", "강산·산화성", "H₂SO₄는 강산이므로 알칼리와 분리하고 내산성 2차 containment에 둡니다."),
  "CHM-004": liquid("ALKALI", "알칼리 케미컬실", "강알칼리·부식성", "NH₄OH는 산과 혼합 시 발열·증기 발생 위험이 있어 독립 알칼리 구역에 둡니다."),
  "CHM-005": liquid("ACID", "산성 케미컬실", "강산·부식성", "HCl은 부식성 증기와 누출 위험 때문에 내식성 환기 구역과 누출받이가 필요합니다."),
  "CHM-006": liquid("ACID", "산성 케미컬실", "산·부식성", "H₃PO₄는 산류로 알칼리와 분리하고 내산성 선반에 보관합니다."),
};

function gas(zoneCode: HazmatZoneCode, zoneName: string, hazard: string, rationale: string): StorageRule {
  return { zoneCode, zoneName, hazard, rationale, controls: ["환기형 가스 캐비닛", "연속 가스 감지", "자동 차단", "실린더 전도 방지"] };
}

function liquid(zoneCode: HazmatZoneCode, zoneName: string, hazard: string, rationale: string): StorageRule {
  return { zoneCode, zoneName, hazard, rationale, controls: ["내식성 보관설비", "2차 containment", "누출 감지", "방유턱·트렌치"] };
}

export function getStorageRule(materialCode: string): StorageRule | null {
  return RULES[materialCode] ?? null;
}

const BULK_GASES = new Set(["GAS-001", "GAS-002", "GAS-003", "GAS-008", "GAS-009", "GAS-010"]);
const PRECURSORS = new Set(["GAS-014", "GAS-016", "GAS-017", "GAS-018", "GAS-019", "GAS-020"]);
const BULK_CHEMICALS = new Set(["CHM-001", "CHM-002", "CHM-003", "CHM-004", "CHM-005", "CHM-006", "CHM-010"]);
const DRUM_CHEMICALS = new Set(["CHM-007", "CHM-008", "CHM-009", "CHM-011", "CHM-012", "CHM-013", "CSM-001", "CSM-002", "CSM-003", "CSM-011", "UTL-002"]);

export function getSupplyProfile(materialCode: string): SupplyProfile {
  if (materialCode === "UTL-001") return { mode: "ON_SITE", label: "현장 생산·연속공급", targetFacility: "UPW Plant", flow: "현장 생산 → 품질 모니터링 → UPW Loop → 공정" };
  if (BULK_GASES.has(materialCode)) return { mode: "BULK_GAS", label: "벌크가스·중앙공급", targetFacility: "Bulk Gas Yard", flow: "벌크 탱크/발생장치 → 정제기 → Main Header → VMB/VMP → 공정" };
  if (PRECURSORS.has(materialCode)) return { mode: "PRECURSOR_CANISTER", label: "전구체 캐니스터", targetFacility: "Precursor Supply Room", flow: "항온 보관 → 캐니스터 장착 → 가열·기화 → VMB → CVD/ALD" };
  if (BULK_CHEMICALS.has(materialCode)) return { mode: "BULK_CHEMICAL", label: "벌크 습식 케미컬", targetFacility: "Bulk Chemical Yard", flow: "탱크로리/ISO Container → 벌크탱크 → BCDS → 이중배관 → 공정" };
  if (DRUM_CHEMICALS.has(materialCode)) return { mode: "DRUM_CHEMICAL", label: "드럼·소량 케미컬", targetFacility: "Chemical Supply Room", flow: "창고 → 출고검사 → Chemical Supply Room → 펌프·필터 → VMB → 공정" };
  if (materialCode.startsWith("GAS-")) return { mode: "SPECIALTY_CYLINDER", label: "특수가스 실린더", targetFacility: "Gas Supply Room", flow: "HZW-01 → 전용카트·출고검사 → 가스 캐비닛 → 자동전환·퍼지 → VMB/VMP → 공정" };
  return { mode: "GENERAL_STORAGE", label: "일반 창고 출고", targetFacility: "Material Staging", flow: "창고 → 피킹·검수 → 출고 스테이징 → 공정 물류" };
}

export function getCanonicalFacility(materialCode: string): string {
  const mode = getSupplyProfile(materialCode).mode;
  if (mode === "ON_SITE") return "UPW-01";
  if (mode === "BULK_GAS") return "BGY-01";
  if (mode === "BULK_CHEMICAL") return "BCY-01";
  if (mode === "PRECURSOR_CANISTER") return "PRS-01";
  if (mode === "SPECIALTY_CYLINDER") return "HZW-01";
  if (["CHM-007","CHM-008","CHM-009","CHM-012","CHM-013","PKG-001","PKG-002","CSM-014"].includes(materialCode)) return "MWH-02";
  if (["CSM-006","CSM-007","CSM-008","CSM-009","CSM-010","CSM-015"].includes(materialCode)) return "MRO-01";
  return "MWH-01";
}

export function getGeneralStorageRationale(warehouseType: string): string {
  if (warehouseType === "AS_RS") return "표준화된 팔레트 단위로 자동 입출고가 가능하고 고밀도 보관에 적합해 AS/RS 슬롯에 배치합니다.";
  if (warehouseType === "FLAT") return "형상과 취급 방식이 다양한 일반 소모품으로 지게차 접근과 평치·팔레트 랙 보관이 용이한 구역에 배치합니다.";
  if (warehouseType === "MRO") return "개별 식별과 빈 피킹이 중요한 공구·교체부품으로 소형 캐비닛과 검사 구역에 배치합니다.";
  return "자재의 용기, 위험성 및 취급 조건에 맞는 지정 위치에 배치합니다.";
}
