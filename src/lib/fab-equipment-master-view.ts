import type { FabId } from "@/lib/fab-domain";

// FabEquipmentMasterCard가 실제로 읽는 필드만 담은 최소 공용 뷰.
// M20/M21/M22의 build*FabEquipmentMaster() 결과는 각자 더 풍부한 고유 타입을 갖지만,
// 이 인터페이스를 만족하기만 하면 카드 컴포넌트가 fab에 상관없이 렌더링할 수 있다.
export type FabEquipmentMasterView = {
  fabId: FabId;
  normalWspm: number;
  totalEquipment: number;
  processes: Array<{
    processCode: string;
    name: string;
    definedCount: number;
    normalPlannedLoad: number | null;
    pendingReason?: string;
    bottleneckCapacityStage: string | null;
    capacityStages: Array<{ stageCode: string; name: string }>;
  }>;
};
