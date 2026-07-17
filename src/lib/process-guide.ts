import { PROCESSES } from "@/lib/processes";
import type { FabId } from "@/lib/fab-domain";

export type ProcessGuide = {
  key: string;
  code: string;
  name: string;
  nameEn: string;
  color: string;
  purpose: string;
  activities: string[];
  equipment: string[];
  materialInputs: string[];
  kpis: string[];
  output: string;
  previousCode: string | null;
  nextCode: string | null;
  source: "MODELED_BASELINE";
  fabNote: string;
};

const GUIDE_DETAIL: Record<string, Omit<ProcessGuide, "key" | "code" | "name" | "nameEn" | "color" | "activities" | "previousCode" | "nextCode" | "source" | "fabNote">> = {
  P01: { purpose: "실리콘 표면에 균일한 절연막을 형성해 소자와 배선 사이의 전기적 절연 기반을 만듭니다.", equipment: ["산화 퍼니스", "RTP"], materialInputs: ["O₂", "N₂", "초순수(UPW)", "세정 케미컬"], kpis: ["막 두께", "균일도", "결함 밀도"], output: "절연 산화막이 형성된 웨이퍼" },
  P02: { purpose: "화학 반응으로 유전체·보호막 등 필요한 박막을 웨이퍼 전면에 증착합니다.", equipment: ["LPCVD", "PECVD", "ALD"], materialInputs: ["증착 전구체", "SiH₄", "NH₃", "N₂"], kpis: ["증착률", "막 두께 균일도", "파티클"], output: "기능성 박막이 증착된 웨이퍼" },
  P03: { purpose: "감광막을 바르고 노광·현상해 다음 식각 또는 주입 단계에서 사용할 미세 패턴을 만듭니다.", equipment: ["Coater/Developer", "EUV·ArF Scanner", "Track"], materialInputs: ["Photoresist", "Developer", "세정액", "N₂"], kpis: ["CD", "Overlay", "노광 결함"], output: "감광막 패턴이 형성된 웨이퍼" },
  P04: { purpose: "포토 패턴을 마스크로 사용해 노출된 막을 선택적으로 제거하고 회로 구조를 전사합니다.", equipment: ["Dry Etcher", "Wet Bench", "Ashing Tool"], materialInputs: ["CF계 식각가스", "Cl계 가스", "HF", "세정 케미컬"], kpis: ["식각률", "선택비", "Profile"], output: "회로 패턴이 식각된 웨이퍼" },
  P05: { purpose: "도펀트 이온을 정해진 깊이와 농도로 주입해 트랜지스터의 전기적 특성을 형성합니다.", equipment: ["Ion Implanter", "Anneal/RTP"], materialInputs: ["도펀트 가스", "N₂", "Ar", "소모성 부품"], kpis: ["Dose", "주입 에너지", "Sheet Resistance"], output: "불순물 영역이 형성·활성화된 웨이퍼" },
  P06: { purpose: "금속막을 증착하고 패터닝해 소자 사이의 1차 전기 연결과 비아 구조를 만듭니다.", equipment: ["PVD", "CVD Metal", "Plating Tool"], materialInputs: ["Cu·Al Target", "금속 전구체", "도금액", "Ar"], kpis: ["막 저항", "Step Coverage", "Void"], output: "1차 금속 배선이 형성된 웨이퍼" },
  P07: { purpose: "연마 패드와 슬러리로 웨이퍼 표면을 평탄화해 다음 적층 공정의 초점과 막 균일도를 확보합니다.", equipment: ["CMP Polisher", "Post-CMP Cleaner"], materialInputs: ["CMP Slurry", "연마 Pad", "세정액", "UPW"], kpis: ["Removal Rate", "평탄도", "Scratch"], output: "표면이 평탄화된 웨이퍼" },
  P08: { purpose: "기준 모델에서는 TSV 또는 상부 금속 배선을 형성해 층간·칩간 연결 구조를 만듭니다.", equipment: ["Deep Etcher", "Plating Tool", "Bonding Tool"], materialInputs: ["Cu 도금액", "Barrier 전구체", "식각가스", "접합 소재"], kpis: ["Via 저항", "충진 Void", "Bond 정렬"], output: "층간 연결 구조가 형성된 웨이퍼", },
  P09: { purpose: "프로브로 웨이퍼의 전기 특성을 측정하고 양품·불량 Die를 분류해 수율 지도를 만듭니다.", equipment: ["Wafer Prober", "ATE", "Inspection Tool"], materialInputs: ["Probe Card", "Cleaning Sheet", "소켓 부품"], kpis: ["Yield", "Test Time", "재검률"], output: "전기검사 결과와 Wafer Map" },
  P10: { purpose: "양품 Die를 절단·접합·봉지하고 최종 검사해 출하 가능한 반도체 패키지로 완성합니다.", equipment: ["Dicing Saw", "Bonder", "Molding·Final Test"], materialInputs: ["EMC", "Substrate", "접착재", "Tray·Reel"], kpis: ["조립 수율", "Bond 불량", "Final Test Yield"], output: "검사 완료된 최종 패키지" },
};

export function getProcessGuide(processCode: string, fabId: FabId | null): ProcessGuide | null {
  const index = PROCESSES.findIndex((process) => process.code === processCode);
  const process = PROCESSES[index];
  const detail = GUIDE_DETAIL[processCode];
  if (!process || !detail) return null;
  const fabNote = fabId === null
    ? "3FAB 공통 기준 공정 모델입니다. Fab별 실제 Route Master가 연결되면 독립 정의로 교체됩니다."
    : fabId === "M20"
      ? "M20 HBM 기준으로 표시하되 실제 MES Route 확정 전 항목은 기준 모델입니다."
      : `${fabId} ${fabId === "M21" ? "DRAM" : "NAND"} 실제 Route Master 미연결 항목은 공통 기준 모델로 표시합니다.`;
  return {
    key: `${fabId ?? "BASELINE"}:${processCode}`,
    code: process.code,
    name: process.name,
    nameEn: process.nameEn,
    color: process.color,
    purpose: detail.purpose,
    activities: process.activities,
    equipment: detail.equipment,
    materialInputs: detail.materialInputs,
    kpis: detail.kpis,
    output: detail.output,
    previousCode: index > 0 ? PROCESSES[index - 1].code : null,
    nextCode: index < PROCESSES.length - 1 ? PROCESSES[index + 1].code : null,
    source: "MODELED_BASELINE",
    fabNote,
  };
}
