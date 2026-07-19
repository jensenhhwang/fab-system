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
