"use client";

import React, { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Text, CameraControls, Environment, Lightformer, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import PanCameraControls from "@/components/PanCameraControls";

import { PROCESSES } from "@/lib/processes";
export type { ProcessDef } from "@/lib/processes";
export { PROCESSES };

const PITCH     = 1.3;
const MACHINE_H = 1.75;
const MACHINE_W = 0.72;
const BAY_HALF  = 1.6;
const CORR_HALF = 1.55;

// 장비 수 변경 시 FAB 폭 자동 스케일
const _MAX_BAY_W = Math.max(...PROCESSES.map(p => (p.nMachines - 1) * PITCH + MACHINE_W + 0.4));
const FAB_W = Math.max(12, Math.ceil(_MAX_BAY_W) + 2);

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

const FEOL_ORDER = ["P01", "P02", "P03", "P04", "P05"] as const;
const BEOL_ORDER = ["P06", "P07", "P08", "P09", "P10"] as const;

function computeBayZ(): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    map[FEOL_ORDER[i]] = -(CORR_HALF + BAY_HALF + (4 - i) * BAY_HALF * 2);
    map[BEOL_ORDER[i]] = +(CORR_HALF + BAY_HALF + i * BAY_HALF * 2);
  }
  return map;
}
const BAY_Z = computeBayZ();

function machineXPositions(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * PITCH);
}

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
  "P10",            // 25. Final packaging
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

const RAIL_X        = FAB_W * 0.37;
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

function makeCurve(fromCode: string, toCode: string): THREE.CatmullRomCurve3 {
  const fz = BAY_Z[fromCode];
  const tz = BAY_Z[toCode];
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, RAIL_Y, fz),
    new THREE.Vector3(RAIL_X, RAIL_Y, fz),
    new THREE.Vector3(RAIL_X, RAIL_Y, (fz + tz) / 2),
    new THREE.Vector3(RAIL_X, RAIL_Y, tz),
    new THREE.Vector3(0, RAIL_Y, tz),
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

function FabTool({ x, z, proc, isHL, isDimmed, machineIdx, kind, facing }: {
  x: number; z: number; proc: typeof PROCESSES[0];
  isHL: boolean; isDimmed: boolean; machineIdx: number;
  kind: ToolKind; facing: number;
}) {
  const bodyColor = isDimmed ? "#d3d7dc" : isHL ? "#eef4ff" : "#dde0e5";
  const op = isDimmed ? 0.45 : 1;
  const [w, h, d] = TOOL_DIM[kind];
  const bodyProps = {
    color: bodyColor, roughness: 0.34, metalness: 0.32, // 도장 금속 패널 — 환경광 반사
    emissive: isHL ? proc.color : "#000", emissiveIntensity: isHL ? 0.15 : 0,
    transparent: true, opacity: op,
  };
  const front = facing * (d / 2 + 0.28); // EFEM 위치 (통로 방향)

  return (
    <group position={[x, 0, z]}>
      {/* ── 본체 (공정별 형태) ── */}
      {kind === "box" && (
        <mesh position={[0, h / 2, 0]} castShadow>
          <boxGeometry args={[w, h, d]} /><meshStandardMaterial {...bodyProps} />
        </mesh>
      )}
      {kind === "furnace" && (
        <>
          <mesh position={[0, h / 2, 0]} castShadow>
            <boxGeometry args={[w, h, d]} /><meshStandardMaterial {...bodyProps} />
          </mesh>
          {[0.55, 1.15, 1.75].map((by) => (
            <mesh key={by} position={[0, by, d / 2 + 0.01]}>
              <boxGeometry args={[w * 0.9, 0.12, 0.03]} />
              <meshStandardMaterial color="#9aa6b2" metalness={0.5} roughness={0.4} transparent opacity={op} />
            </mesh>
          ))}
        </>
      )}
      {kind === "litho" && (
        <>
          <mesh position={[0, h / 2, 0]} castShadow>
            <boxGeometry args={[w, h, d]} /><meshStandardMaterial {...bodyProps} />
          </mesh>
          {/* 상단 광학 모듈 */}
          <mesh position={[0, h + 0.2, -d * 0.15]} castShadow>
            <boxGeometry args={[w * 0.7, 0.5, d * 0.6]} />
            <meshStandardMaterial color={isDimmed ? "#c4cad2" : "#d3d9e0"} metalness={0.2} roughness={0.35} transparent opacity={op} />
          </mesh>
        </>
      )}
      {kind === "cluster" && (
        <>
          {/* 중앙 메인프레임(트랜스퍼 챔버) */}
          <mesh position={[0, h / 2, 0]} castShadow>
            <cylinderGeometry args={[w * 0.42, w * 0.42, h, 8]} />
            <meshStandardMaterial {...bodyProps} />
          </mesh>
          {/* 방사형 프로세스 챔버 3기 */}
          {[0, 2.1, 4.2].map((a, i) => (
            <mesh key={i} position={[Math.cos(a) * w * 0.5, h * 0.62, Math.sin(a) * d * 0.5]} castShadow>
              <cylinderGeometry args={[0.26, 0.26, 0.34, 12]} />
              <meshStandardMaterial color={isDimmed ? "#cdd3da" : "#dde3ea"} metalness={0.15} roughness={0.4}
                emissive={isHL ? proc.color : "#000"} emissiveIntensity={isHL ? 0.2 : 0} transparent opacity={op} />
            </mesh>
          ))}
        </>
      )}
      {kind === "cmp" && (
        <>
          <mesh position={[0, h / 2, 0]} castShadow>
            <boxGeometry args={[w, h, d]} /><meshStandardMaterial {...bodyProps} />
          </mesh>
          {/* 연마 정반(platen) 2기 */}
          {[-w * 0.2, w * 0.2].map((px) => (
            <mesh key={px} position={[px, h + 0.06, 0]}>
              <cylinderGeometry args={[0.3, 0.3, 0.1, 20]} />
              <meshStandardMaterial color={isDimmed ? "#c8ced6" : "#cfd6de"} metalness={0.1} roughness={0.5} transparent opacity={op} />
            </mesh>
          ))}
        </>
      )}

      {/* 상단 상태등 (공정 색) */}
      <mesh position={[0, h + 0.05, 0]}>
        <boxGeometry args={[Math.min(w, 0.5) * 0.6, 0.08, Math.min(d, 0.5) * 0.6]} />
        <meshStandardMaterial color={proc.color} emissive={proc.color}
          emissiveIntensity={isHL ? 1.8 : isDimmed ? 0.15 : 0.6} transparent opacity={op} />
      </mesh>

      {/* EFEM + 로드포트 2기 (통로를 향함) */}
      <mesh position={[0, 0.48, front]} castShadow>
        <boxGeometry args={[w * 0.92, 0.96, 0.5]} />
        <meshStandardMaterial color={isDimmed ? "#cfd4da" : "#dfe4ea"} roughness={0.3} metalness={0.1} transparent opacity={op} />
      </mesh>
      {[-0.19, 0.19].map((lx) => (
        <mesh key={lx} position={[lx, 1.08, front + facing * 0.04]}>
          <boxGeometry args={[0.22, 0.26, 0.22]} />
          <meshStandardMaterial color={proc.color} roughness={0.4}
            emissive={proc.color} emissiveIntensity={isDimmed ? 0.05 : isHL ? 0.6 : 0.25} transparent opacity={op} />
        </mesh>
      ))}

      {!isDimmed && (
        <Text position={[0, h + 0.16, 0]}
          fontSize={0.075} color={isHL ? proc.color : "#999"} anchorX="center" anchorY="bottom">
          {`${proc.code}-${String(machineIdx + 1).padStart(2, "0")}`}
        </Text>
      )}
    </group>
  );
}

// ─────────────────────────────────────────────
// Process bay (2 equipment rows + AMHS intrabay rail)
// ─────────────────────────────────────────────
function ProcessBay({ proc, isHL, isDimmed, activeFoupCount, onClick }: {
  proc: typeof PROCESSES[0]; isHL: boolean; isDimmed: boolean;
  activeFoupCount: number; onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  const bayZ   = BAY_Z[proc.code];
  const xs     = machineXPositions(proc.nMachines);
  const kind   = PROCESS_KIND[proc.code] ?? "box";
  const rowGap = 0.62;                 // 통로 반폭 (두 열 사이 생산 통로)
  const zIn    = bayZ - rowGap;        // 통로 아래쪽 열 (통로 향해 +z)
  const zOut   = bayZ + rowGap;        // 통로 위쪽 열 (통로 향해 -z)
  const bayW   = (proc.nMachines - 1) * PITCH + MACHINE_W + 0.4;

  return (
    <group>
      {/* Clickable floor area */}
      <mesh position={[0, 0.01, bayZ]}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerEnter={(e) => { e.stopPropagation(); setHov(true); document.body.style.cursor = "pointer"; }}
        onPointerLeave={() => { setHov(false); document.body.style.cursor = ""; }}>
        <boxGeometry args={[bayW, 0.02, BAY_HALF * 2]} />
        <meshStandardMaterial transparent opacity={0} />
      </mesh>

      {/* Floor tint */}
      <mesh position={[0, 0.003, bayZ]}>
        <boxGeometry args={[bayW, 0.005, BAY_HALF * 2]} />
        <meshStandardMaterial color={proc.yellowBay ? "#ffd700" : proc.color} transparent
          opacity={isDimmed ? 0.03 : isHL ? 0.18 : hov ? 0.1 : proc.yellowBay ? 0.06 : 0.05} />
      </mesh>

      {/* Photo bay subtle ambient — static intensity, no flash */}
      {proc.yellowBay && (
        <pointLight position={[0, 3.5, bayZ]} color="#ffd000" intensity={0.8} distance={5} decay={2} />
      )}

      {/* 생산 통로 (두 열 사이, 청정 aisle) */}
      <mesh position={[0, 0.006, bayZ]}>
        <boxGeometry args={[bayW + 0.3, 0.006, rowGap * 2 - 0.5]} />
        <meshStandardMaterial color="#e8f0fa" transparent opacity={isDimmed ? 0.05 : 0.5} />
      </mesh>
      {/* 서비스 체이스 (각 열 뒤편, 회색 설비 공간) */}
      {[bayZ - BAY_HALF + 0.28, bayZ + BAY_HALF - 0.28].map((cz) => (
        <mesh key={cz} position={[0, 0.005, cz]}>
          <boxGeometry args={[bayW, 0.005, 0.42]} />
          <meshStandardMaterial color="#c2c8d0" transparent opacity={isDimmed ? 0.04 : 0.45} />
        </mesh>
      ))}

      {/* 장비 2열 — 통로를 마주보게 (bay-and-chase) */}
      {xs.map((x, i) => (
        <FabTool key={`in-${i}`} x={x} z={zIn} proc={proc} kind={kind} facing={+1}
          isHL={isHL} isDimmed={isDimmed} machineIdx={i} />
      ))}
      {xs.map((x, i) => (
        <FabTool key={`out-${i}`} x={x} z={zOut} proc={proc} kind={kind} facing={-1}
          isHL={isHL} isDimmed={isDimmed} machineIdx={proc.nMachines + i} />
      ))}

      {/* Intrabay AMHS rail */}
      <mesh position={[0, 2.85, bayZ]}>
        <boxGeometry args={[bayW + 0.2, 0.04, 0.07]} />
        <meshStandardMaterial color="#9aaabb" metalness={0.6} roughness={0.3}
          transparent opacity={isDimmed ? 0.3 : 1} />
      </mesh>

      {/* Bay labels */}
      <Text position={[0, 2.15, bayZ]} fontSize={0.21}
        color={isHL ? proc.color : hov ? proc.color : "#374151"}
        anchorX="center" anchorY="middle">
        {`${proc.code}  ${proc.name}`}
      </Text>
      <Text position={[0, 1.9, bayZ]} fontSize={0.12} color={isHL ? proc.color : "#9ca3af"}
        anchorX="center" anchorY="middle">
        {`${proc.nameEn} · ×${proc.nMachines * 2}대`}
      </Text>

      {/* FOUP-in-bay indicator */}
      {activeFoupCount > 0 && (
        <Text position={[bayW / 2 + 0.15, MACHINE_H * 0.6, bayZ]} fontSize={0.18}
          color="#fff" anchorX="left">
          {`×${activeFoupCount}`}
        </Text>
      )}
    </group>
  );
}

// ─────────────────────────────────────────────
// Overhead AMHS rails (no solid ceiling)
// ─────────────────────────────────────────────
function OverheadInfra() {
  const sceneD = 30;
  const rx = FAB_W * 0.41;  // 백본 레일 X 위치 (fab 폭 기준)
  const lxs = [-rx * 0.5, 0, rx * 0.5];  // 조명 스트립 X 위치
  return (
    <group>
      {[-rx, rx].map((x) => (
        <mesh key={x} position={[x, RAIL_Y, 0]}>
          <boxGeometry args={[0.07, 0.055, sceneD - 1]} />
          <meshStandardMaterial color="#8898aa" metalness={0.75} roughness={0.2} />
        </mesh>
      ))}
      {Array.from({ length: 11 }, (_, i) => (i - 5) * 2.8).map((z) => (
        <mesh key={z} position={[0, RAIL_Y, z]}>
          <boxGeometry args={[FAB_W + 1, 0.045, 0.055]} />
          <meshStandardMaterial color="#9aabb8" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      {lxs.map((x) =>
        [-12, -6, 0, 6, 12].map((z) => (
          <mesh key={`ls-${x}-${z}`} position={[x, RAIL_Y - 0.07, z]}>
            <boxGeometry args={[0.12, 0.018, 2.2]} />
            <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={0.45} />
          </mesh>
        ))
      )}
    </group>
  );
}

// ─────────────────────────────────────────────
// Animated FOUP on the AMHS rail
// ─────────────────────────────────────────────
function AnimatedFoup({ config, stateRef }: {
  config: typeof WAFER_CONFIGS[0];
  stateRef: React.MutableRefObject<WaferState>;
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
    const bz = BAY_Z[WAFER_RECIPE[config.startStep] ?? "P01"];
    return new THREE.Vector3(0, RAIL_Y, bz);
  }, [config.startStep]);

  return (
    <group ref={groupRef} position={initPos}>
      {/* FOUP body */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.3, 0.22, 0.26]} />
        <meshStandardMaterial color={config.color} roughness={0.25} metalness={0.2}
          emissive={config.color} emissiveIntensity={0.5} />
      </mesh>
      {/* Pulsing ring (shows when processing) */}
      <mesh ref={ringRef} position={[0, 0, 0]}>
        <torusGeometry args={[0.28, 0.02, 6, 20]} />
        <meshStandardMaterial color={config.color} emissive={config.color} emissiveIntensity={1.2}
          transparent opacity={0.85} />
      </mesh>
      {/* Label — 번호만 표시해서 12개가 돼도 뷰가 깔끔하게 유지됨 */}
      <Text position={[0, 0.22, 0]} fontSize={0.09} color={config.color}
        anchorX="center" anchorY="bottom">
        {config.id.replace("W", "")}
      </Text>
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
        {meta.short}
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
function makePipeCurve(whCode: string, bayZ: number): THREE.CatmullRomCurve3 {
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
    new THREE.Vector3(-2.6, 0.42, bayZ),     // 베이로 드롭
  ]);
}

function SupplyPipe({ link, active }: { link: WarehouseLink; active: boolean }) {
  const bayZ = BAY_Z[link.procCode];
  const curve = useMemo(() => makePipeCurve(link.whCode, bayZ), [link.whCode, bayZ]);
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
export const OVERVIEW_FOCUS: FocusView = { cam: [-4, FAB_W * 1.15, FAB_W * 1.9], look: [0, 0.5, 0] };

export function focusForWarehouse(code: string): FocusView {
  const m = WH_META[code];
  if (!m) return OVERVIEW_FOCUS;
  return {
    cam: [WH_X - 3.5, m.h * 0.6 + 2.2, m.z + 4.5], // 더 가까이 확대
    look: [WH_X + 0.5, m.h / 2, m.z],
  };
}
export function focusForBay(code: string): FocusView {
  const bz = BAY_Z[code] ?? 0;
  return { cam: [5.5, 3.8, bz + 3], look: [0, 1.1, bz] }; // 더 가까이 확대
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
    const W = 13, D = 36, step = 0.6;
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
    <lineSegments geometry={geom} position={[0, 0.007, 0]}>
      <lineBasicMaterial color="#9baab8" transparent opacity={0.38} />
    </lineSegments>
  );
}

// ─────────────────────────────────────────────
// Main 3D Scene
// ─────────────────────────────────────────────
function Scene({
  highlightedProcesses, onProcessClick,
  waferStates, warehouses, warehouseLinks,
  hoveredWh, setHoveredWh, onFocusWh, onFocusBay, focus,
  showFoup, showPipes,
}: {
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
  showPipes: boolean;
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

  const floorW = FAB_W, floorD = 34;

  // Count FOUPs currently at each bay (approximate — based on state at render time)
  const foupCounts: Record<string, number> = {};
  waferStates.forEach((ws) => {
    if (ws.current.phase === "processing") {
      const b = ws.current.currentBay;
      foupCounts[b] = (foupCounts[b] ?? 0) + 1;
    }
  });

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

      <ContactShadows position={[0, 0.02, 0]} scale={floorW + 40} blur={2.2} opacity={0.3} far={12} resolution={1024} color="#3a4250" />

      {/* 클린룸 에폭시 바닥 — 광택 코팅 (실제 FAB) */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[floorW + 2, floorD + 2]} />
        <meshStandardMaterial color="#eaecf0" roughness={0.22} metalness={0.18} />
      </mesh>
      {/* 600 mm 타일 격자선 (raised access floor) */}
      <CleanroomFloorGrid />
      {/* 클린룸 슬래브 두께 */}
      <mesh position={[0, -0.16, 0]}>
        <boxGeometry args={[floorW + 2, 0.32, floorD + 2]} />
        <meshStandardMaterial color="#cfd6dd" roughness={0.7} metalness={0.05} />
      </mesh>

      {/* CUB + 가스야드 + 부대설비 */}
      <CUB />
      <AuxFacilities />
      <GasYard dim={!!hoveredWh} />

      {/* Corridor highlight */}
      <mesh position={[0, 0.002, 0]}>
        <boxGeometry args={[floorW + 2, 0.003, CORR_HALF * 2]} />
        <meshStandardMaterial color="#c8d4e0" transparent opacity={0.3} />
      </mesh>

      {/* Red safety tape at bay boundaries */}
      {PROCESSES.map((proc) => {
        const bz = BAY_Z[proc.code];
        const edge = bz < 0 ? bz + BAY_HALF : bz - BAY_HALF;
        return (
          <mesh key={proc.code} position={[0, 0.005, edge]}>
            <boxGeometry args={[floorW + 2, 0.004, 0.05]} />
            <meshStandardMaterial color="#cc2222" transparent opacity={0.5} />
          </mesh>
        );
      })}

      <OverheadInfra />

      {/* Section labels */}
      <Text position={[0, 3.8, -10]} fontSize={0.32} color="#6b7280" anchorX="center">전공정 (FEOL)</Text>
      <Text position={[0, 3.8,  10]} fontSize={0.32} color="#6b7280" anchorX="center">후공정 (BEOL)</Text>
      <Text position={[0, 0.02, 0]} fontSize={0.2} color="#94a3b8" anchorX="center" rotation={[-Math.PI / 2, 0, 0]}>
        AMHS 인터베이 코리더
      </Text>

      {/* Process bays */}
      {PROCESSES.map((proc) => (
        <ProcessBay key={proc.code} proc={proc}
          isHL={isHL(proc.code)} isDimmed={isDimmed(proc.code)}
          activeFoupCount={foupCounts[proc.code] ?? 0}
          onClick={() => { onProcessClick?.(proc.code); onFocusBay(proc.code); }} />
      ))}

      {/* Animated FOUPs */}
      {showFoup && WAFER_CONFIGS.map((cfg, i) => (
        <AnimatedFoup key={cfg.id} config={cfg} stateRef={waferStates[i]} />
      ))}

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
  highlightedProcesses = [],
  onProcessClick,
  onWarehouseClick,
  warehouses = [],
  warehouseLinks = [],
}: {
  highlightedProcesses?: string[];
  activeProcesses?: string[];
  onProcessClick?: (code: string) => void;
  onWarehouseClick?: (code: string) => void;
  materialCounts?: Record<string, number>;
  warehouses?: WarehouseInfo[];
  warehouseLinks?: WarehouseLink[];
}) {
  const [hoveredWh, setHoveredWh] = useState<string | null>(null);
  const [showFoup, setShowFoup] = useState(true);
  const [showPipes, setShowPipes] = useState(true);
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
    bayName?: string; stepIdx: number; phase: "processing" | "traveling";
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
      setLegendData(
        WAFER_CONFIGS.map((cfg, i) => {
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
  }, [waferStates]);

  return (
    <div className="relative w-full h-full">
      <Canvas camera={{ position: [-3, 21, 30], fov: 54 }} shadows dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
        style={{ background: "linear-gradient(180deg,#eaeff5 0%,#f4f7fa 55%,#ffffff 100%)", borderRadius: 16 }}>
        <Suspense fallback={null}>
          <Scene
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
          />
        </Suspense>
      </Canvas>

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
        <div className="text-[9px] text-white/40 mb-1.5 font-semibold tracking-wider">FOUP × {legendData.length}</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {legendData.map((w) => {
            const proc = PROCESSES.find((p) => p.code === w.bay);
            return (
              <div key={w.id} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: w.color, opacity: w.phase === "processing" ? 1 : 0.45 }} />
                <span className="text-[9px] font-bold text-white/70 w-5">{w.id.replace("W", "")}</span>
                <span className="text-[9px] font-bold px-1 py-0.5 rounded-sm"
                  style={{ background: proc?.color ?? "#333", color: "#fff" }}>
                  {w.bay}
                </span>
                <span className="text-[8px] text-white/35">
                  {w.phase === "processing" ? "⚙" : "▶"}
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
