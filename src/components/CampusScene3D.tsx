"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, OrbitControls, Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { CampusMaterialFlow, CampusFacility, MaterialFlowFab } from "@/lib/material-flow";
import type { FabScope } from "@/components/ControlContext";
import type { FabId } from "@/lib/fab-domain";
import type { UsageWarehouse } from "@/lib/usage-twin-data";
import { positionForTransfer, POSITION_MODE_LABEL, type LiveTransfer } from "@/lib/live-transfer";
import type { SceneClockMode } from "@/lib/scene-clock";

const CATEGORY_COLOR: Record<string, string> = {
  GAS: "#B91C1C",
  CHM: "#1D4ED8",
  CSM: "#7C3AED",
  UTL: "#059669",
  PKG: "#64748B",
};

const CAMPUS_EQUIPMENT_FALLBACK: Record<FabId, Record<string, number>> = {
  M20: { P01: 4, P02: 6, P03: 10, P04: 8, P05: 4, P06: 6, P07: 6, P08: 10, P09: 6, P10: 8 },
  M21: { P01: 6, P02: 8, P03: 8, P04: 10, P05: 6, P06: 10, P07: 8, P08: 4, P09: 8, P10: 4 },
  M22: { P01: 6, P02: 12, P03: 6, P04: 12, P05: 4, P06: 10, P07: 6, P08: 4, P09: 6, P10: 4 },
};

type SceneProps = {
  material: CampusMaterialFlow | null;
  materials: CampusMaterialFlow[];
  fabScope: FabScope;
  facilities: CampusFacility[];
  warehouses: UsageWarehouse[];
  transfers: LiveTransfer[];
  clockMode: SceneClockMode;
  serverOffsetMs: number;
  pausedAtMs: number | null;
  equipmentCounts: Partial<Record<FabId, Record<string, number>>>;
  onFacilitySelect: (facilityId: string) => void;
  onWarehouseSelect: (warehouseCode: string) => void;
  onProcessSelect: (fabId: FabId, processCode: string) => void;
};

function warehousePosition(index: number, count: number): [number, number, number] {
  const columns = Math.min(5, Math.max(1, count));
  const row = Math.floor(index / columns);
  const column = index % columns;
  return [(column - (columns - 1) / 2) * 5.1, 0, -10.5 - row * 4.8];
}

function MovingCrane({ width = 2.3, operating }: { width?: number; operating: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock, invalidate }) => {
    if (!ref.current || !operating) return;
    ref.current.position.x = Math.sin(clock.elapsedTime * 0.72) * width;
    ref.current.position.y = 0.48 + (Math.sin(clock.elapsedTime * 1.15) + 1) * 0.34;
    invalidate();
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.9, 0]}><boxGeometry args={[0.09, 1.8, 0.14]} /><meshStandardMaterial color="#E2B23A" metalness={0.6} roughness={0.25} /></mesh>
      <mesh position={[0, 0.06, 0.16]}><boxGeometry args={[0.48, 0.12, 0.52]} /><meshStandardMaterial color="#F59E0B" emissive="#F59E0B" emissiveIntensity={0.35} /></mesh>
    </group>
  );
}

function WarehouseStructure({ warehouse, active, operating, color }: { warehouse: UsageWarehouse; active: boolean; operating: boolean; color: string }) {
  const code = warehouse.code;
  const type = warehouse.type;
  if (type === "AS_RS" || code === "MWH-01") {
    return <group>
      {[-1.7, -0.58, 0.58, 1.7].map((x) => <group key={x} position={[x, 0, 0]}>
        {Array.from({ length: 5 }).map((_, level) => <group key={level} position={[0, 0.35 + level * 0.4, 0]}>
          <mesh><boxGeometry args={[0.86, 0.055, 2.8]} /><meshStandardMaterial color="#65727E" metalness={0.68} roughness={0.3} /></mesh>
          {[-0.95, -0.32, 0.32, 0.95].map((z, index) => (active || index < Math.max(1, Math.round(warehouse.utilization / 25))) && <mesh key={z} position={[0, 0.14, z]}>
            <boxGeometry args={[0.63, 0.22, 0.42]} /><meshStandardMaterial color={active ? color : "#9CA8B3"} emissive={active ? color : "#000000"} emissiveIntensity={active ? 0.22 : 0} />
          </mesh>)}
        </group>)}
      </group>)}
      <MovingCrane width={1.6} operating={operating} />
    </group>;
  }
  if (type === "FLAT" || code === "MWH-02") {
    return <group>
      {[-1.35, -0.45, 0.45, 1.35].map((x) => [-0.72, 0, 0.72].map((z, index) => <group key={`${x}-${z}`} position={[x, 0, z]}>
        <mesh position={[0, 0.07, 0]}><boxGeometry args={[0.76, 0.14, 0.58]} /><meshStandardMaterial color="#9B6B43" roughness={0.82} /></mesh>
        <mesh position={[0, 0.28, 0]}><boxGeometry args={[0.66, 0.3 + (index % 2) * 0.16, 0.5]} /><meshStandardMaterial color={active ? color : "#AAB5BF"} roughness={0.55} /></mesh>
      </group>))}
      <mesh position={[0, 1.15, -1.25]}><boxGeometry args={[3.7, 0.12, 0.18]} /><meshStandardMaterial color="#4B83A6" metalness={0.35} /></mesh>
    </group>;
  }
  if (type === "MRO" || code === "MRO-01") {
    return <group>
      {[-1.35, -0.45, 0.45, 1.35].map((x) => <group key={x} position={[x, 0, 0]}>
        {[0.28, 0.62, 0.96, 1.3].map((y, index) => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[0.64, 0.25, 1.45]} /><meshStandardMaterial color={active ? color : index % 2 ? "#8996A1" : "#B1BBC4"} roughness={0.5} /></mesh>)}
      </group>)}
      <mesh position={[0, 0.08, 1.05]}><boxGeometry args={[3.7, 0.16, 0.52]} /><meshStandardMaterial color="#59636F" metalness={0.45} /></mesh>
    </group>;
  }
  if (type.includes("GAS") || type === "HAZMAT" || code.includes("HZW") || code.includes("BGY")) {
    return <group>{[-1.45, -0.72, 0, 0.72, 1.45].map((x, index) => <group key={x} position={[x, 0, index % 2 ? 0.5 : -0.35]}>
      <mesh position={[0, 0.92, 0]}><cylinderGeometry args={[0.28, 0.28, 1.75, 16]} /><meshStandardMaterial color={active ? color : "#C6CED5"} metalness={0.5} roughness={0.28} /></mesh>
      <mesh position={[0, 1.83, 0]}><sphereGeometry args={[0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#D8E0E6" metalness={0.5} /></mesh>
    </group>)}</group>;
  }
  if (type.includes("CHEM") || code.includes("BCY")) {
    return <group>{[-1.35, -0.45, 0.45, 1.35].map((x) => <group key={x} position={[x, 0, 0]}>
      <mesh position={[0, 0.85, 0]}><cylinderGeometry args={[0.48, 0.52, 1.7, 18]} /><meshStandardMaterial color={active ? color : "#B7C8D3"} metalness={0.25} roughness={0.32} /></mesh>
      <mesh position={[0, 0.16, 0.78]}><boxGeometry args={[0.55, 0.3, 0.42]} /><meshStandardMaterial color="#477A9B" /></mesh>
    </group>)}</group>;
  }
  if (type === "PRECURSOR" || code.includes("PRS")) {
    return <group>{[-1.35, -0.45, 0.45, 1.35].map((x) => <group key={x} position={[x, 0, 0]}>
      <mesh position={[0, 0.88, 0]}><boxGeometry args={[0.72, 1.76, 1.45]} /><meshStandardMaterial color={active ? color : "#CBD2D9"} metalness={0.2} roughness={0.35} /></mesh>
      <mesh position={[0, 0.95, 0.74]}><boxGeometry args={[0.46, 0.38, 0.04]} /><meshStandardMaterial color="#7C3AED" emissive="#7C3AED" emissiveIntensity={0.4} /></mesh>
    </group>)}</group>;
  }
  if (type === "ON_SITE" || code.includes("UPW")) {
    return <group>
      <mesh position={[-1.0, 0.85, 0]}><boxGeometry args={[1.7, 1.7, 2.1]} /><meshStandardMaterial color={active ? color : "#BAD2DE"} /></mesh>
      {[0, 0.65, 1.3].map((x) => <mesh key={x} position={[x, 0.75, 0]}><cylinderGeometry args={[0.3, 0.3, 1.5, 16]} /><meshStandardMaterial color="#D6E3E8" metalness={0.35} /></mesh>)}
    </group>;
  }
  return <group>{[-1.45, -0.72, 0, 0.72, 1.45].map((x) => <group key={x} position={[x, 0, 0]}>
    {[0.38, 0.82, 1.26].map((y) => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[0.56, 0.3, 1.9]} /><meshStandardMaterial color={active ? color : "#AAB4BE"} roughness={0.55} /></mesh>)}
  </group>)}</group>;
}

function CampusWarehouse({ warehouse, position, active, operating, quantity, unit, color, allMaterialsMode, materialCount, onClick }: {
  warehouse: UsageWarehouse;
  position: [number, number, number];
  active: boolean;
  operating: boolean;
  quantity: number;
  unit: string;
  color: string;
  allMaterialsMode: boolean;
  materialCount: number;
  onClick: () => void;
}) {
  return (
    <group position={position} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onClick(); }} onPointerEnter={() => { document.body.style.cursor = "pointer"; }} onPointerLeave={() => { document.body.style.cursor = ""; }}>
      <mesh position={[0, 0.035, 0]}><boxGeometry args={[4.3, 0.07, 3.4]} /><meshStandardMaterial color={active ? color : "#ADB7C0"} transparent opacity={active ? 0.3 : 0.13} /></mesh>
      <WarehouseStructure warehouse={warehouse} active={active} operating={operating} color={color} />
      <Text position={[0, 2.65, 0]} fontSize={0.34} color={active ? color : "#53606B"} anchorX="center">{warehouse.code}</Text>
      <Text position={[0, 2.35, 0]} fontSize={0.13} color="#66727D" anchorX="center">{warehouse.name}</Text>
      <Text position={[0, 2.12, 0]} fontSize={0.12} color={active ? color : "#8A949D"} anchorX="center">{allMaterialsMode ? `ALL MATERIALS · ${materialCount} SKU · ${warehouse.utilization}%` : active ? `SELECTED SKU · ${quantity.toLocaleString()} ${unit}` : `ALL MATERIALS · ${warehouse.utilization}%`}</Text>
    </group>
  );
}

function CampusFabEquipment({ fabId, activeProcesses, equipmentCounts, color, onProcessClick }: {
  fabId: FabId;
  activeProcesses: string[];
  equipmentCounts?: Record<string, number>;
  color: string;
  onProcessClick: (processCode: string) => void;
}) {
  const processCodes = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"];
  return <group>
    {processCodes.map((processCode, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = column === 0 ? -1.55 : 1.55;
      const z = (row - 2) * 1.65;
      const actualCount = equipmentCounts?.[processCode] ?? CAMPUS_EQUIPMENT_FALLBACK[fabId][processCode];
      const representativeCount = Math.min(3, Math.max(1, Math.ceil(actualCount / 12)));
      const highlighted = activeProcesses.includes(processCode);
      return <group key={processCode} position={[x, 0, z]} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onProcessClick(processCode); }}>
        <mesh position={[0, 0.025, 0]}>
          <boxGeometry args={[2.55, 0.05, 1.25]} />
          <meshStandardMaterial color={highlighted ? color : "#9EABB6"} transparent opacity={highlighted ? 0.24 : 0.1} />
        </mesh>
        {Array.from({ length: representativeCount }, (_, toolIndex) => {
          const toolX = (toolIndex - (representativeCount - 1) / 2) * 0.72;
          if (fabId === "M21") return <mesh key={toolIndex} position={[toolX, 0.48, 0]}>
            <cylinderGeometry args={[0.27, 0.32, 0.9, 8]} />
            <meshStandardMaterial color={highlighted ? color : "#B9C4CD"} metalness={0.24} roughness={0.36} emissive={highlighted ? color : "#000000"} emissiveIntensity={highlighted ? 0.15 : 0} />
          </mesh>;
          if (fabId === "M22") return <group key={toolIndex} position={[toolX, 0, 0]}>
            {[0.22, 0.52, 0.82].map((y) => <mesh key={y} position={[0, y, 0]}>
              <boxGeometry args={[0.5, 0.22, 0.66]} />
              <meshStandardMaterial color={highlighted ? color : "#AEB9C4"} metalness={0.18} roughness={0.42} />
            </mesh>)}
          </group>;
          return <group key={toolIndex} position={[toolX, 0, 0]}>
            <mesh position={[0, 0.48, 0]}><boxGeometry args={[0.52, 0.92, 0.64]} /><meshStandardMaterial color={highlighted ? color : "#BCC6CF"} metalness={0.28} roughness={0.34} /></mesh>
            <mesh position={[0, 1.0, 0]}><boxGeometry args={[0.34, 0.12, 0.4]} /><meshStandardMaterial color={highlighted ? "#EA002C" : "#83909C"} emissive={highlighted ? "#EA002C" : "#000000"} emissiveIntensity={highlighted ? 0.35 : 0} /></mesh>
          </group>;
        })}
        <Text position={[0, 1.34, 0]} fontSize={0.22} color={highlighted ? color : "#596672"} anchorX="center">{`${processCode} · ×${actualCount}`}</Text>
      </group>;
    })}
  </group>;
}

function CampusFab({ facility, flow, active, equipmentCounts, onFacilityClick, onProcessClick }: {
  facility: CampusFacility;
  flow: MaterialFlowFab;
  active: boolean;
  equipmentCounts?: Record<string, number>;
  onFacilityClick: () => void;
  onProcessClick: (processCode: string) => void;
}) {
  const fabId = facility.fabId!;
  return (
    <group position={facility.position} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onFacilityClick(); }} onPointerEnter={() => { document.body.style.cursor = "pointer"; }} onPointerLeave={() => { document.body.style.cursor = ""; }}>
      <mesh position={[0, 0.035, 0]}><boxGeometry args={[6.2, 0.07, 9.4]} /><meshStandardMaterial color={active ? facility.color : "#AEB6BF"} transparent opacity={active ? 0.16 : 0.06} /></mesh>
      <CampusFabEquipment fabId={fabId} activeProcesses={active ? flow.processCodes : []} equipmentCounts={equipmentCounts} color={facility.color} onProcessClick={onProcessClick} />
      <Line points={[[-3.1, 0.09, -4.7], [3.1, 0.09, -4.7], [3.1, 0.09, 4.7], [-3.1, 0.09, 4.7], [-3.1, 0.09, -4.7]]} color={facility.color} lineWidth={active ? 2 : 1} transparent opacity={active ? 0.65 : 0.2} />
      <Text position={[0, 0.11, -5.2]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.5} color={active ? facility.color : "#727A82"} anchorX="center">{facility.code} · {fabId === "M20" ? "HBM / TSV" : fabId === "M21" ? "DRAM CELL" : "3D NAND STACK"}</Text>
    </group>
  );
}

function TransferCarrier({ points, transfer, emphasized, showLabel, clockMode, serverOffsetMs, pausedAtMs }: {
  points: [number, number, number][];
  transfer: LiveTransfer;
  emphasized: boolean;
  showLabel: boolean;
  clockMode: SceneClockMode;
  serverOffsetMs: number;
  pausedAtMs: number | null;
}) {
  const ref = useRef<THREE.Group>(null);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), false, "catmullrom", 0.08), [points]);
  const color = CATEGORY_COLOR[transfer.category] ?? "#64748B";
  useFrame(({ invalidate }) => {
    if (!ref.current) return;
    const nowMs = clockMode === "PAUSED" && pausedAtMs !== null ? pausedAtMs : Date.now() + serverOffsetMs;
    const position = positionForTransfer(transfer, nowMs);
    if (position.mode === "TELEMETRY_LIVE" && position.telemetryPosition) {
      ref.current.position.set(position.telemetryPosition.x, position.telemetryPosition.y, position.telemetryPosition.z);
    } else {
      ref.current.position.copy(curve.getPoint(position.progress));
    }
    const tangent = curve.getTangent(position.progress);
    ref.current.rotation.y = Math.atan2(tangent.x, tangent.z);
    if (clockMode === "LIVE") invalidate();
  });
  const verifiedPosition = positionForTransfer(transfer, clockMode === "PAUSED" && pausedAtMs !== null ? pausedAtMs : Date.parse(transfer.updatedAt));
  const stateColor = verifiedPosition.mode === "TELEMETRY_LIVE" ? "#00B96B" : verifiedPosition.mode === "ETA_ESTIMATE" ? "#2563EB" : verifiedPosition.mode === "DELAYED" ? "#DC2626" : color;
  return <group ref={ref}>
    <mesh castShadow><boxGeometry args={[0.3, 0.2, 0.42]} /><meshStandardMaterial color={color} emissive={stateColor} emissiveIntensity={emphasized ? 0.85 : 0.38} metalness={0.24} roughness={0.22} transparent opacity={emphasized ? 1 : 0.78} /></mesh>
    <mesh position={[0, 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.24, 0.018, 8, 20]} /><meshStandardMaterial color={stateColor} emissive={stateColor} emissiveIntensity={2} /></mesh>
    {showLabel && <Text position={[0, 0.34, 0]} fontSize={0.09} color={stateColor} anchorX="center">{transfer.materialCode} · {transfer.status}</Text>}
    {showLabel && <Text position={[0, 0.23, 0]} fontSize={0.065} color="#58636D" anchorX="center">{POSITION_MODE_LABEL[verifiedPosition.mode]}</Text>}
  </group>;
}

function StaticTransferMarker({ position, color, label, count }: { position: [number, number, number]; color: string; label: string; count: number }) {
  return <group position={position}>
    <mesh><boxGeometry args={[0.42, 0.22, 0.42]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} transparent opacity={0.86} /></mesh>
    <Text position={[0, 0.3, 0]} fontSize={0.08} color={color} anchorX="center">{label} · {count}</Text>
  </group>;
}

function CampusSceneContent({ material, materials, fabScope, facilities, warehouses, transfers, clockMode, serverOffsetMs, pausedAtMs, equipmentCounts, onFacilitySelect, onWarehouseSelect, onProcessSelect }: SceneProps) {
  const fabFacilities = facilities.filter((facility) => facility.role === "FAB");
  const allMaterialsMode = material === null;
  const displayMaterial = material ?? materials[0];
  if (!displayMaterial) return null;
  const materialColor = allMaterialsMode ? "#2563EB" : CATEGORY_COLOR[displayMaterial.category] ?? "#2563EB";
  const sourceQuantity = new Map(displayMaterial.sourceLocations.map((source) => [source.facilityId, source.quantity]));
  const warehouseMaterialCounts = new Map(warehouses.map((warehouse) => [
    warehouse.code,
    new Set(materials.filter((item) => item.sourceLocations.some((source) => source.facilityId === warehouse.code)).map((item) => item.materialId)).size,
  ]));
  const warehousePositions = new Map(warehouses.map((warehouse, index) => [warehouse.code, warehousePosition(index, warehouses.length)]));
  const operatingWarehouses = new Set(transfers.filter((transfer) => transfer.status === "PICKING" || transfer.status === "STAGED").map((transfer) => transfer.fromFacilityId));
  const movingTransfers = transfers.filter((transfer) => transfer.status === "IN_TRANSIT");
  const staticGroups = [...transfers.filter((transfer) => transfer.status !== "IN_TRANSIT" && transfer.status !== "CANCELLED").reduce((groups, transfer) => {
    const key = `${transfer.fromFacilityId}:${transfer.fabId}:${transfer.status}`;
    const current = groups.get(key) ?? { transfer, count: 0 };
    current.count += 1;
    groups.set(key, current);
    return groups;
  }, new Map<string, { transfer: LiveTransfer; count: number }>()).values()];
  const aggregateFlow = (fabId: FabId) => {
    const base = displayMaterial.fabs.find((item) => item.fabId === fabId)!;
    if (!allMaterialsMode) return base;
    return {
      ...base,
      dailyUsage: materials.some((item) => (item.fabs.find((fab) => fab.fabId === fabId)?.dailyUsage ?? 0) > 0) ? 1 : 0,
      processCodes: [...new Set(materials.flatMap((item) => item.fabs.find((fab) => fab.fabId === fabId)?.processCodes ?? []))],
    };
  };

  return (
    <>
      <color attach="background" args={["#E8EDF2"]} />
      <ambientLight intensity={0.55} color="#EDF4FF" />
      <hemisphereLight intensity={1.15} color="#F6FAFF" groundColor="#AEB8C2" />
      <directionalLight position={[9, 18, -5]} intensity={1.8} color="#FFF7EA" />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, -1]}><planeGeometry args={[44, 42]} /><meshStandardMaterial color="#DDE3E8" roughness={0.72} metalness={0.05} /></mesh>
      <gridHelper args={[44, 44, "#AAB4BE", "#CDD4DB"]} position={[0, 0, -1]} />

      {warehouses.map((warehouse) => {
        const position = warehousePositions.get(warehouse.code)!;
        const quantity = sourceQuantity.get(warehouse.code) ?? 0;
        const materialCount = warehouseMaterialCounts.get(warehouse.code) ?? 0;
        const activeSource = allMaterialsMode ? materialCount > 0 : quantity > 0;
        const feed: [number, number, number][] = [[position[0], 0.12, position[2] + 1.8], [position[0], 0.12, -3], [0, 0.12, -2]];
        return <group key={warehouse.code}>
          <Line points={feed} color={activeSource ? materialColor : "#8D99A4"} lineWidth={activeSource ? 2.5 : 0.7} transparent opacity={activeSource ? 0.8 : 0.15} />
          <CampusWarehouse warehouse={warehouse} position={position} active={activeSource} operating={clockMode === "LIVE" && operatingWarehouses.has(warehouse.code)} quantity={quantity} unit={displayMaterial.unit} color={materialColor} allMaterialsMode={allMaterialsMode} materialCount={materialCount} onClick={() => onWarehouseSelect(warehouse.code)} />
        </group>;
      })}

      {fabFacilities.map((facility) => {
        const x = facility.position[0];
        const flow = aggregateFlow(facility.fabId!);
        const activeFab = fabScope === "CAMPUS" || fabScope === facility.fabId;
        const branch: [number, number, number][] = [[0, 0.13, -2], [x, 0.13, -1], [x, 0.13, 2.3]];
        return <group key={facility.id}>
          <Line points={branch} color={activeFab && flow.dailyUsage > 0 ? facility.color : "#8D99A4"} lineWidth={activeFab && flow.dailyUsage > 0 ? 2.8 : 0.8} transparent opacity={activeFab && flow.dailyUsage > 0 ? 0.85 : 0.16} />
        </group>;
      })}

      {movingTransfers.map((transfer, index) => {
        const origin = warehousePositions.get(transfer.fromFacilityId);
        const destination = fabFacilities.find((facility) => facility.fabId === transfer.fabId);
        if (!origin || !destination || transfer.status === "CANCELLED") return null;
        const laneY = 0.5 + (index % 5) * 0.11;
        const laneOffset = ((index % 7) - 3) * 0.07;
        const route: [number, number, number][] = [
          [origin[0] + laneOffset, laneY, origin[2] + 1.8],
          [origin[0] + laneOffset, laneY, -3],
          [laneOffset, laneY, -2],
          [destination.position[0] + laneOffset, laneY, -1],
          [destination.position[0] + laneOffset, laneY, 2.4],
        ];
        return <TransferCarrier key={transfer.id} points={route} transfer={transfer} emphasized={allMaterialsMode || transfer.materialId === displayMaterial.materialId} showLabel={!allMaterialsMode} clockMode={clockMode} serverOffsetMs={serverOffsetMs} pausedAtMs={pausedAtMs} />;
      })}

      {staticGroups.map(({ transfer, count }, index) => {
        const origin = warehousePositions.get(transfer.fromFacilityId);
        const destination = fabFacilities.find((facility) => facility.fabId === transfer.fabId);
        if (!origin || !destination) return null;
        const atDestination = transfer.status === "RECEIVED" || transfer.status === "DELIVERED";
        const position: [number, number, number] = atDestination
          ? [destination.position[0] + ((index % 5) - 2) * 0.3, 0.45, 2.3]
          : [origin[0] + ((index % 5) - 2) * 0.3, 0.45, origin[2] + 2.1];
        return <StaticTransferMarker key={`${transfer.fromFacilityId}-${transfer.fabId}-${transfer.status}`} position={position} color={CATEGORY_COLOR[transfer.category] ?? "#64748B"} label={transfer.status} count={count} />;
      })}

      {fabFacilities.map((facility) => {
        const flow = aggregateFlow(facility.fabId!);
        const active = fabScope === "CAMPUS" || fabScope === facility.fabId;
        return <CampusFab key={facility.id} facility={facility} flow={flow} active={active} equipmentCounts={facility.fabId ? equipmentCounts[facility.fabId] : undefined} onFacilityClick={() => onFacilitySelect(facility.id)} onProcessClick={(processCode) => facility.fabId && onProcessSelect(facility.fabId, processCode)} />;
      })}

      <Text position={[0, 0.04, -2.65]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.24} color="#53606B">{allMaterialsMode ? "ALL MATERIALS LOGISTICS TRUNK" : "SELECTED SKU MATERIAL LOGISTICS TRUNK"}</Text>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={10} maxDistance={58} maxPolarAngle={Math.PI / 2.08} />
    </>
  );
}

function CampusSceneFallback({ material, materials, warehouses, transfers, equipmentCounts, onRetry }: SceneProps & { onRetry: () => void }) {
  const selectedLabel = material ? `${material.code} · ${material.name}` : `전체 자재 ${materials.length}종`;
  return <div className="flex h-full flex-col bg-[#E8EDF2] p-5" data-testid="campus-scene-fallback">
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#596672]">Campus operational scene</div>
        <div className="mt-1 text-sm font-black text-[#20262D]">{selectedLabel}</div>
        <div className="mt-1 text-[10px] text-[#6D7882]">WebGL 자동 복구 대기 중 · 운영 데이터 장면은 계속 표시</div>
      </div>
      <button type="button" onClick={onRetry} className="border border-[#8DA0B2] bg-white px-3 py-2 text-[10px] font-black text-[#40505E]">3D 다시 시도</button>
    </div>

    <div className="mt-5 rounded border border-[#91A1AE] bg-white/80 p-4">
      <div className="text-center text-[10px] font-black tracking-[0.1em] text-[#485765]">1WMS · ALL MATERIAL WAREHOUSES</div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {warehouses.map((warehouse) => {
          const materialCount = materials.filter((item) => item.sourceLocations.some((location) => location.facilityId === warehouse.code)).length;
          return <div key={warehouse.code} className="border border-[#C8D1D9] bg-[#F7F9FB] px-3 py-2">
            <div className="text-[10px] font-black text-[#33414E]">{warehouse.code}</div>
            <div className="mt-1 truncate text-[9px] text-[#6C7883]">{warehouse.name}</div>
            <div className="mt-1 font-mono text-[9px] font-bold text-[#1D5FBF]">{materialCount} SKU · {warehouse.utilization}%</div>
          </div>;
        })}
      </div>
    </div>

    <div className="mx-auto h-8 w-px bg-[#667785]" />
    <div className="grid flex-1 grid-cols-3 gap-3">
      {(["M20", "M21", "M22"] as FabId[]).map((fabId) => {
        const processCount = new Set(materials.flatMap((item) => item.fabs.find((fab) => fab.fabId === fabId)?.processCodes ?? [])).size;
        const equipmentTotal = Object.values(equipmentCounts[fabId] ?? CAMPUS_EQUIPMENT_FALLBACK[fabId]).reduce((sum, count) => sum + count, 0);
        const transferCount = transfers.filter((transfer) => transfer.fabId === fabId).length;
        return <div key={fabId} className="relative border-2 bg-white/85 p-4" style={{ borderColor: fabId === "M20" ? "#EA002C" : fabId === "M21" ? "#2F75C9" : "#8B3FD6" }}>
          <div className="text-base font-black text-[#20262D]">{fabId}</div>
          <div className="mt-1 text-[9px] font-bold text-[#6D7882]">{fabId === "M20" ? "HBM / TSV" : fabId === "M21" ? "DRAM CELL" : "3D NAND STACK"}</div>
          <div className="mt-4 grid gap-2 text-[10px]">
            <div className="flex justify-between"><span>연결 공정</span><strong>{processCount}개</strong></div>
            <div className="flex justify-between"><span>장비 원장</span><strong>{equipmentTotal}대</strong></div>
            <div className="flex justify-between"><span>TransferOrder</span><strong>{transferCount}건</strong></div>
          </div>
        </div>;
      })}
    </div>
  </div>;
}

export default function CampusScene3D(props: SceneProps) {
  const [rendererVersion, setRendererVersion] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const recoveryAttempts = useRef(0);

  const retry = () => {
    recoveryAttempts.current = 0;
    setContextLost(false);
    setRendererVersion((version) => version + 1);
  };

  return <div className="relative h-full overflow-hidden bg-[#E8EDF2]">
    {contextLost && <div className="absolute inset-0 z-10"><CampusSceneFallback {...props} onRetry={retry} /></div>}
    <Canvas
      key={rendererVersion}
      frameloop="demand"
      dpr={1}
      camera={{ position: [23, 25, 29], fov: 43, near: 0.1, far: 150 }}
      gl={{ antialias: true, alpha: false, powerPreference: "default", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.06 }}
      style={{ opacity: contextLost ? 0 : 1, pointerEvents: contextLost ? "none" : "auto" }}
      onCreated={({ gl, invalidate }) => {
        const canvas = gl.domElement;
        canvas.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          setContextLost(true);
          if (recoveryAttempts.current === 0) {
            recoveryAttempts.current = 1;
            window.setTimeout(() => {
              setRendererVersion((version) => version + 1);
              setContextLost(false);
            }, 250);
          }
        });
        canvas.addEventListener("webglcontextrestored", () => {
          setContextLost(false);
          invalidate();
        });
      }}
    >
      <CampusSceneContent {...props} />
    </Canvas>
  </div>;
}
