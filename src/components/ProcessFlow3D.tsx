"use client";

import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Text, CameraControls, Environment, Lightformer, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import PanCameraControls from "@/components/PanCameraControls";
import type { FabId } from "@/lib/fab-domain";
import type { FoupFleetProjection } from "@/lib/foup-wip-model";

import { PROCESSES } from "@/lib/processes";
import {
  buildOhtAccessPoints,
  buildDenseProcessEquipmentLayout,
  M20_DENSE_PROCESS_ZONES,
} from "@/lib/equipment-3d-layout";
export type { ProcessDef } from "@/lib/processes";
export { PROCESSES };

const PITCH     = 0.82;
const TOOL_SCALE = 0.68;
const MACHINE_W = 0.72;

// 29개 고밀도 bay를 중앙 OHT spine 양쪽에 배치하는 M20 생산층 envelope.
const FAB_W = 22;
const FAB_D = 45;
const FAB_CENTER_Z = -2.25;

// ─── 자재 카테고리 색 (usage 테이블과 통일) ───
export const CATEGORY_COLOR: Record<string, string> = {
  GAS: "#B91C1C", // 가스 — 빨강
  CHM: "#1D4ED8", // 케미컬 — 파랑
  CSM: "#7C3AED", // 소모성 — 보라
  UTL: "#059669", // 유틸리티 — 초록
  PKG: "#64748B", // 패키징 — 슬레이트
};

// ─── 자재창고 배치 (fab 서측 자재 야드) ───
// 실제 팹처럼 종류별로 크기·형태가 다름. x는 좌측 야드, z는 코드별 배치.
// kind: asrs=고층 자동화랙 / hazmat=방폭 저층 별동 / flat=평치 중층 / mro=소형
const WH_X = -(FAB_W / 2 + 5.5);
const WH_META: Record<string, {
  z: number; short: string; lane: number;
  kind: "asrs" | "hazmat" | "flat" | "mro";
  w: number; d: number; h: number;
}> = {
  "MWH-01": { z: -9.5, short: "자동화 자재창고 (AS/RS)", lane: 0, kind: "asrs",   w: 3.4, d: 6.0, h: 7.2 }, // 고층 자동화
  "HZW-01": { z: -2.0, short: "특수가스 위험물창고",       lane: 1, kind: "hazmat", w: 3.0, d: 3.4, h: 2.3 }, // 방폭 저층
  "MWH-02": { z:  6.0, short: "항온 자재창고",            lane: 2, kind: "flat",   w: 3.2, d: 4.4, h: 3.6 }, // 중층
  "MRO-01": { z: 11.6, short: "공구·MRO 창고",           lane: 3, kind: "mro",    w: 2.6, d: 3.0, h: 2.8 }, // 소형
};
const WH_HEADER_X = -(FAB_W / 2 + 0.5); // 벽면 서플라이 헤더 X

// 가스야드 (벌크가스 ISO 탱크 — 창고 아님, 배관으로 팹 공급)
const GAS_YARD = { x: WH_X - 0.7, z: -15.0 };
const SUPPLY_ORIGIN: Record<string, { x: number; z: number; lane: number }> = {
  "BGY-01": { x: GAS_YARD.x, z: GAS_YARD.z, lane: 0 },
  "BCY-01": { x: GAS_YARD.x, z: -12.8, lane: 1 },
  "PRS-01": { x: GAS_YARD.x, z: -5.8,  lane: 2 },
  "UPW-01": { x: GAS_YARD.x, z:  3.0,  lane: 3 },
};

// Route 순서를 지그재그로 접어 연속 공정의 이동거리를 줄인다.
// 같은 row의 좌우 공정은 OHT spine 하나만 건너고, 다음 공정은 같은 side의 인접 row에 둔다.
const PROCESS_ZONE = M20_DENSE_PROCESS_ZONES;
const BAY_X = Object.fromEntries(Object.entries(PROCESS_ZONE).map(([code, zone]) => [code, zone.x])) as Record<string, number>;
const BAY_Z = Object.fromEntries(Object.entries(PROCESS_ZONE).map(([code, zone]) => [code, zone.z])) as Record<string, number>;
const PROCESS_ACCESS = buildOhtAccessPoints(PROCESS_ZONE);
const BACKEND_LINE = {
  x: 0,
  testX: -5.2,
  handoffX: 0,
  packagingX: 5.2,
  testZ: 15.2,
  handoffZ: 18.2,
  packagingZ: 15.2,
  outboundZ: 18.2,
  agvX: 10.1,
} as const;

// ─────────────────────────────────────────────
// HBM-style recipe: Photo/Etch repeat many times
// ─────────────────────────────────────────────
export const WAFER_RECIPE = [
  "P01",            // 1. Gate oxide
  "P03", "P04",     // 2-3. Gate pattern + etch  (Photo visit #1)
  "P05",            // 4. S/D ion implant
  "P02", "P07",     // 5-6. ILD CVD + CMP
  "P03", "P04",     // 7-8. Contact pattern       (Photo visit #2)
  "P06", "P07",     // 9-10. Metal1 + CMP
  "P03", "P04",     // 11-12. Via1 pattern         (Photo visit #3)
  "P06", "P07",     // 13-14. Via1 fill + CMP
  "P03", "P04",     // 15-16. Metal2               (Photo visit #4)
  "P06", "P07",     // 17-18. Metal2 fill + CMP
  "P03", "P04",     // 19-20. Via2                 (Photo visit #5)
  "P06", "P02",     // 21-22. Metal3 + Passivation
  "P08",            // 23. TSV / 3D stacking
  "P09",            // 24. Wafer electrical test
  "P10",            // 25. Packaging umbrella
];

export const WAFER_CONFIGS = [
  { id: "W01",  label: "FOUP-01", color: "#EF4444", startStep: 0  },
  { id: "W02",  label: "FOUP-02", color: "#3B82F6", startStep: 2  },
  { id: "W03",  label: "FOUP-03", color: "#EAB308", startStep: 4  },
  { id: "W04",  label: "FOUP-04", color: "#10B981", startStep: 6  },
  { id: "W05",  label: "FOUP-05", color: "#8B5CF6", startStep: 8  },
  { id: "W06",  label: "FOUP-06", color: "#F97316", startStep: 10 },
  { id: "W07",  label: "FOUP-07", color: "#06B6D4", startStep: 12 },
  { id: "W08",  label: "FOUP-08", color: "#EC4899", startStep: 14 },
  { id: "W09",  label: "FOUP-09", color: "#84CC16", startStep: 16 },
  { id: "W10",  label: "FOUP-10", color: "#F59E0B", startStep: 18 },
  { id: "W11",  label: "FOUP-11", color: "#D946EF", startStep: 20 },
  { id: "W12",  label: "FOUP-12", color: "#64748B", startStep: 22 },
];
const CAMPUS_FOUP_CONFIGS = WAFER_CONFIGS.slice(0, 4);

const RAIL_Y        = 3.18;
const PROCESS_SECS  = 2.2;
const TRAVEL_SPEED  = 5.5; // units/sec

type WaferState = {
  id: string;
  color: string;
  stepIdx: number;
  phase: "processing" | "traveling";
  timer: number;
  t: number;       // path progress 0→1
  tSpeed: number;  // dt per second
  curve: THREE.CatmullRomCurve3 | null;
  currentBay: string;
};

// 실제 lotStepEvents 원장을 폴링해서 얻은, 하드코딩이 아닌 진짜 로트 위치.
export type LiveFoupView = {
  lotId: string;
  foupLabel: string; // "FOUP-01"
  processCode: string; // 현재 베이 (P01~P10)
  nodeLabel: string; // routeMaster 노드 설명
  stepIndex: number; // 전체 시퀀스 중 절대 순번 (0-based)
  totalSteps: number;
  isDone: boolean;
};

function makeCurve(fromCode: string, toCode: string): THREE.CatmullRomCurve3 {
  const from = PROCESS_ACCESS[fromCode] ?? PROCESS_ACCESS.P01;
  const to = PROCESS_ACCESS[toCode] ?? PROCESS_ACCESS.P01;
  if (fromCode === "P09" && toCode === "P10") {
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(from.x, RAIL_Y, from.z),
      new THREE.Vector3(0, RAIL_Y, from.z),
      new THREE.Vector3(0, RAIL_Y, BACKEND_LINE.handoffZ),
      new THREE.Vector3(BACKEND_LINE.agvX, 0.32, BACKEND_LINE.handoffZ),
      new THREE.Vector3(BACKEND_LINE.agvX, 0.32, BACKEND_LINE.packagingZ),
      new THREE.Vector3(9.35, 0.32, BACKEND_LINE.packagingZ),
    ]);
  }
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(from.x, RAIL_Y, from.z),
    new THREE.Vector3(0, RAIL_Y, from.z),
    new THREE.Vector3(0, RAIL_Y, (from.z + to.z) / 2),
    new THREE.Vector3(0, RAIL_Y, to.z),
    new THREE.Vector3(to.x, RAIL_Y, to.z),
  ]);
}

// ─────────────────────────────────────────────
// 공정별 장비 실루엣 (리소/클러스터/CMP/퍼니스/박스)
// ─────────────────────────────────────────────
type ToolKind = "box" | "furnace" | "litho" | "cluster" | "cmp";
const PROCESS_KIND: Record<string, ToolKind> = {
  P01: "furnace", P02: "cluster", P03: "litho", P04: "cluster", P05: "box",
  P06: "cluster", P07: "cmp", P08: "cluster", P09: "box", P10: "box",
};
// 종류별 크기 [w, h, d]
const TOOL_DIM: Record<ToolKind, [number, number, number]> = {
  box:     [0.72, 1.75, 0.65],
  furnace: [0.6,  2.55, 0.62],
  litho:   [1.15, 2.05, 1.2],
  cluster: [0.9,  1.35, 0.9],
  cmp:     [0.95, 1.15, 0.95],
};

function InstancedFabTools({ layout, proc, isHL, isDimmed, kind }: {
  layout: ReturnType<typeof buildDenseProcessEquipmentLayout>["equipment"];
  proc: typeof PROCESSES[0];
  isHL: boolean;
  isDimmed: boolean;
  kind: ToolKind;
}) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const efemRef = useRef<THREE.InstancedMesh>(null);
  const beaconRef = useRef<THREE.InstancedMesh>(null);
  const loadPortRef = useRef<THREE.InstancedMesh>(null);
  const bodyColor = isDimmed ? "#d3d7dc" : isHL ? "#eef4ff" : "#dde0e5";
  const op = isDimmed ? 0.45 : 1;
  const [w, h, d] = TOOL_DIM[kind];

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const efem = efemRef.current;
    const beacon = beaconRef.current;
    const loadPort = loadPortRef.current;
    if (!body || !efem || !beacon || !loadPort) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(TOOL_SCALE, TOOL_SCALE, TOOL_SCALE);
    layout.forEach((tool, index) => {
      const front = tool.facing * (d * TOOL_SCALE / 2 + 0.2);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tool.facing === -1 ? Math.PI : 0);
      matrix.compose(position.set(tool.x, h * TOOL_SCALE / 2, tool.z), quaternion, scale);
      body.setMatrixAt(index, matrix);
      matrix.compose(position.set(tool.x, 0.48 * TOOL_SCALE, tool.z + front), quaternion, scale);
      efem.setMatrixAt(index, matrix);
      matrix.compose(position.set(tool.x, (h + 0.05) * TOOL_SCALE, tool.z), quaternion, scale);
      beacon.setMatrixAt(index, matrix);
      for (const [portIndex, xOffset] of [-0.13, 0.13].entries()) {
        matrix.compose(position.set(tool.x + xOffset, 1.08 * TOOL_SCALE, tool.z + front + tool.facing * 0.03), quaternion, scale);
        loadPort.setMatrixAt(index * 2 + portIndex, matrix);
      }
    });
    for (const mesh of [body, efem, beacon, loadPort]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [d, h, layout]);

  return (
    <group userData={{ equipmentInstanceCount: layout.length, processCode: proc.code }}>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, layout.length]} castShadow>
        {kind === "cluster"
          ? <cylinderGeometry args={[w * 0.42, w * 0.42, h, 8]} />
          : <boxGeometry args={[w, h, d]} />}
        <meshStandardMaterial color={bodyColor} roughness={0.34} metalness={0.32}
          emissive={isHL ? proc.color : "#000"} emissiveIntensity={isHL ? 0.15 : 0}
          transparent opacity={op} />
      </instancedMesh>
      <instancedMesh ref={efemRef} args={[undefined, undefined, layout.length]} castShadow>
        <boxGeometry args={[w * 0.92, 0.96, 0.5]} />
        <meshStandardMaterial color={isDimmed ? "#cfd4da" : "#dfe4ea"} roughness={0.3} metalness={0.1} transparent opacity={op} />
      </instancedMesh>
      <instancedMesh ref={beaconRef} args={[undefined, undefined, layout.length]}>
        <boxGeometry args={[Math.min(w, 0.5) * 0.6, 0.08, Math.min(d, 0.5) * 0.6]} />
        <meshStandardMaterial color={proc.color} emissive={proc.color}
          emissiveIntensity={isHL ? 1.8 : isDimmed ? 0.15 : 0.6} transparent opacity={op} />
      </instancedMesh>
      <instancedMesh ref={loadPortRef} args={[undefined, undefined, layout.length * 2]}>
        <boxGeometry args={[0.22, 0.26, 0.22]} />
        <meshStandardMaterial color={proc.color} roughness={0.4}
          emissive={proc.color} emissiveIntensity={isDimmed ? 0.05 : isHL ? 0.6 : 0.25} transparent opacity={op} />
      </instancedMesh>
    </group>
  );
}

// ─────────────────────────────────────────────
// Process bay (2 equipment rows + AMHS intrabay rail)
// ─────────────────────────────────────────────
function ProcessBay({ proc, isHL, isDimmed, onClick, actualMachineCount }: {
  proc: typeof PROCESSES[0]; isHL: boolean; isDimmed: boolean;
  onClick: () => void; actualMachineCount?: number;
}) {
  const [hov, setHov] = useState(false);
  const zone = PROCESS_ZONE[proc.code] ?? PROCESS_ZONE.P01;
  const actualCount = actualMachineCount ?? proc.nMachines * 2;
  const kind   = PROCESS_KIND[proc.code] ?? "box";
  const rowGap = 0.72;
  const denseLayout = useMemo(
    () => buildDenseProcessEquipmentLayout(actualCount, zone.x, zone.z, PITCH, rowGap, 20, 2.3),
    [actualCount, zone.x, zone.z],
  );
  return (
    <group>
      {denseLayout.bays.map((bay) => {
        const bayW = (Math.max(Math.ceil(bay.count / 2), 1) - 1) * PITCH + MACHINE_W * TOOL_SCALE + 0.34;
        const railLength = Math.abs(zone.x);
        return <React.Fragment key={`${proc.code}-B${bay.index + 1}`}>
          <mesh position={[zone.x, 0.01, bay.centerZ]}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            onPointerEnter={(e) => { e.stopPropagation(); setHov(true); document.body.style.cursor = "pointer"; }}
            onPointerLeave={() => { setHov(false); document.body.style.cursor = ""; }}>
            <boxGeometry args={[bayW, 0.02, 2.2]} />
            <meshStandardMaterial transparent opacity={0} />
          </mesh>
          <mesh position={[zone.x, 0.003, bay.centerZ]}>
            <boxGeometry args={[bayW, 0.005, 2.2]} />
            <meshStandardMaterial color={proc.yellowBay ? "#ffd700" : proc.color} transparent
              opacity={isDimmed ? 0.03 : isHL ? 0.18 : hov ? 0.1 : proc.yellowBay ? 0.06 : 0.05} />
          </mesh>
          {/* 장비 전면이 공유하는 작업 aisle */}
          <mesh position={[zone.x, 0.006, bay.centerZ]}>
            <boxGeometry args={[bayW + 0.16, 0.006, 0.48]} />
            <meshStandardMaterial color="#e8f0fa" transparent opacity={isDimmed ? 0.05 : 0.58} />
          </mesh>
          {/* 두 장비열 후면의 service chase */}
          {[bay.centerZ - 1.0, bay.centerZ + 1.0].map((chaseZ) => (
            <mesh key={chaseZ} position={[zone.x, 0.005, chaseZ]}>
              <boxGeometry args={[bayW, 0.005, 0.26]} />
              <meshStandardMaterial color="#aeb7c1" transparent opacity={isDimmed ? 0.04 : 0.5} />
            </mesh>
          ))}
          {/* P10 내부에서 FOUP/wafer가 die tray·stack으로 전환되므로 AGV branch만 사용한다. */}
          {proc.code !== "P10" && <>
            <mesh position={[zone.x, 2.58, bay.centerZ]}>
              <boxGeometry args={[bayW + 0.12, 0.045, 0.07]} />
              <meshStandardMaterial color="#8ea0b1" metalness={0.65} roughness={0.28} transparent opacity={isDimmed ? 0.3 : 1} />
            </mesh>
            <mesh position={[zone.x / 2, 2.58, bay.centerZ]}>
              <boxGeometry args={[railLength, 0.045, 0.07]} />
              <meshStandardMaterial color="#8ea0b1" metalness={0.65} roughness={0.28} transparent opacity={isDimmed ? 0.3 : 1} />
            </mesh>
          </>}
        </React.Fragment>;
      })}

      {/* Photo bay subtle ambient — static intensity, no flash */}
      {proc.yellowBay && (
        <pointLight position={[zone.x, 3.5, zone.z]} color="#ffd000" intensity={0.8} distance={5} decay={2} />
      )}

      {/* 실제 원장 대수 전체를 1 body instance = 1 equipment로 배치한다. */}
      <InstancedFabTools layout={denseLayout.equipment} proc={proc} kind={kind} isHL={isHL} isDimmed={isDimmed} />

      {/* Bay labels */}
      <Text position={[zone.x, 2.95, zone.z]} fontSize={0.2}
        color={isHL ? proc.color : hov ? proc.color : "#374151"}
        anchorX="center" anchorY="middle">
        {`${proc.code}  ${proc.name} · ${denseLayout.bays.length} BAYS`}
      </Text>
      <Text position={[zone.x, 2.75, zone.z]} fontSize={0.105} color={isHL ? proc.color : "#7f8b96"}
        anchorX="center" anchorY="middle">
        {`${proc.nameEn} · 원장/3D ×${denseLayout.equipment.length}대`}
      </Text>

      {/* FOUP 수량은 화면 overlay에서 읽고, 3D 공간에는 density instance만 둔다. */}
    </group>
  );
}

// ─────────────────────────────────────────────
// Overhead AMHS rails (no solid ceiling)
// ─────────────────────────────────────────────
function OverheadInfra() {
  const ohtStartZ = -23.5;
  const ohtEndZ = BACKEND_LINE.handoffZ;
  const ohtCenterZ = (ohtStartZ + ohtEndZ) / 2;
  const processRows = [-21.2, -11.6, -2, 7.6];
  const lightRows = [...processRows, BACKEND_LINE.testZ];
  return (
    <group>
      {/* 중앙 OHT main spine: 왕복 2선 */}
      {[-0.18, 0.18].map((x) => (
        <mesh key={x} position={[x, RAIL_Y, ohtCenterZ]}>
          <boxGeometry args={[0.07, 0.055, ohtEndZ - ohtStartZ]} />
          <meshStandardMaterial color="#8898aa" metalness={0.75} roughness={0.2} />
        </mesh>
      ))}
      {/* 각 공정 zone의 stocker/access point를 spine에 연결 */}
      {processRows.map((z) => (
        <mesh key={z} position={[0, RAIL_Y, z]}>
          <boxGeometry args={[FAB_W - 1.2, 0.045, 0.055]} />
          <meshStandardMaterial color="#9aabb8" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      {[-7.8, -2.6, 2.6, 7.8].map((x) =>
        lightRows.map((z) => (
          <mesh key={`ls-${x}-${z}`} position={[x, RAIL_Y - 0.07, z]}>
            <boxGeometry args={[0.12, 0.018, 1.8]} />
            <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={0.45} />
          </mesh>
        ))
      )}
      <Text position={[0.5, RAIL_Y + 0.2, -22.8]} fontSize={0.15} color="#64748b" anchorX="left">OHT MAIN SPINE</Text>
    </group>
  );
}

function AgvVehicle({ offset, color }: { offset: number; color: string }) {
  const ref = useRef<THREE.Group>(null);
  const curve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(-10.1, 0.12, -23), new THREE.Vector3(10.1, 0.12, -23),
    new THREE.Vector3(10.1, 0.12, 19), new THREE.Vector3(-10.1, 0.12, 19),
  ], true, "catmullrom", 0.04), []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const progress = (clock.elapsedTime * 0.025 + offset) % 1;
    ref.current.position.copy(curve.getPoint(progress));
    const tangent = curve.getTangent(progress);
    ref.current.rotation.y = Math.atan2(tangent.x, tangent.z);
  });
  return <group ref={ref}>
    <mesh><boxGeometry args={[0.48, 0.18, 0.7]} /><meshStandardMaterial color="#475569" metalness={0.45} roughness={0.3} /></mesh>
    <mesh position={[0, 0.13, 0]}><boxGeometry args={[0.38, 0.12, 0.5]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} /></mesh>
  </group>;
}

function AgvLogisticsInfra() {
  const crossAisles = [-23, -16.4, -6.8, 2.8, 11.4, 18.2, 19];
  return <group>
    {/* 장비 bay와 분리한 바닥 AGV 외곽 loop */}
    {[-10.1, 10.1].map((x) => <mesh key={x} position={[x, 0.012, -2]}>
      <boxGeometry args={[0.62, 0.012, 42]} />
      <meshStandardMaterial color="#334155" transparent opacity={0.34} />
    </mesh>)}
    {crossAisles.map((z) => <mesh key={z} position={[0, 0.013, z]}>
      <boxGeometry args={[20.2, 0.013, 0.62]} />
      <meshStandardMaterial color="#475569" transparent opacity={0.25} />
    </mesh>)}
    {[-16.4, -6.8, 2.8, 11.4].map((z) => <group key={`transfer-${z}`} position={[0, 0, z]}>
      <mesh position={[0, 0.035, 0]}><boxGeometry args={[1.3, 0.07, 0.9]} /><meshStandardMaterial color="#0ea5e9" transparent opacity={0.42} /></mesh>
      <Text position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.1} color="#0369a1">OHT ↔ AGV</Text>
    </group>)}
    {/* P10 singulation 이후 wafer/FOUP에서 die tray·stack 물류로 전환되는 handoff */}
    <group position={[0, 0, BACKEND_LINE.handoffZ]}>
      <mesh position={[0, 0.055, 0]}><boxGeometry args={[2.1, 0.1, 0.9]} /><meshStandardMaterial color="#d946ef" transparent opacity={0.62} /></mesh>
      <Text position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.12} color="#86198f">P10 OUTPUT · WAFER → MEMORY KGD TRAY</Text>
    </group>
    <group position={[BACKEND_LINE.agvX, 0, BACKEND_LINE.outboundZ]}>
      <mesh position={[0, 0.055, 0]}><boxGeometry args={[1.25, 0.1, 1.0]} /><meshStandardMaterial color="#22c55e" transparent opacity={0.55} /></mesh>
      <Text position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.11} color="#166534">STACK BUFFER · AGV OUTBOUND</Text>
    </group>
    <AgvVehicle offset={0} color="#f59e0b" />
    <AgvVehicle offset={0.5} color="#22c55e" />
    <Text position={[-9.7, 0.08, -22.4]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.14} color="#334155" anchorX="left">AGV GROUND LOOP</Text>
  </group>;
}

function BackendIntegratedLine() {
  const centerZ = (BACKEND_LINE.testZ + BACKEND_LINE.handoffZ) / 2;
  return <group userData={{ line: "P09_P10_BACKEND", carrierView: "DERIVED_VIEW" }}>
    {/* P10 Packaging 내부 operation들이 하나의 back-end 물류 envelope를 공유한다. */}
    <mesh position={[BACKEND_LINE.x, 0.002, centerZ]}>
      <boxGeometry args={[20.2, 0.004, 6.6]} />
      <meshStandardMaterial color="#c026d3" transparent opacity={0.045} />
    </mesh>
    {/* P09 wafer test → P10 packaging 내부 singulation·assembly를 잇는 연속 작업/물류 aisle */}
    <mesh position={[0, 0.016, BACKEND_LINE.handoffZ]}>
      <boxGeometry args={[20.2, 0.014, 0.72]} />
      <meshStandardMaterial color="#dbeafe" transparent opacity={0.55} />
    </mesh>
    {/* 두 공정이 공유하는 후면 service chase */}
    <mesh position={[0, 0.017, 12.55]}>
      <boxGeometry args={[19.2, 0.015, 0.48]} />
      <meshStandardMaterial color="#94a3b8" transparent opacity={0.48} />
    </mesh>
    {/* P10 내부 handoff 이후 우측 외곽 outbound를 잇는 die/stack AGV lane */}
    <mesh position={[(BACKEND_LINE.handoffX + BACKEND_LINE.agvX) / 2, 0.019, BACKEND_LINE.handoffZ]}>
      <boxGeometry args={[BACKEND_LINE.agvX - BACKEND_LINE.handoffX, 0.018, 0.62]} />
      <meshStandardMaterial color="#475569" transparent opacity={0.42} />
    </mesh>
    <Text position={[BACKEND_LINE.x, 3.35, BACKEND_LINE.testZ]} fontSize={0.23} color="#86198f" anchorX="center">
      P09 TEST → P10 PACKAGING · SINGULATION → BASE DIE MERGE → 12-HI
    </Text>
    <Text position={[BACKEND_LINE.x, 3.1, BACKEND_LINE.testZ]} fontSize={0.095} color="#7e22ce" anchorX="center">
      FOUP/WAFER → MEMORY KGD TRAY → HBM STACK · P10 OPERATION CAPA
    </Text>
    {[
      [BACKEND_LINE.testX, "P09 · WAFER TEST"],
      [BACKEND_LINE.handoffX, "P10 · DICING · DIE SORT · KGD"],
      [BACKEND_LINE.packagingX, "P10 · BASE KGD MERGE · 12-HI BOND · FINAL TEST"],
      [BACKEND_LINE.agvX, "STACK OUTBOUND"],
    ].map(([x, label]) => <Text key={label as string} position={[x as number, 0.08, BACKEND_LINE.handoffZ]}
      rotation={[-Math.PI / 2, 0, 0]} fontSize={0.1} color="#6b21a8" anchorX="center">{label}</Text>)}
  </group>;
}

// ─────────────────────────────────────────────
// Animated FOUP on the AMHS rail
// ─────────────────────────────────────────────
function AnimatedFoup({ config, stateRef, dimmed = false }: {
  config: typeof WAFER_CONFIGS[0];
  stateRef: React.MutableRefObject<WaferState>;
  dimmed?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef  = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    const s = stateRef.current;
    const g = groupRef.current;
    if (!g) return;

    if (s.phase === "processing") {
      s.timer -= dt;
      if (s.timer <= 0) {
        const nextStep = (s.stepIdx + 1) % WAFER_RECIPE.length;
        const nextBay  = WAFER_RECIPE[nextStep];
        s.curve  = makeCurve(s.currentBay, nextBay);
        s.tSpeed = TRAVEL_SPEED / s.curve.getLength();
        s.t      = 0;
        s.phase  = "traveling";
        s.stepIdx = nextStep;
      }
    } else if (s.phase === "traveling" && s.curve) {
      s.t += dt * s.tSpeed;
      if (!s.curve) return;
      if (s.t >= 1) {
        s.t         = 1;
        s.phase     = "processing";
        s.timer     = PROCESS_SECS;
        s.currentBay = WAFER_RECIPE[s.stepIdx];
        s.curve     = null;
      }
      if (s.curve) {
        const pt = s.curve.getPoint(Math.min(s.t, 1));
        g.position.copy(pt);
      }
    }

    // Pulsing ring when processing
    if (ringRef.current) {
      const scale = s.phase === "processing" ? 1 + 0.15 * Math.sin(Date.now() * 0.004) : 1;
      ringRef.current.scale.setScalar(scale);
    }
  });

  // Set initial position
  const initPos = useMemo(() => {
    const processCode = WAFER_RECIPE[config.startStep] ?? "P01";
    const access = PROCESS_ACCESS[processCode] ?? PROCESS_ACCESS.P01;
    return new THREE.Vector3(access.x, RAIL_Y, access.z);
  }, [config.startStep]);

  const bodyOpacity = dimmed ? 0.55 : 1;
  const ringOpacity = dimmed ? 0.4 : 0.85;

  return (
    <group ref={groupRef} position={initPos}>
      {/* FOUP body */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.3, 0.22, 0.26]} />
        <meshStandardMaterial color={config.color} roughness={0.25} metalness={0.2}
          emissive={config.color} emissiveIntensity={dimmed ? 0.25 : 0.5} transparent opacity={bodyOpacity} />
      </mesh>
      {/* Pulsing ring (shows when processing) */}
      <mesh ref={ringRef} position={[0, 0, 0]}>
        <torusGeometry args={[0.28, 0.02, 6, 20]} />
        <meshStandardMaterial color={config.color} emissive={config.color} emissiveIntensity={dimmed ? 0.6 : 1.2}
          transparent opacity={ringOpacity} />
      </mesh>
      {/* Label — 번호만 표시해서 12개가 돼도 뷰가 깔끔하게 유지됨 */}
      <Text position={[0, 0.22, 0]} fontSize={0.09} color={config.color}
        anchorX="center" anchorY="bottom" fillOpacity={dimmed ? 0.55 : 1}>
        {config.id.replace("W", "")}
      </Text>
    </group>
  );
}

// ─────────────────────────────────────────────
// 실제 lotStepEvents 원장을 폴링해서 움직이는 진짜 FOUP.
// 자체 타이머가 없다 — liveFoup prop이 바뀔 때만(=서버에 새 확인 이벤트가 기록됐을 때만) 다음 베이로 이동한다.
// ─────────────────────────────────────────────
function LiveTrackedFoup({ liveFoup }: { liveFoup: LiveFoupView }) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const target = useMemo(() => {
    if (liveFoup.processCode === "P10" || liveFoup.processCode === "P11") {
      return new THREE.Vector3(9.35, 0.32, BACKEND_LINE.packagingZ);
    }
    const access = PROCESS_ACCESS[liveFoup.processCode] ?? PROCESS_ACCESS.P01;
    return new THREE.Vector3(access.x, RAIL_Y, access.z);
  }, [liveFoup.processCode]);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (g) g.position.lerp(target, Math.min(1, dt * 2.2));
    if (ringRef.current) {
      // 확인 대기 중(=원장이 정지된 상태)임을 보여주려고 일부러 펄싱을 끔 — 장식용 FOUP과의 핵심 차이
      const scale = liveFoup.isDone ? 1 : 1 + 0.08 * Math.sin(Date.now() * 0.0025);
      ringRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group ref={groupRef} position={target.clone()}>
      <mesh castShadow>
        <boxGeometry args={[0.34, 0.26, 0.3]} />
        <meshStandardMaterial color="#ffffff" roughness={0.15} metalness={0.35}
          emissive="#38bdf8" emissiveIntensity={0.7} />
      </mesh>
      {/* 이중 테두리 링 — 장식용 FOUP은 링이 하나뿐 */}
      <mesh ref={ringRef}>
        <torusGeometry args={[0.32, 0.024, 6, 24]} />
        <meshStandardMaterial color="#ffffff" emissive="#38bdf8" emissiveIntensity={1.5} transparent opacity={0.95} />
      </mesh>
      <mesh>
        <torusGeometry args={[0.42, 0.016, 6, 24]} />
        <meshStandardMaterial color="#ffffff" emissive="#38bdf8" emissiveIntensity={1.1} transparent opacity={0.7} />
      </mesh>
      <Text position={[0, 0.32, 0]} fontSize={0.1} color="#38bdf8" anchorX="center" anchorY="bottom">
        {`LIVE · ${liveFoup.foupLabel}`}
      </Text>
    </group>
  );
}

// Campus 전체뷰에서 공정별 사용량 탭의 장비·AMHS·FOUP을 같은 형상으로 재사용하는 축소 FAB.
// Canvas를 포함하지 않아 상위 Campus Canvas 안에 M20·M21·M22를 동시 배치할 수 있다.
export function CampusFabProcessModel({
  fabId = "M20",
  highlightedProcesses = [],
  onProcessClick,
  showFoup = true,
  equipmentCounts,
}: {
  fabId?: FabId;
  highlightedProcesses?: string[];
  onProcessClick?: (code: string) => void;
  showFoup?: boolean;
  equipmentCounts?: Record<string, number>;
}) {
  const waferStates = useMemo(() => CAMPUS_FOUP_CONFIGS.map((config): React.MutableRefObject<WaferState> => ({
    current: {
      id: config.id,
      color: config.color,
      stepIdx: config.startStep,
      phase: "processing",
      timer: PROCESS_SECS * (config.startStep % 3 + 0.5),
      t: 0,
      tSpeed: 0,
      curve: null,
      currentBay: WAFER_RECIPE[config.startStep] ?? "P01",
    },
  })), []);
  const hasHighlight = highlightedProcesses.length > 0;

  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, FAB_CENTER_Z]}>
        <planeGeometry args={[FAB_W + 2, FAB_D + 2]} />
        <meshStandardMaterial color="#E7EBF0" roughness={0.25} metalness={0.12} />
      </mesh>
      <CleanroomFloorGrid />
      <OverheadInfra />
      <AgvLogisticsInfra />
      {fabId === "M20" && <BackendIntegratedLine />}
      {PROCESSES.map((proc) => (
        <ProcessBay
          key={proc.code}
          proc={proc}
          isHL={highlightedProcesses.includes(proc.code)}
          isDimmed={hasHighlight && !highlightedProcesses.includes(proc.code)}
          actualMachineCount={equipmentCounts?.[proc.code] ?? (FAB_MACHINE_PROFILES[fabId][proc.code] ?? 2) * 2}
          onClick={() => onProcessClick?.(proc.code)}
        />
      ))}
      {fabId !== "M20" && <FabSignatureEquipment fabId={fabId} />}
      {showFoup && CAMPUS_FOUP_CONFIGS.map((config, index) => (
        <AnimatedFoup key={config.id} config={config} stateRef={waferStates[index]} />
      ))}
    </group>
  );
}

const FAB_MACHINE_PROFILES: Record<FabId, Record<string, number>> = {
  M20: { P01: 2, P02: 3, P03: 5, P04: 4, P05: 2, P06: 3, P07: 3, P08: 5, P09: 3, P10: 4 },
  M21: { P01: 3, P02: 4, P03: 4, P04: 5, P05: 3, P06: 5, P07: 4, P08: 2, P09: 4, P10: 2 },
  M22: { P01: 3, P02: 6, P03: 3, P04: 6, P05: 2, P06: 5, P07: 3, P08: 2, P09: 3, P10: 2 },
};

function FabSignatureEquipment({ fabId }: { fabId: FabId }) {
  if (fabId === "M20") {
    // M20은 원장 494대만 전수 배치한다. 장식 설비를 더하면 화면 대수가 원장을 초과한다.
    return null;
  }
  if (fabId === "M21") {
    return (
      <group position={[5.4, 0, BAY_Z.P06]}>
        {[-1.0, -0.34, 0.34, 1.0].map((z) => <group key={z} position={[0, 0, z]}>
          <mesh position={[0, 1.1, 0]}><boxGeometry args={[1.15, 2.2, 0.5]} /><meshStandardMaterial color="#B8D4F1" metalness={0.28} roughness={0.32} /></mesh>
          <mesh position={[0, 1.55, 0.27]}><boxGeometry args={[0.76, 0.42, 0.06]} /><meshStandardMaterial color="#2563EB" emissive="#2563EB" emissiveIntensity={0.55} /></mesh>
        </group>)}
        <Text position={[0, 2.75, 0]} fontSize={0.22} color="#2563EB" anchorX="center">DRAM CELL · METAL ARRAY</Text>
      </group>
    );
  }
  return (
    <group position={[5.4, 0, BAY_Z.P04]}>
      {[-0.9, 0, 0.9].map((z, index) => <group key={z} position={[0, 0, z]}>
        <mesh position={[0, 1.5, 0]}><cylinderGeometry args={[0.46, 0.62, 3 + index * 0.28, 16]} /><meshStandardMaterial color="#C5D8CF" metalness={0.42} roughness={0.3} /></mesh>
        <mesh position={[0, 2.85 + index * 0.14, 0]}><cylinderGeometry args={[0.32, 0.46, 0.32, 16]} /><meshStandardMaterial color="#059669" emissive="#059669" emissiveIntensity={0.6} /></mesh>
      </group>)}
      <Text position={[0, 3.65, 0]} fontSize={0.22} color="#059669" anchorX="center">3D NAND HAR ETCH · STACK CVD</Text>
    </group>
  );
}

// ─────────────────────────────────────────────
// 자재창고 건물 (fab 서측 야드)
// ─────────────────────────────────────────────
export type WarehouseInfo = {
  code: string; name: string; type: string;
  categories: string[]; processCount: number; totalQty: number;
  utilization?: number;
  byCategory?: { category: string; pct: number }[];
};
export type WarehouseLink = {
  whCode: string; procCode: string; qty: number; category: string;
};

// 고층 AS/RS 자동화 랙 (개방형 철골 + 다단 선반 + 파렛트 + 스태커 크레인)
// utilization(0-100)과 byCategory로 실제 채움 상태 반영
function ASRSStructure({ w, d, h, color, opacity, dim, utilization = 0, byCategory = [] }: {
  w: number; d: number; h: number; color: string; opacity: number; dim: boolean;
  utilization?: number; byCategory?: { category: string; pct: number }[];
}) {
  const levels = 6;
  const bays = 4;
  const totalSlots = levels * bays * 2; // 양쪽 랙
  const filledSlots = Math.round(totalSlots * Math.min(utilization / 100, 1));
  const steel = dim ? "#9aa4ad" : "#6b7783";
  const postXs = [-w / 2, -0.15, 0.15, w / 2];

  // 슬롯별 색상: byCategory 비율대로 색 배분
  const slotColors: string[] = [];
  let remaining = filledSlots;
  for (const { category, pct } of byCategory) {
    const n = Math.round(filledSlots * pct);
    const c = CATEGORY_COLOR[category] ?? color;
    for (let i = 0; i < n && remaining > 0; i++, remaining--) slotColors.push(c);
  }
  while (slotColors.length < filledSlots) slotColors.push(color);

  let slotIdx = 0;
  return (
    <group>
      {postXs.map((px) =>
        [-d / 2, d / 2].map((pz) => (
          <mesh key={`p${px}-${pz}`} position={[px, h / 2, pz]} castShadow>
            <boxGeometry args={[0.09, h, 0.09]} />
            <meshStandardMaterial color={steel} metalness={0.6} roughness={0.35} transparent opacity={opacity} />
          </mesh>
        ))
      )}
      {Array.from({ length: levels }).map((_, lv) => {
        const y = 0.5 + lv * ((h - 0.6) / levels);
        return (
          <group key={`lv${lv}`}>
            {[-w / 2 + 0.55, w / 2 - 0.55].map((rx) => (
              <mesh key={`beam${rx}`} position={[rx, y, 0]}>
                <boxGeometry args={[0.85, 0.05, d - 0.1]} />
                <meshStandardMaterial color={steel} metalness={0.55} roughness={0.4} transparent opacity={opacity} />
              </mesh>
            ))}
            {[-w / 2 + 0.55, w / 2 - 0.55].map((rx) =>
              Array.from({ length: bays }).map((__, bi) => {
                const pz = -d / 2 + 0.7 + bi * ((d - 1.2) / (bays - 1));
                const thisIdx = slotIdx++;
                const slotColor = slotColors[thisIdx];
                if (!slotColor) return null;
                return (
                  <mesh key={`box${rx}-${bi}`} position={[rx, y + 0.22, pz]} castShadow>
                    <boxGeometry args={[0.6, 0.34, 0.62]} />
                    <meshStandardMaterial color={slotColor} roughness={0.6}
                      emissive={slotColor} emissiveIntensity={dim ? 0.05 : 0.25} transparent opacity={opacity} />
                  </mesh>
                );
              })
            )}
          </group>
        );
      })}
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[0.16, h, 0.16]} />
        <meshStandardMaterial color={dim ? "#c0c8d0" : "#e2b23a"} metalness={0.5} roughness={0.3}
          emissive={dim ? "#000" : "#e2b23a"} emissiveIntensity={dim ? 0 : 0.3} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, h * 0.45, 0]}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial color="#c9a227" metalness={0.4} roughness={0.4} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, h + 0.08, 0]}>
        <boxGeometry args={[w + 0.2, 0.12, d + 0.2]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim ? 0.1 : 0.5} transparent opacity={opacity} />
      </mesh>
      <mesh position={[-w / 2 - 0.05, h / 2, 0]}>
        <boxGeometry args={[0.04, h, d]} />
        <meshStandardMaterial color="#cdd6df" metalness={0.2} roughness={0.5} transparent opacity={opacity * 0.18} />
      </mesh>
      {/* 점유율 표시 바 (외벽 전면) */}
      {utilization > 0 && (
        <mesh position={[w / 2 + 0.06, (h * utilization / 100) / 2, 0]}>
          <boxGeometry args={[0.06, h * utilization / 100, d * 0.18]} />
          <meshStandardMaterial color={utilization > 80 ? "#EF4444" : utilization > 60 ? "#F7A600" : "#00B96B"}
            emissive={utilization > 80 ? "#EF4444" : "#00B96B"} emissiveIntensity={dim ? 0.05 : 0.4} transparent opacity={opacity} />
        </mesh>
      )}
      {/* 카테고리 스트라이프 — 건물 전면 하단, 항상 표시 (점유율과 무관) */}
      {byCategory.length > 0 && (() => {
        let xCursor = -w / 2;
        return byCategory.map(({ category, pct }) => {
          const bw = pct * w;
          const cx = xCursor + bw / 2;
          xCursor += bw;
          const c = CATEGORY_COLOR[category] ?? "#64748B";
          return (
            <mesh key={category} position={[cx, 0.14, d / 2 + 0.025]}>
              <boxGeometry args={[Math.max(bw - 0.03, 0.01), 0.2, 0.04]} />
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={dim ? 0.1 : 0.55} transparent opacity={opacity * 0.92} />
            </mesh>
          );
        });
      })()}
    </group>
  );
}

// 방폭 위험물 별동 (저층 + 방류벽 + 벤트 스택 + 실제 점유율 fill)
function HazmatStructure({ w, d, h, color, opacity, dim, utilization = 0, byCategory = [] }: {
  w: number; d: number; h: number; color: string; opacity: number; dim: boolean;
  utilization?: number; byCategory?: { category: string; pct: number }[];
}) {
  const fillH = Math.max(0.01, h * 0.75 * Math.min(utilization / 100, 1));
  // 카테고리별 X 분할 (위험물창고 내부 구획)
  const zones = byCategory.filter((b) => b.pct > 0);
  const zoneW = zones.length > 0 ? (w - 0.3) / zones.length : w - 0.3;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={dim ? "#d8dce0" : "#cbd3da"} roughness={0.7} metalness={0.05} transparent opacity={opacity} />
      </mesh>
      {/* 카테고리별 내부 채움 볼륨 */}
      {zones.map(({ category }, i) => {
        const cx = -w / 2 + 0.15 + i * zoneW + zoneW / 2;
        const zoneColor = CATEGORY_COLOR[category] ?? color;
        return (
          <mesh key={category} position={[cx, fillH / 2, 0]}>
            <boxGeometry args={[zoneW - 0.08, fillH, d - 0.2]} />
            <meshStandardMaterial color={zoneColor} roughness={0.5}
              emissive={zoneColor} emissiveIntensity={dim ? 0.05 : 0.3}
              transparent opacity={opacity * (dim ? 0.35 : 0.7)} />
          </mesh>
        );
      })}
      <mesh position={[0, h * 0.5, d / 2 + 0.01]}>
        <boxGeometry args={[w, 0.28, 0.02]} />
        <meshStandardMaterial color="#f2c200" emissive="#f2c200" emissiveIntensity={dim ? 0.1 : 0.5} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, h + 0.06, 0]}>
        <boxGeometry args={[w + 0.14, 0.12, d + 0.14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim ? 0.1 : 0.5} transparent opacity={opacity} />
      </mesh>
      {[[0, d / 2 + 0.35], [0, -d / 2 - 0.35]].map(([bx, bz], i) => (
        <mesh key={i} position={[bx, 0.18, bz]}>
          <boxGeometry args={[w + 0.9, 0.36, 0.1]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.8} transparent opacity={opacity} />
        </mesh>
      ))}
      {[-w / 2 + 0.4, w / 2 - 0.4].map((vx) => (
        <mesh key={vx} position={[vx, h + 0.55, -d / 2 + 0.4]}>
          <cylinderGeometry args={[0.08, 0.08, 1.0, 10]} />
          <meshStandardMaterial color="#8894a0" metalness={0.6} roughness={0.3} transparent opacity={opacity} />
        </mesh>
      ))}
      {/* 카테고리 스트라이프 — 전면 하단 */}
      {zones.length > 0 && (() => {
        let xCursor = -w / 2;
        return zones.map(({ category, pct }) => {
          const bw = pct * w;
          const cx = xCursor + bw / 2;
          xCursor += bw;
          const c = CATEGORY_COLOR[category] ?? "#64748B";
          return (
            <mesh key={category} position={[cx, 0.14, d / 2 + 0.025]}>
              <boxGeometry args={[Math.max(bw - 0.03, 0.01), 0.2, 0.04]} />
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={dim ? 0.1 : 0.55} transparent opacity={opacity * 0.92} />
            </mesh>
          );
        });
      })()}
    </group>
  );
}

// 평치/MRO 중층 창고 (박스 본체 + 지붕 + 도크 셔터 + 실제 점유율 팔레트 스택)
function FlatStructure({ w, d, h, color, opacity, dim, utilization = 0, byCategory = [] }: {
  w: number; d: number; h: number; color: string; opacity: number; dim: boolean;
  utilization?: number; byCategory?: { category: string; pct: number }[];
}) {
  const fillH = Math.max(0.01, (h - 0.3) * Math.min(utilization / 100, 1));
  const zones = byCategory.filter((b) => b.pct > 0);
  const zoneW = zones.length > 0 ? (w - 0.3) / zones.length : w - 0.3;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={dim ? "#dfe4e8" : "#e2e8f0"} roughness={0.55} metalness={0.05} transparent opacity={opacity * 0.5} />
      </mesh>
      {/* 카테고리별 채움 볼륨 (바닥에서 쌓이는 방식) */}
      {zones.map(({ category }, i) => {
        const cx = -w / 2 + 0.15 + i * zoneW + zoneW / 2;
        const zoneColor = CATEGORY_COLOR[category] ?? color;
        return (
          <mesh key={category} position={[cx, 0.15 + fillH / 2, 0]}>
            <boxGeometry args={[zoneW - 0.1, fillH, d - 0.3]} />
            <meshStandardMaterial color={zoneColor} roughness={0.55}
              emissive={zoneColor} emissiveIntensity={dim ? 0.03 : 0.2}
              transparent opacity={opacity * (dim ? 0.3 : 0.75)} />
          </mesh>
        );
      })}
      <mesh position={[0, h + 0.07, 0]}>
        <boxGeometry args={[w + 0.14, 0.14, d + 0.14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim ? 0.1 : 0.5} transparent opacity={opacity} />
      </mesh>
      {[-d / 4, d / 4].map((dz) => (
        <mesh key={dz} position={[w / 2 + 0.01, h * 0.32, dz]}>
          <boxGeometry args={[0.03, h * 0.55, d * 0.3]} />
          <meshStandardMaterial color="#475569" roughness={0.6} transparent opacity={opacity} />
        </mesh>
      ))}
      {/* 카테고리 스트라이프 — 전면 하단 */}
      {zones.length > 0 && (() => {
        let xCursor = -w / 2;
        return zones.map(({ category, pct }) => {
          const bw = pct * w;
          const cx = xCursor + bw / 2;
          xCursor += bw;
          const c = CATEGORY_COLOR[category] ?? "#64748B";
          return (
            <mesh key={category} position={[cx, 0.14, d / 2 + 0.025]}>
              <boxGeometry args={[Math.max(bw - 0.03, 0.01), 0.2, 0.04]} />
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={dim ? 0.1 : 0.55} transparent opacity={opacity * 0.92} />
            </mesh>
          );
        });
      })()}
    </group>
  );
}

function WarehouseBuilding({ wh, isHL, isDimmed, onHover, onLeave, onFocus }: {
  wh: WarehouseInfo; isHL: boolean; isDimmed: boolean;
  onHover: () => void; onLeave: () => void; onFocus: () => void;
}) {
  const meta = WH_META[wh.code];
  if (!meta) return null;
  const { z, w, d, h } = meta;
  const color = CATEGORY_COLOR[wh.categories[0] ?? "GAS"] ?? "#64748B";
  const opacity = isDimmed ? 0.4 : 1;
  const dim = isDimmed;

  return (
    <group position={[WH_X, 0, z]}
      onClick={(e) => { e.stopPropagation(); onFocus(); }}
      onPointerEnter={(e) => { e.stopPropagation(); onHover(); document.body.style.cursor = "pointer"; }}
      onPointerLeave={() => { onLeave(); document.body.style.cursor = ""; }}>
      {/* 콘크리트 기초 패드 */}
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <boxGeometry args={[w + 0.6, 0.08, d + 0.6]} />
        <meshStandardMaterial color={dim ? "#c4ccd4" : "#b8c2cc"} roughness={0.9} transparent opacity={opacity} />
      </mesh>

      {meta.kind === "asrs"   && <ASRSStructure   w={w} d={d} h={h} color={color} opacity={opacity} dim={dim} utilization={wh.utilization} byCategory={wh.byCategory} />}
      {meta.kind === "hazmat" && <HazmatStructure w={w} d={d} h={h} color={color} opacity={opacity} dim={dim} utilization={wh.utilization} byCategory={wh.byCategory} />}
      {(meta.kind === "flat" || meta.kind === "mro") &&
        <FlatStructure w={w} d={d} h={h} color={color} opacity={opacity} dim={dim} utilization={wh.utilization} byCategory={wh.byCategory} />}

      {/* 라벨 (구조물 위) */}
      <Text position={[0, h + 0.42, 0]} fontSize={0.34}
        color={isHL ? color : "#475569"} anchorX="center" anchorY="bottom">
        {wh.code}
      </Text>
      <Text position={[0, h + 0.24, 0]} fontSize={0.16} color="#94a3b8" anchorX="center" anchorY="bottom">
        {wh.name || meta.short}
      </Text>
      {!isDimmed && (
        <Text position={[0, 0.55, d / 2 + 0.35]} fontSize={0.14} color="#64748b"
          anchorX="center" anchorY="middle">
          {`${wh.processCount}개 공정 · ${wh.utilization != null ? `점유 ${wh.utilization}%` : `${wh.totalQty.toLocaleString()}/월`}`}
        </Text>
      )}
    </group>
  );
}

// 가스야드: 벌크가스 ISO 탱크(수직 실린더) 줄지어 + 밸브 매니폴드
function GasYard({ dim }: { dim: boolean }) {
  const op = dim ? 0.4 : 1;
  const tanks = 6;
  return (
    <group position={[GAS_YARD.x, 0, GAS_YARD.z]}>
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[3.4, 0.06, 2.2]} />
        <meshStandardMaterial color="#b0bac4" roughness={0.9} transparent opacity={op} />
      </mesh>
      {Array.from({ length: tanks }).map((_, i) => {
        const x = -1.4 + i * (2.8 / (tanks - 1));
        return (
          <group key={i} position={[x, 0, 0]}>
            <mesh position={[0, 1.15, 0]} castShadow>
              <cylinderGeometry args={[0.22, 0.22, 2.1, 16]} />
              <meshStandardMaterial color="#dfe6ec" metalness={0.5} roughness={0.3} transparent opacity={op} />
            </mesh>
            <mesh position={[0, 2.25, 0]}>
              <sphereGeometry args={[0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#cdd6df" metalness={0.5} roughness={0.3} transparent opacity={op} />
            </mesh>
            <mesh position={[0, 0.35, 0]}>
              <boxGeometry args={[0.5, 0.12, 0.5]} />
              <meshStandardMaterial color="#B91C1C" emissive="#B91C1C" emissiveIntensity={dim ? 0.05 : 0.35} transparent opacity={op} />
            </mesh>
          </group>
        );
      })}
      <Text position={[0, 2.9, 0]} fontSize={0.24} color="#94a3b8" anchorX="center">가스야드 (ISO 탱크)</Text>
    </group>
  );
}

// ─────────────────────────────────────────────
// 배관 (창고 → 공정 베이) : 튜브 + 흐름 입자
// ─────────────────────────────────────────────
function makePipeCurve(whCode: string, bayX: number, bayZ: number): THREE.CatmullRomCurve3 {
  const meta = WH_META[whCode];
  const supply = SUPPLY_ORIGIN[whCode];
  const lane = meta?.lane ?? supply?.lane ?? 0;
  const y = 0.55 + lane * 0.32;       // 창고별 헤더 높이 분리
  const wz = meta?.z ?? supply?.z ?? 0;
  const originX = supply?.x ?? WH_X;
  const wOut = (meta?.w ?? 2) / 2 + 0.2; // 창고 팹-방향 출구 면
  const hx = WH_HEADER_X - lane * 0.18; // 헤더 X도 살짝 분리
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(originX + wOut, y, wz), // 창고/중앙공급시설 출구
    new THREE.Vector3(hx, y, wz),            // 벽면 헤더 진입
    new THREE.Vector3(hx, y, bayZ),          // 헤더 따라 Z 이동
    new THREE.Vector3(bayX, 0.42, bayZ),     // 공정 zone utility drop
  ]);
}

function SupplyPipe({ link, active }: { link: WarehouseLink; active: boolean }) {
  const bayZ = BAY_Z[link.procCode];
  const bayX = BAY_X[link.procCode];
  const curve = useMemo(() => makePipeCurve(link.whCode, bayX, bayZ), [link.whCode, bayX, bayZ]);
  const color = CATEGORY_COLOR[link.category] ?? "#64748B";
  const radius = 0.03 + Math.min(link.qty, 3000) / 3000 * 0.06; // 굵기 = 월 사용량
  const geom = useMemo(() => new THREE.TubeGeometry(curve, 40, radius, 8, false), [curve, radius]);

  // 흐름 입자
  const N = 3;
  const partRefs = useRef<(THREE.Mesh | null)[]>([]);
  const offsets = useMemo(() => Array.from({ length: N }, (_, i) => i / N), []);
  useFrame(() => {
    if (!active) return;
    const t = (Date.now() * 0.00018) % 1;
    for (let i = 0; i < N; i++) {
      const m = partRefs.current[i];
      if (!m) continue;
      const u = (offsets[i] + t) % 1;
      const p = curve.getPoint(u);
      m.position.copy(p);
    }
  });

  if (typeof bayZ !== "number") return null;

  return (
    <group>
      <mesh geometry={geom}>
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.4}
          emissive={color} emissiveIntensity={active ? 0.5 : 0.05}
          transparent opacity={active ? 0.92 : 0.1} />
      </mesh>
      {active && offsets.map((_, i) => (
        <mesh key={i} ref={(el) => { partRefs.current[i] = el; }}>
          <sphereGeometry args={[radius * 1.7, 8, 8]} />
          <meshStandardMaterial color="#ffffff" emissive={color} emissiveIntensity={2.2} />
        </mesh>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────
// CUB (중앙 유틸리티동): 가스·케미컬 공급설비 + 냉각탑
// ─────────────────────────────────────────────
function CUB() {
  const x = FAB_W / 2 + 4.5, W = 3.2, D = 7.0, H = 5.0;
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[W + 0.8, 0.1, D + 0.8]} />
        <meshStandardMaterial color="#b8c2cc" roughness={0.9} />
      </mesh>
      <mesh position={[0, H / 2, 0]} castShadow>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial color="#dbe2e8" roughness={0.5} metalness={0.06} />
      </mesh>
      <mesh position={[0, H + 0.08, 0]}>
        <boxGeometry args={[W + 0.16, 0.16, D + 0.16]} />
        <meshStandardMaterial color="#059669" emissive="#059669" emissiveIntensity={0.4} />
      </mesh>
      {/* 냉각탑 (지붕 위 실린더 팬) */}
      {[-D / 4, D / 4].map((cz) => (
        <group key={cz} position={[0, H + 0.55, cz]}>
          <mesh><cylinderGeometry args={[0.7, 0.8, 1.0, 20]} /><meshStandardMaterial color="#c4ccd4" metalness={0.3} roughness={0.5} /></mesh>
          <mesh position={[0, 0.55, 0]}><cylinderGeometry args={[0.55, 0.55, 0.1, 20]} /><meshStandardMaterial color="#6b7783" metalness={0.5} roughness={0.4} /></mesh>
        </group>
      ))}
      {/* 배관 트레이 (팹 방향) */}
      <mesh position={[-W / 2 - 0.5, H * 0.6, 0]}>
        <boxGeometry args={[1.0, 0.14, D * 0.8]} />
        <meshStandardMaterial color="#9aa6b2" metalness={0.5} roughness={0.4} />
      </mesh>
      <Text position={[0, H + 1.4, 0]} fontSize={0.4} color="#059669" anchorX="center">CUB</Text>
      <Text position={[0, H + 1.18, 0]} fontSize={0.18} color="#94a3b8" anchorX="center">중앙 유틸리티동</Text>
    </group>
  );
}

// 부대설비: 스크러버 야드(배기정화) + 케미컬 공급동(VMB)
function AuxFacilities() {
  return (
    <group>
      {/* 스크러버 야드 — 배기가스 정화 컬럼 */}
      <group position={[FAB_W / 2 + 8, 0, 2]}>
        <mesh position={[0, 0.04, 0]} receiveShadow>
          <boxGeometry args={[2.2, 0.08, 5.0]} />
          <meshStandardMaterial color="#b0bac4" roughness={0.9} />
        </mesh>
        {Array.from({ length: 5 }).map((_, i) => {
          const z = -1.9 + i * 0.95;
          return (
            <group key={i} position={[0, 0, z]}>
              <mesh position={[0, 1.9, 0]} castShadow>
                <cylinderGeometry args={[0.32, 0.35, 3.6, 16]} />
                <meshStandardMaterial color="#cfd6dd" metalness={0.4} roughness={0.4} />
              </mesh>
              {/* 유틸리티 색 밴드 */}
              <mesh position={[0, 2.6, 0]}>
                <cylinderGeometry args={[0.34, 0.34, 0.3, 16]} />
                <meshStandardMaterial color="#059669" emissive="#059669" emissiveIntensity={0.35} />
              </mesh>
              {/* 배기 캡 */}
              <mesh position={[0, 3.85, 0]}>
                <cylinderGeometry args={[0.18, 0.32, 0.4, 12]} />
                <meshStandardMaterial color="#8894a0" metalness={0.6} roughness={0.3} />
              </mesh>
            </group>
          );
        })}
        <Text position={[0, 4.4, 0]} fontSize={0.26} color="#059669" anchorX="center">스크러버 (배기정화)</Text>
      </group>

      {/* 케미컬 공급동 (VMB) + 드럼 야드 */}
      <group position={[FAB_W / 2 + 4.5, 0, -10]}>
        <mesh position={[0, 0.04, 0]} receiveShadow>
          <boxGeometry args={[3.4, 0.08, 3.0]} />
          <meshStandardMaterial color="#b8c2cc" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.1, -0.4]} castShadow>
          <boxGeometry args={[2.4, 2.2, 1.8]} />
          <meshStandardMaterial color="#dbe2e8" roughness={0.5} metalness={0.06} />
        </mesh>
        <mesh position={[0, 2.28, -0.4]}>
          <boxGeometry args={[2.55, 0.14, 1.95]} />
          <meshStandardMaterial color="#1D4ED8" emissive="#1D4ED8" emissiveIntensity={0.4} />
        </mesh>
        {/* 케미컬 드럼 (전면) */}
        {[-0.9, -0.3, 0.3, 0.9].map((dx) => (
          <mesh key={dx} position={[dx, 0.42, 0.9]} castShadow>
            <cylinderGeometry args={[0.22, 0.22, 0.76, 14]} />
            <meshStandardMaterial color="#1D4ED8" roughness={0.5} emissive="#1D4ED8" emissiveIntensity={0.15} />
          </mesh>
        ))}
        <Text position={[0, 2.9, -0.4]} fontSize={0.24} color="#1D4ED8" anchorX="center">케미컬 공급 (VMB)</Text>
      </group>
    </group>
  );
}

// ─────────────────────────────────────────────
// 카메라 포커스: 클릭한 대상으로 부드럽게 이동
// ─────────────────────────────────────────────
export type FocusView = { cam: [number, number, number]; look: [number, number, number] };
export const OVERVIEW_FOCUS: FocusView = {
  cam: [-4, FAB_D * 0.72, FAB_CENTER_Z + FAB_D * 1.08],
  look: [0, 0.5, FAB_CENTER_Z],
};

export function focusForWarehouse(code: string): FocusView {
  const m = WH_META[code];
  if (!m) return OVERVIEW_FOCUS;
  return {
    cam: [WH_X - 3.5, m.h * 0.6 + 2.2, m.z + 4.5], // 더 가까이 확대
    look: [WH_X + 0.5, m.h / 2, m.z],
  };
}
export function focusForBay(code: string): FocusView {
  const bx = BAY_X[code] ?? 0;
  const bz = BAY_Z[code] ?? 0;
  return {
    cam: [bx, 9.5, bz + 10.5],
    look: [bx, 1.1, bz],
  };
}

function FocusController({ controls, focus }: {
  controls: React.RefObject<CameraControls | null>; focus: FocusView;
}) {
  useEffect(() => {
    const c = controls.current;
    if (!c || !focus) return;
    c.setLookAt(
      focus.cam[0], focus.cam[1], focus.cam[2],
      focus.look[0], focus.look[1], focus.look[2],
      true,
    );
  }, [focus, controls]);
  return null;
}

// ─────────────────────────────────────────────
// 클린룸 raised access floor — 600 mm 타일 격자선
// ─────────────────────────────────────────────
function CleanroomFloorGrid() {
  const geom = useMemo(() => {
    const W = FAB_W + 2, D = FAB_D + 2, step = 0.6;
    const pts: number[] = [];
    for (let z = -D / 2; z <= D / 2 + 0.001; z += step)
      pts.push(-W / 2, 0, z, W / 2, 0, z);
    for (let x = -W / 2; x <= W / 2 + 0.001; x += step)
      pts.push(x, 0, -D / 2, x, 0, D / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geom} position={[0, 0.007, FAB_CENTER_Z]}>
      <lineBasicMaterial color="#9baab8" transparent opacity={0.38} />
    </lineSegments>
  );
}

// ─────────────────────────────────────────────
// Main 3D Scene
// ─────────────────────────────────────────────
function Scene({
  fabId,
  highlightedProcesses, onProcessClick,
  waferStates, warehouses, warehouseLinks,
  hoveredWh, setHoveredWh, onFocusWh, onFocusBay, focus,
  showFoup, showPipes,
  equipmentCounts,
  liveFoups,
  foupFleet,
}: {
  fabId?: FabId;
  highlightedProcesses: string[];
  onProcessClick?: (code: string) => void;
  waferStates: React.MutableRefObject<WaferState>[];
  warehouses: WarehouseInfo[];
  warehouseLinks: WarehouseLink[];
  hoveredWh: string | null;
  setHoveredWh: (c: string | null) => void;
  onFocusWh: (code: string) => void;
  onFocusBay: (code: string) => void;
  focus: FocusView;
  showFoup: boolean;
  liveFoups?: LiveFoupView[];
  foupFleet?: FoupFleetProjection | null;
  showPipes: boolean;
  equipmentCounts?: Record<string, number>;
}) {
  const camRef = useRef<CameraControls>(null);

  const hasProcHL = highlightedProcesses.length > 0;
  // 창고 hover 시 해당 창고가 공급하는 공정들
  const whHlProcs = hoveredWh
    ? warehouseLinks.filter((l) => l.whCode === hoveredWh).map((l) => l.procCode)
    : [];
  const effectiveHL = hoveredWh ? whHlProcs : highlightedProcesses;
  const anyHL = effectiveHL.length > 0;

  const isHL     = (c: string) => effectiveHL.includes(c);
  const isDimmed = (c: string) => anyHL && !isHL(c);

  // 파이프 활성 판정: 강조 없으면 전부 / 있으면 해당 공정·창고만
  const pipeActive = (l: WarehouseLink) => {
    if (hoveredWh) return l.whCode === hoveredWh;
    if (hasProcHL) return highlightedProcesses.includes(l.procCode);
    return true;
  };
  const whIsHL = (code: string) =>
    hoveredWh === code ||
    (hasProcHL && warehouseLinks.some((l) => l.whCode === code && highlightedProcesses.includes(l.procCode)));
  const whIsDimmed = (code: string) =>
    (!!hoveredWh && hoveredWh !== code) ||
    (!hoveredWh && hasProcHL && !warehouseLinks.some((l) => l.whCode === code && highlightedProcesses.includes(l.procCode)));

  const floorW = FAB_W, floorD = FAB_D;

  // liveFoups에 들어있는 FOUP은 decorative waferStates 대신 실데이터로 그린다.
  const liveFoupLabels = new Set((liveFoups ?? []).map((f) => f.foupLabel));

  return (
    <>
      <ambientLight intensity={0.45} color="#eef2f8" />
      <directionalLight position={[8, 16, 10]} intensity={1.3} color="#fff6e8" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002}
        shadow-camera-left={-floorW} shadow-camera-right={floorW}
        shadow-camera-top={24} shadow-camera-bottom={-24} />
      <directionalLight position={[-6, 10, -8]} intensity={0.4} color="#dce6ff" />

      <Environment resolution={256}>
        <Lightformer intensity={2.2} form="rect" position={[0, 10, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[floorW, 24, 1]} color="#ffffff" />
        <Lightformer intensity={1.1} form="rect" position={[floorW / 2, 6, 6]} rotation={[0, -Math.PI / 3, 0]} scale={[8, 10, 1]} color="#eaf0ff" />
        <Lightformer intensity={0.9} form="rect" position={[-floorW / 2, 6, -4]} rotation={[0, Math.PI / 3, 0]} scale={[8, 10, 1]} color="#fff3e6" />
      </Environment>

      <ContactShadows position={[0, 0.02, FAB_CENTER_Z]} scale={Math.max(floorW, floorD) + 16} blur={2.2} opacity={0.3} far={12} resolution={1024} color="#3a4250" />

      {/* 클린룸 에폭시 바닥 — 광택 코팅 (실제 FAB) */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, FAB_CENTER_Z]}>
        <planeGeometry args={[floorW + 2, floorD + 2]} />
        <meshStandardMaterial color="#eaecf0" roughness={0.22} metalness={0.18} />
      </mesh>
      {/* 600 mm 타일 격자선 (raised access floor) */}
      <CleanroomFloorGrid />
      {/* 클린룸 슬래브 두께 */}
      <mesh position={[0, -0.16, FAB_CENTER_Z]}>
        <boxGeometry args={[floorW + 2, 0.32, floorD + 2]} />
        <meshStandardMaterial color="#cfd6dd" roughness={0.7} metalness={0.05} />
      </mesh>

      {/* CUB + 가스야드 + 부대설비 */}
      <CUB />
      <AuxFacilities />
      <GasYard dim={!!hoveredWh} />

      {/* 중앙 OHT spine 아래의 점검 통로 */}
      <mesh position={[0, 0.002, FAB_CENTER_Z]}>
        <boxGeometry args={[1.2, 0.003, floorD]} />
        <meshStandardMaterial color="#c8d4e0" transparent opacity={0.3} />
      </mesh>

      <OverheadInfra />
      <AgvLogisticsInfra />
      {fabId === "M20" && <BackendIntegratedLine />}

      {/* Section labels */}
      <Text position={[0, 3.8, -22.8]} fontSize={0.28} color="#6b7280" anchorX="center">전공정 진입 (FEOL IN)</Text>
      <Text position={[0, 3.8,  18.8]} fontSize={0.28} color="#6b7280" anchorX="center">후공정 인계 (BACK-END HANDOFF)</Text>
      {fabId && <Text position={[0, 4.55, 0]} fontSize={0.42} color={fabId === "M20" ? "#EA002C" : fabId === "M21" ? "#2563EB" : "#059669"} anchorX="center">
        {fabId === "M20" ? "M20 · HBM / TSV STACK" : fabId === "M21" ? "M21 · DRAM CELL ARRAY" : "M22 · 3D NAND VERTICAL STACK"}
      </Text>}
      <Text position={[0, 0.02, 0]} fontSize={0.2} color="#94a3b8" anchorX="center" rotation={[-Math.PI / 2, 0, 0]}>
        AMHS 인터베이 코리더
      </Text>

      {/* Process bays */}
      {PROCESSES.map((proc) => (
        <ProcessBay key={proc.code} proc={proc}
          isHL={isHL(proc.code)} isDimmed={isDimmed(proc.code)}
          actualMachineCount={equipmentCounts?.[proc.code] ?? (fabId ? (FAB_MACHINE_PROFILES[fabId][proc.code] ?? 2) * 2 : undefined)}
          onClick={() => { onProcessClick?.(proc.code); onFocusBay(proc.code); }} />
      ))}
      {fabId && fabId !== "M20" && <FabSignatureEquipment fabId={fabId} />}

      {/* 3D에는 이동 의미가 있는 Watched FOUP만 표시한다. 전체 Fleet는 원장 수량으로 조회한다. */}
      {showFoup && (liveFoups ?? []).map((lf) => <LiveTrackedFoup key={lf.lotId} liveFoup={lf} />)}
      {showFoup && foupFleet?.manifestStatus !== "ACTIVE" && WAFER_CONFIGS.map((cfg, i) => {
        if (liveFoupLabels.has(cfg.label)) return null;
        return <AnimatedFoup key={cfg.id} config={cfg} stateRef={waferStates[i]} dimmed={liveFoupLabels.size > 0} />;
      })}

      {/* 자재 야드 라벨 */}
      {warehouses.length > 0 && (
        <Text position={[WH_X, 3.7, 0]} fontSize={0.3} color="#6b7280" anchorX="center"
          rotation={[0, Math.PI / 2, 0]}>
          자재 창고 (Material Yard)
        </Text>
      )}

      {/* 배관: 창고 → 공정 */}
      {showPipes && warehouseLinks.map((l) => (
        <SupplyPipe key={`${l.whCode}-${l.procCode}`} link={l} active={pipeActive(l)} />
      ))}

      {/* 자재창고 건물 */}
      {warehouses.map((wh) => (
        <WarehouseBuilding key={wh.code} wh={wh}
          isHL={whIsHL(wh.code)} isDimmed={whIsDimmed(wh.code)}
          onHover={() => setHoveredWh(wh.code)} onLeave={() => setHoveredWh(null)}
          onFocus={() => onFocusWh(wh.code)} />
      ))}

      <PanCameraControls ref={camRef} minDistance={2.2} maxDistance={75}
        dollySpeed={1.7} truckSpeed={1.6} maxPolarAngle={Math.PI / 2.05} />
      <FocusController controls={camRef} focus={focus} />
    </>
  );
}

// ─────────────────────────────────────────────
// Exported component
// ─────────────────────────────────────────────
export default function ProcessFlow3D({
  fabId,
  highlightedProcesses = [],
  onProcessClick,
  onWarehouseClick,
  warehouses = [],
  warehouseLinks = [],
  equipmentCounts,
  liveFoups,
  foupFleet,
}: {
  fabId?: FabId;
  highlightedProcesses?: string[];
  activeProcesses?: string[];
  onProcessClick?: (code: string) => void;
  onWarehouseClick?: (code: string) => void;
  materialCounts?: Record<string, number>;
  warehouses?: WarehouseInfo[];
  warehouseLinks?: WarehouseLink[];
  equipmentCounts?: Record<string, number>;
  liveFoups?: LiveFoupView[];
  foupFleet?: FoupFleetProjection | null;
}) {
  const [hoveredWh, setHoveredWh] = useState<string | null>(null);
  const [showFoup, setShowFoup] = useState(true);
  const [showPipes, setShowPipes] = useState(true);
  const renderedEquipmentTotal = useMemo(
    () => Object.values(equipmentCounts ?? {}).reduce((sum, count) => sum + count, 0),
    [equipmentCounts],
  );
  // 카메라 포커스 상태 (클릭 → 줌인)
  const [focus, setFocus] = useState<FocusView>(OVERVIEW_FOCUS);
  const [focusLabel, setFocusLabel] = useState<string | null>(null);
  const focusWh = (code: string) => {
    if (onWarehouseClick) {
      onWarehouseClick(code);
    } else {
      setFocus(focusForWarehouse(code));
      setFocusLabel(`${code} 창고`);
    }
  };
  const focusBay = (code: string) => {
    setFocus(focusForBay(code));
    setFocusLabel(`${code} ${PROCESSES.find((p) => p.code === code)?.name ?? ""} 공정`);
  };
  const resetView = () => { setFocus({ ...OVERVIEW_FOCUS }); setFocusLabel(null); };
  // Wafer simulation state — refs so useFrame can mutate without re-renders
  const waferStates = useMemo(() =>
    WAFER_CONFIGS.map((cfg): React.MutableRefObject<WaferState> => ({
      current: {
        id: cfg.id,
        color: cfg.color,
        stepIdx: cfg.startStep,
        phase: "processing",
        timer: PROCESS_SECS * (cfg.startStep % 3 + 0.5),
        t: 0,
        tSpeed: 0,
        curve: null,
        currentBay: WAFER_RECIPE[cfg.startStep] ?? "P01",
      },
    })),
  []);

  // React state for the legend panel (updates every ~1s)
  type LegendEntry = {
    id: string; label: string; color: string; bay: string;
    bayName?: string; stepIdx: number; phase: "processing" | "traveling"; isLive?: boolean;
  };
  const [legendData, setLegendData] = useState<LegendEntry[]>(() =>
    WAFER_CONFIGS.map((cfg) => ({
      id: cfg.id,
      label: cfg.label,
      color: cfg.color,
      bay: WAFER_RECIPE[cfg.startStep] ?? "P01",
      stepIdx: cfg.startStep,
      phase: "processing" as const,
    }))
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const liveByLabel = new Map((liveFoups ?? []).map((lf) => [lf.foupLabel, lf]));
      setLegendData(
        WAFER_CONFIGS.map((cfg, i) => {
          const live = liveByLabel.get(cfg.label);
          if (live) {
            return {
              id: cfg.id, label: live.foupLabel, color: "#38bdf8",
              bay: live.processCode, bayName: live.nodeLabel,
              stepIdx: live.stepIndex, phase: "processing" as const, isLive: true,
            };
          }
          const s = waferStates[i].current;
          const proc = PROCESSES.find((p) => p.code === s.currentBay);
          return {
            id: cfg.id,
            label: cfg.label,
            color: cfg.color,
            bay: s.currentBay,
            bayName: proc?.name ?? "",
            stepIdx: s.stepIdx,
            phase: s.phase,
          };
        })
      );
    }, 800);
    return () => clearInterval(interval);
  }, [waferStates, liveFoups]);

  return (
    <div className="relative w-full h-full">
      <Canvas camera={{ position: [-3, 21, 30], fov: 54 }} shadows dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
        style={{ background: "linear-gradient(180deg,#eaeff5 0%,#f4f7fa 55%,#ffffff 100%)", borderRadius: 16 }}>
        <Suspense fallback={null}>
          <Scene
            fabId={fabId}
            highlightedProcesses={highlightedProcesses}
            onProcessClick={onProcessClick}
            waferStates={waferStates}
            warehouses={warehouses}
            warehouseLinks={warehouseLinks}
            hoveredWh={hoveredWh}
            setHoveredWh={setHoveredWh}
            onFocusWh={focusWh}
            onFocusBay={focusBay}
            focus={focus}
            showFoup={showFoup}
            showPipes={showPipes}
            equipmentCounts={equipmentCounts}
            liveFoups={liveFoups}
            foupFleet={foupFleet}
          />
        </Suspense>
      </Canvas>

      {fabId === "M20" && (
        <div data-testid="m20-equipment-3d-total"
          className="pointer-events-none absolute right-3 top-3 rounded-lg border border-white/50 bg-black/65 px-3 py-2 text-right text-white backdrop-blur-sm">
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-white/65">Modeled equipment · full render</div>
          <div className="mt-0.5 font-mono text-sm font-black">3D {renderedEquipmentTotal.toLocaleString()} / 원장 {renderedEquipmentTotal.toLocaleString()}대</div>
          <div className="mt-0.5 text-[9px] font-bold text-emerald-300">대표배치 없음 · 전수 인스턴스</div>
        </div>
      )}

      {fabId === "M20" && foupFleet && (
        <div data-testid="m20-foup-fleet-3d-total"
          className="pointer-events-none absolute right-3 top-[78px] min-w-[220px] rounded-lg border border-white/50 bg-black/65 px-3 py-2 text-right text-white backdrop-blur-sm">
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-sky-300">FOUP ledger · watched live view</div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
            <span className="text-white/55">Occupied</span><span className="font-mono font-black">{foupFleet.actual.occupied.toLocaleString()} / {foupFleet.target.occupied.toLocaleString()}</span>
            <span className="text-white/55">Physical Fleet</span><span className="font-mono font-black">{foupFleet.actual.physicalFleet.toLocaleString()} / {foupFleet.target.physicalFleet.toLocaleString()}</span>
            <span className="text-white/55">Reserve</span><span className="font-mono font-black">{foupFleet.actual.reserve.toLocaleString()}</span>
            <span className="text-white/55">Watched</span><span className="font-mono font-black text-sky-300">{foupFleet.actual.watched.toLocaleString()}</span>
          </div>
          <div className="mt-1 text-[8px] font-bold text-amber-300">3D: WATCHED 12 · 전체 수량은 실행 원장 기준</div>
        </div>
      )}

      {/* 카메라 포커스 + 애니메이션 컨트롤 */}
      <div className="absolute top-3 left-3 flex flex-col gap-2 pointer-events-auto">
        <div className="flex items-center gap-2">
          <button onClick={resetView}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white/90 hover:bg-black/75 transition-colors">
            ⤢ 전체 뷰
          </button>
          {focusLabel && (
            <span className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-[#EA002C]/85 text-white pointer-events-none">
              🔍 {focusLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowFoup(v => !v)}
            className="text-[10px] font-bold px-2.5 py-1 rounded-md backdrop-blur-sm transition-all"
            style={{ background: showFoup ? "rgba(59,130,246,0.75)" : "rgba(0,0,0,0.45)", color: "#fff" }}>
            FOUP {showFoup ? "ON" : "OFF"}
          </button>
          <button onClick={() => setShowPipes(v => !v)}
            className="text-[10px] font-bold px-2.5 py-1 rounded-md backdrop-blur-sm transition-all"
            style={{ background: showPipes ? "rgba(16,185,129,0.75)" : "rgba(0,0,0,0.45)", color: "#fff" }}>
            자재흐름 {showPipes ? "ON" : "OFF"}
          </button>
        </div>
      </div>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[10px] text-white/70 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1 pointer-events-none">
        드래그 이동 · 우클릭 회전 · 휠 줌 · 클릭 확대
      </div>

      {/* FOUP status overlay — 2열 컴팩트 그리드 */}
      <div className="absolute bottom-3 left-3 pointer-events-none bg-black/55 backdrop-blur-sm rounded-xl px-2.5 py-2">
        <div className="text-[9px] text-white/40 mb-1.5 font-semibold tracking-wider">
          WATCHED FOUP × {legendData.length}{foupFleet?.manifestStatus === "ACTIVE" ? ` · LEDGER ${foupFleet.actual.physicalFleet.toLocaleString()}` : ""}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {legendData.map((w) => {
            const proc = PROCESSES.find((p) => p.code === w.bay);
            return (
              <div key={w.id} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: w.color, opacity: w.phase === "processing" ? 1 : 0.45 }} />
                <span className="text-[9px] font-bold w-5" style={{ color: w.isLive ? "#38bdf8" : "rgba(255,255,255,0.7)" }}>
                  {w.isLive ? "🔴" : w.id.replace("W", "")}
                </span>
                <span className="text-[9px] font-bold px-1 py-0.5 rounded-sm"
                  style={{ background: proc?.color ?? "#333", color: "#fff" }}>
                  {w.bay}
                </span>
                <span className="text-[8px]" style={{ color: w.isLive ? "#38bdf8" : "rgba(255,255,255,0.35)" }}>
                  {w.isLive ? "LIVE · OPERATOR_CONFIRM 대기" : w.phase === "processing" ? "⚙" : "▶"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 창고 hover 팝업 — capacity 데이터 미리보기 */}
      {hoveredWh && (() => {
        const wh = warehouses.find((w) => w.code === hoveredWh);
        if (!wh) return null;
        const util = wh.utilization ?? 0;
        const cats = wh.byCategory ?? [];
        return (
          <div className="absolute top-3 right-3 bg-black/80 backdrop-blur-sm rounded-xl px-3 py-2.5 pointer-events-none min-w-[160px]">
            <div className="text-[11px] font-bold text-white mb-0.5">{wh.code}</div>
            <div className="text-[9px] text-white/50 mb-2">{wh.name}</div>
            {util > 0 ? (
              <>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="flex-1 h-1.5 bg-white/15 rounded-full overflow-hidden flex">
                    {cats.map((b) => (
                      <div key={b.category}
                        style={{ width: `${b.pct * 100}%`, background: CATEGORY_COLOR[b.category] ?? "#888" }} />
                    ))}
                  </div>
                  <span className="text-[10px] font-bold text-white flex-shrink-0">{util}%</span>
                </div>
                <div className="flex flex-col gap-0.5 mb-2">
                  {cats.slice(0, 4).map((b) => (
                    <div key={b.category} className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-sm flex-shrink-0"
                        style={{ background: CATEGORY_COLOR[b.category] ?? "#888" }} />
                      <span className="text-[9px] text-white/60">{b.category}</span>
                      <span className="text-[9px] text-white ml-auto">{(b.pct * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-[9px] text-white/30 mb-2">점유 데이터 없음</div>
            )}
            <div className="text-[8px] text-white/30 border-t border-white/10 pt-1.5">
              {wh.processCount}개 공정 공급 · 클릭하면 상세 보기
            </div>
          </div>
        );
      })()}

      {/* Legend — hover 중이 아닐 때 */}
      {!hoveredWh && (
        <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2 pointer-events-none">
          <div className="text-[9px] text-white/50 mb-1">Photo (P03)만 5회+ 방문</div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#EC4899]" />
            <span className="text-[9px] text-white/70">FOUP = 웨이퍼 25장 카세트</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-6 h-0.5 bg-[#8898aa]" />
            <span className="text-[9px] text-white/70">AMHS 자동 반송 레일</span>
          </div>
        </div>
      )}
    </div>
  );
}
