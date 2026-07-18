import { collections } from "@/lib/db";
import type { Product, RouteMasterDoc, RouteMasterNode } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";

export async function getRouteMaster(fabId: FabId, product: Product): Promise<RouteMasterDoc | null> {
  const { routeMasters } = await collections();
  return routeMasters.findOne({ _id: `${fabId}:${product}` });
}

export type RouteVisit = {
  nodeId: string;
  label: string;
  processCode: string;
  stage: RouteMasterNode["stage"];
  visitIndex: number; // 이 노드 안에서 몇 번째 반복인지 (0-based)
  stepIndex: number; // 노드 전체 흐름에서 이 방문의 절대 순번 (0-based)
};

// nodes를 cycle × repeatCount로 펼쳐서 ProcessFlow3D가 순서대로 재생할 수 있는 선형 시퀀스로 변환.
export function expandRouteMaster(doc: RouteMasterDoc): RouteVisit[] {
  const visits: RouteVisit[] = [];
  for (const node of doc.nodes) {
    for (let repeat = 0; repeat < node.repeatCount; repeat++) {
      for (const processCode of node.cycle) {
        visits.push({
          nodeId: node.id,
          label: node.label,
          processCode,
          stage: node.stage,
          visitIndex: repeat,
          stepIndex: visits.length,
        });
      }
    }
  }
  return visits;
}
