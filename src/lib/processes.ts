export interface ProcessDef {
  code: string;
  name: string;
  nameEn: string;
  color: string;
  activities: string[];
  nMachines: number;
  yellowBay?: boolean;
}

export const PROCESSES: ProcessDef[] = [
  { code: "P01", name: "산화막",       nameEn: "Oxidation",     color: "#3B82F6", activities: ["열산화 성장", "SiO₂ 게이트막", "절연층 형성"],    nMachines: 8  },
  { code: "P02", name: "CVD",          nameEn: "CVD",           color: "#8B5CF6", activities: ["박막 증착", "PECVD/LPCVD", "유전체 형성"],          nMachines: 12 },
  { code: "P03", name: "포토",         nameEn: "Photo",         color: "#EC4899", activities: ["PR 도포", "EUV/ArF 노광", "현상·검사"],             nMachines: 12, yellowBay: true },
  { code: "P04", name: "식각",         nameEn: "Etching",       color: "#F97316", activities: ["건식/습식 식각", "패턴 전사", "선택비 제어"],         nMachines: 16 },
  { code: "P05", name: "이온주입",     nameEn: "Ion Implant",   color: "#EAB308", activities: ["불순물 주입", "도즈량 제어", "열처리 활성화"],        nMachines: 8  },
  { code: "P06", name: "금속배선1",    nameEn: "Metallization", color: "#10B981", activities: ["Al/Cu 스퍼터링", "배선 패터닝", "비아 형성"],         nMachines: 10 },
  { code: "P07", name: "CMP",          nameEn: "CMP",           color: "#06B6D4", activities: ["전면 평탄화", "연마 속도 제어", "슬러리 관리"],       nMachines: 10 },
  { code: "P08", name: "TSV/배선2",    nameEn: "TSV/Metal2",    color: "#EF4444", activities: ["관통 전극 형성", "Cu 도금", "3D 적층 배선"],          nMachines: 8  },
  { code: "P09", name: "웨이퍼테스트", nameEn: "Wafer Test",    color: "#84CC16", activities: ["전기 특성 검사", "수율 분석", "불량 맵핑"],            nMachines: 12 },
  { code: "P10", name: "패키징",       nameEn: "Packaging",     color: "#D946EF", activities: ["다이 절단", "HBM 적층 본딩", "최종 검사"],            nMachines: 10 },
];
