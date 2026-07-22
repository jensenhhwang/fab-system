export type EquipmentInstancePosition = {
  index: number;
  bayIndex?: number;
  x: number;
  z: number;
  facing: -1 | 1;
};

export type DenseEquipmentBay = {
  index: number;
  count: number;
  centerX: number;
  centerZ: number;
  equipment: EquipmentInstancePosition[];
};

export const M20_3D_EQUIPMENT_TOTAL = 494;
export const M20_3D_MAX_PROCESS_EQUIPMENT = 72;
export const M20_DENSE_PROCESS_ZONES: Readonly<Record<string, { x: number; z: number }>> = Object.freeze({
  P01: { x: -5.2, z: -21.2 }, P05: { x:  5.2, z: -21.2 },
  P03: { x: -5.2, z: -11.6 }, P04: { x:  5.2, z: -11.6 },
  P07: { x: -5.2, z:  -2.0 }, P06: { x:  5.2, z:  -2.0 },
  P02: { x: -5.2, z:   7.6 }, P08: { x:  5.2, z:   7.6 },
  P09: { x: -5.2, z:  15.2 }, P10: { x:  5.2, z:  15.2 },
});

export function buildOhtAccessPoints(
  zones: Readonly<Record<string, { x: number; z: number }>>,
  spineOffset = 0.5,
): Record<string, { x: number; z: number }> {
  return Object.fromEntries(Object.entries(zones).map(([code, zone]) => [code, {
    x: zone.x < 0 ? -spineOffset : spineOffset,
    z: zone.z,
  }]));
}

export function ohtRouteDistance(route: readonly string[], accessPoints: Readonly<Record<string, { x: number; z: number }>>): number {
  let distance = 0;
  for (let index = 1; index < route.length; index += 1) {
    const from = accessPoints[route[index - 1]];
    const to = accessPoints[route[index]];
    if (!from || !to) throw new Error(`OHT access point가 없습니다: ${route[index - 1]} → ${route[index]}`);
    distance += Math.abs(from.x) + Math.abs(to.x) + Math.abs(from.z - to.z);
  }
  return distance;
}

export function buildTwoRowEquipmentLayout(
  count: number,
  bayZ: number,
  pitch: number,
  rowGap: number,
): EquipmentInstancePosition[] {
  if (!Number.isInteger(count) || count < 0) throw new Error("장비 대수는 0 이상의 정수여야 합니다.");
  if (pitch <= 0 || rowGap <= 0) throw new Error("장비 pitch와 row gap은 양수여야 합니다.");

  const firstRowCount = Math.ceil(count / 2);
  const secondRowCount = Math.floor(count / 2);
  const row = (rowCount: number, z: number, facing: -1 | 1, indexOffset: number) =>
    Array.from({ length: rowCount }, (_, rowIndex) => ({
      index: indexOffset + rowIndex,
      x: (rowIndex - (rowCount - 1) / 2) * pitch,
      z,
      facing,
    }));

  return [
    ...row(firstRowCount, bayZ - rowGap, 1, 0),
    ...row(secondRowCount, bayZ + rowGap, -1, firstRowCount),
  ];
}

export function buildDenseProcessEquipmentLayout(
  count: number,
  centerX: number,
  centerZ: number,
  pitch: number,
  rowGap: number,
  maxEquipmentPerBay = 20,
  baySpacing = 2.55,
): { bays: DenseEquipmentBay[]; equipment: EquipmentInstancePosition[] } {
  if (!Number.isInteger(count) || count < 0) throw new Error("장비 대수는 0 이상의 정수여야 합니다.");
  if (!Number.isInteger(maxEquipmentPerBay) || maxEquipmentPerBay <= 0) throw new Error("Bay당 장비 상한은 양의 정수여야 합니다.");
  if (count === 0) return { bays: [], equipment: [] };

  const bayCount = Math.ceil(count / maxEquipmentPerBay);
  const baseCount = Math.floor(count / bayCount);
  const remainder = count % bayCount;
  let equipmentOffset = 0;
  const bays = Array.from({ length: bayCount }, (_, bayIndex): DenseEquipmentBay => {
    const bayEquipmentCount = baseCount + (bayIndex < remainder ? 1 : 0);
    const bayCenterZ = centerZ + (bayIndex - (bayCount - 1) / 2) * baySpacing;
    const equipment = buildTwoRowEquipmentLayout(bayEquipmentCount, bayCenterZ, pitch, rowGap)
      .map((tool) => ({ ...tool, index: equipmentOffset + tool.index, bayIndex, x: tool.x + centerX }));
    equipmentOffset += bayEquipmentCount;
    return { index: bayIndex, count: bayEquipmentCount, centerX, centerZ: bayCenterZ, equipment };
  });

  return { bays, equipment: bays.flatMap((bay) => bay.equipment) };
}

// M20_DENSE_PROCESS_ZONES가 쓰던 좌우 짝·순서 — OHT 이동거리를 줄이려는 지그재그 순서의 근거.
// 좌우 짝으로 자리를 고정하진 않지만, bin-packing 아이템을 만들 때 이 순서를 유지해
// 같은 공정의 bay들이 배열 안에서 뭉쳐 있게(= 최대 2덩어리로만 쪼개지게) 한다.
export const PROCESS_ZONE_PAIRS: readonly (readonly [string, string])[] = [
  ["P01", "P05"],
  ["P03", "P04"],
  ["P07", "P06"],
  ["P02", "P08"],
  ["P09", "P10"],
];
const PROCESS_FLOW_ORDER: readonly string[] = PROCESS_ZONE_PAIRS.flatMap(([left, right]) => [left, right]);

export const MAX_EQUIPMENT_PER_BAY = 20;
const BAY_SPACING = 2.3;
const MIN_PROCESS_DEPTH = 9.6;
const ROW_MARGIN = 0.8;

export type ProcessBayZone = { x: number; z: number; bayIndex: number; bayCount: number };

// 실제 설비 대수(equipmentCounts)로 "공정의 bay 하나하나"에 좌표를 배정하고 floor depth를 계산한다.
// 좌우를 고정 짝으로 묶으면(예: P02↔P08) 한쪽 대수가 0인 fab(M21/M22는 P08=0)에서
// P02가 몇 줄이든 반대편 절반이 계속 빈 채로 남는다. 짝을 고정하지 않고 "공정 1개"를 하나의
// bin-packing 단위로 삼아도, 그 공정이 여러 bay를 차지하면(M22 P02=16 bay) 여전히 한쪽 열에
// 몰려서 다른 열이 통째로 비게 된다 — 그래서 bin-packing의 최소 단위를 "공정"이 아니라 "bay
// 1개"로 내려서, 대수가 많은 공정은 자연스럽게 두 열에 걸쳐 촘촘하게 나눠 담기도록 한다.
export function computeDynamicProcessZones(
  equipmentCounts: Readonly<Record<string, number>>,
  maxEquipmentPerBay = MAX_EQUIPMENT_PER_BAY,
  baySpacing = BAY_SPACING,
  minProcessDepth = MIN_PROCESS_DEPTH,
  rowMargin = ROW_MARGIN,
): { zones: Record<string, ProcessBayZone>; floorDepth: number } {
  type BayItem = { code: string; bayIndex: number; bayCount: number; depth: number };
  const items: BayItem[] = [];
  for (const code of PROCESS_FLOW_ORDER) {
    const count = equipmentCounts[code] ?? 0;
    if (count <= 0) continue;
    const bayCount = Math.max(1, Math.ceil(count / maxEquipmentPerBay));
    for (let bayIndex = 0; bayIndex < bayCount; bayIndex += 1) {
      // bay가 1개뿐인 공정은 기존처럼 최소 footprint(minProcessDepth)를 보장하고,
      // 여러 bay로 쪼개진 공정은 bay 각각이 baySpacing만큼만 차지해 촘촘하게 채운다.
      const depth = bayCount === 1 ? Math.max(baySpacing, minProcessDepth) : baySpacing;
      items.push({ code, bayIndex, bayCount, depth });
    }
  }
  // depth 내림차순, 동률이면 원래 순서 유지(stable sort) — 같은 공정의 bay들이 흩어지지 않고
  // 최대 두 덩어리(왼쪽 열 일부·오른쪽 열 일부)로만 나뉘게 하기 위한 성질이다.
  items.sort((a, b) => b.depth - a.depth);

  type Column = { items: BayItem[]; total: number };
  const columns: [Column, Column] = [{ items: [], total: 0 }, { items: [], total: 0 }];
  for (const item of items) {
    const target = columns[0].total <= columns[1].total ? columns[0] : columns[1];
    target.total += item.depth + (target.items.length > 0 ? rowMargin : 0);
    target.items.push(item);
  }

  const floorDepth = Math.max(columns[0].total, columns[1].total, minProcessDepth);
  const zones: Record<string, ProcessBayZone> = {};
  const columnX = [-5.2, 5.2] as const;
  columns.forEach((column, columnIndex) => {
    let cursor = -floorDepth / 2;
    for (const item of column.items) {
      const centerZ = cursor + item.depth / 2;
      zones[`${item.code}#${item.bayIndex}`] = {
        x: columnX[columnIndex], z: centerZ, bayIndex: item.bayIndex, bayCount: item.bayCount,
      };
      cursor += item.depth + rowMargin;
    }
  });
  // 대표 좌표(공정코드 단독 키) = bay#0. 창고 배관·FOUP 애니메이션·카메라 포커스 등
  // "그 공정 전체를 대표하는 좌표 1곳"을 쓰던 기존 소비처들이 코드 변경 없이 계속 동작한다.
  for (const code of PROCESS_FLOW_ORDER) {
    const first = zones[`${code}#0`];
    if (first) zones[code] = first;
  }

  return { zones, floorDepth };
}

// bay 1개짜리 저수준 빌더. computeDynamicProcessZones가 배정한 여러 bay 좌표에
// 이 함수를 각각 호출해 하나의 공정을 두 열에 걸쳐서도 렌더링할 수 있게 한다.
export function buildBayEquipmentLayout(
  count: number,
  centerX: number,
  centerZ: number,
  pitch: number,
  rowGap: number,
): EquipmentInstancePosition[] {
  return buildTwoRowEquipmentLayout(count, centerZ, pitch, rowGap)
    .map((tool) => ({ ...tool, x: tool.x + centerX }));
}

export function buildCampusEquipmentLayout(count: number, columns = 12): Array<{ x: number; z: number }> {
  if (!Number.isInteger(count) || count < 0) throw new Error("장비 대수는 0 이상의 정수여야 합니다.");
  if (!Number.isInteger(columns) || columns <= 0) throw new Error("열 수는 양의 정수여야 합니다.");
  if (count === 0) return [];

  const rows = Math.ceil(count / columns);
  const usedColumns = Math.min(columns, count);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const columnsInRow = row === rows - 1 ? count - row * columns : usedColumns;
    return {
      x: (column - (columnsInRow - 1) / 2) * 0.18,
      z: (row - (rows - 1) / 2) * 0.15,
    };
  });
}
