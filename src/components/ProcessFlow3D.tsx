"use client";

import React, { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Text, CameraControls, Environment, Lightformer, ContactShadows } from "@react-three/drei";
import * as THREE from "three";

export const PROCESSES = [
  { code: "P01", name: "산화막",        nameEn: "Oxidation",     color: "#3B82F6", activities: ["열산화 성장", "SiO₂ 게이트막", "절연층 형성"],    nMachines: 4 },
  { code: "P02", name: "CVD",           nameEn: "CVD",           color: "#8B5CF6", activities: ["박막 증착", "PECVD/LPCVD", "유전체 형성"],          nMachines: 6 },
  { code: "P03", name: "포토",          nameEn: "Photo",         color: "#EC4899", activities: ["PR 도포", "EUV/ArF 노광", "현상·검사"],             nMachines: 6, yellowBay: true },
  { code: "P04", name: "식각",          nameEn: "Etching",       color: "#F97316", activities: ["건식/습식 식각", "패턴 전사", "선택비 제어"],         nMachines: 8 },
  { code: "P05", name: "이온주입",      nameEn: "Ion Implant",   color: "#EAB308", activities: ["불순물 주입", "도즈량 제어", "열처리 활성화"],        nMachines: 4 },
  { code: "P06", name: "금속배선1",     nameEn: "Metallization", color: "#10B981", activities: ["Al/Cu 스퍼터링", "배선 패터닝", "비아 형성"],         nMachines: 5 },
  { code: "P07", name: "CMP",           nameEn: "CMP",           color: "#06B6D4", activities: ["전면 평탄화", "연마 속도 제어", "슬러리 관리"],       nMachines: 5 },
  { code: "P08", name: "TSV/배선2",     nameEn: "TSV/Metal2",    color: "#EF4444", activities: ["관통 전극 형성", "Cu 도금", "3D 적층 배선"],          nMachines: 4 },
  { code: "P09", name: "웨이퍼테스트",  nameEn: "Wafer Test",    color: "#84CC16", activities: ["전기 특성 검사", "수율 분석", "불량 맵핑"],            nMachines: 6 },
  { code: "P10", name: "패키징",        nameEn: "Packaging",     color: "#D946EF", activities: ["다이 절단", "HBM 적층 본딩", "최종 검사"],            nMachines: 5 },
];

const PITCH     = 1.3;  // 장비 간 정비 클리어런스 반영
const MACHINE_H = 1.75;
const MACHINE_W = 0.72;
const MACHINE_D = 0.65;
const BAY_HALF  = 1.6;  // 통로+체이스 공간 확보
const CORR_HALF = 1.55;

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
const WH_X = -11.5;
const WH_META: Record<string, {
  z: number; short: string; lane: number;
  kind: "asrs" | "hazmat" | "flat" | "mro";
  w: number; d: number; h: number;
}> = {
  "WH-A": { z: -9.5, short: "A동 AS/RS 자동화창고", lane: 0, kind: "asrs",   w: 3.4, d: 6.0, h: 7.2 }, // 고층 자동화
  "WH-C": { z: -2.0, short: "C동 위험물 별동",       lane: 1, kind: "hazmat", w: 3.0, d: 3.4, h: 2.3 }, // 방폭 저층
  "WH-B": { z:  6.0, short: "B동 평치창고",          lane: 2, kind: "flat",   w: 3.2, d: 4.4, h: 3.6 }, // 중층
  "WH-D": { z: 11.6, short: "D동 공구·MRO",         lane: 3, kind: "mro",    w: 2.6, d: 3.0, h: 2.8 }, // 소형
};
const WH_HEADER_X = -6.0; // 벽면 서플라이 헤더 X

// 가스야드 (벌크가스 ISO 탱크 — 창고 아님, 배관으로 팹 공급)
const GAS_YARD = { x: -12.2, z: -15.0 };

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
  { id: "W01", label: "FOUP-A", color: "#EF4444", startStep: 0  },
  { id: "W02", label: "FOUP-B", color: "#3B82F6", startStep: 6  },
  { id: "W03", label: "FOUP-C", color: "#EAB308", startStep: 13 },
  { id: "W04", label: "FOUP-D", color: "#10B981", startStep: 20 },
];

const RAIL_X        = 4.8;
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
        <meshStandardMaterial color={(proc as any).yellowBay ? "#ffd700" : proc.color} transparent
          opacity={isDimmed ? 0.03 : isHL ? 0.18 : hov ? 0.1 : (proc as any).yellowBay ? 0.06 : 0.05} />
      </mesh>

      {/* Photo bay subtle ambient — static intensity, no flash */}
      {(proc as any).yellowBay && (
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
  return (
    <group>
      {[-4.2, 4.2].map((x) => (
        <mesh key={x} position={[x, RAIL_Y, 0]}>
          <boxGeometry args={[0.07, 0.055, sceneD - 1]} />
          <meshStandardMaterial color="#8898aa" metalness={0.75} roughness={0.2} />
        </mesh>
      ))}
      {Array.from({ length: 11 }, (_, i) => (i - 5) * 2.8).map((z) => (
        <mesh key={z} position={[0, RAIL_Y, z]}>
          <boxGeometry args={[9.8, 0.045, 0.055]} />
          <meshStandardMaterial color="#9aabb8" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      {[-2.4, 0, 2.4].map((x) =>
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
      {/* Label */}
      <Text position={[0, 0.22, 0]} fontSize={0.1} color={config.color}
        anchorX="center" anchorY="bottom">
        {config.label}
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
};
export type WarehouseLink = {
  whCode: string; procCode: string; qty: number; category: string;
};

// 고층 AS/RS 자동화 랙 (개방형 철골 + 다단 선반 + 파렛트 + 스태커 크레인)
function ASRSStructure({ w, d, h, color, opacity, dim }: {
  w: number; d: number; h: number; color: string; opacity: number; dim: boolean;
}) {
  const levels = 6;
  const bays = 4; // 통로 양쪽 랙 열 방향 파렛트 수(D 방향)
  const steel = dim ? "#9aa4ad" : "#6b7783";
  const postXs = [-w / 2, -0.15, 0.15, w / 2];
  return (
    <group>
      {/* 수직 기둥 */}
      {postXs.map((px) =>
        [-d / 2, d / 2].map((pz) => (
          <mesh key={`p${px}-${pz}`} position={[px, h / 2, pz]} castShadow>
            <boxGeometry args={[0.09, h, 0.09]} />
            <meshStandardMaterial color={steel} metalness={0.6} roughness={0.35} transparent opacity={opacity} />
          </mesh>
        ))
      )}
      {/* 다단 선반 빔 + 파렛트 */}
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
            {/* 파렛트 박스 (카테고리 색, 랜덤 채움) */}
            {[-w / 2 + 0.55, w / 2 - 0.55].map((rx) =>
              Array.from({ length: bays }).map((__, bi) => {
                const pz = -d / 2 + 0.7 + bi * ((d - 1.2) / (bays - 1));
                const filled = (lv * 7 + bi * 3 + (rx < 0 ? 1 : 0)) % 5 !== 0;
                if (!filled) return null;
                return (
                  <mesh key={`box${rx}-${bi}`} position={[rx, y + 0.22, pz]} castShadow>
                    <boxGeometry args={[0.6, 0.34, 0.62]} />
                    <meshStandardMaterial color={color} roughness={0.6}
                      emissive={color} emissiveIntensity={dim ? 0.05 : 0.25} transparent opacity={opacity} />
                  </mesh>
                );
              })
            )}
          </group>
        );
      })}
      {/* 스태커 크레인 (중앙 통로 수직 마스트) */}
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[0.16, h, 0.16]} />
        <meshStandardMaterial color={dim ? "#c0c8d0" : "#e2b23a"} metalness={0.5} roughness={0.3}
          emissive={dim ? "#000" : "#e2b23a"} emissiveIntensity={dim ? 0 : 0.3} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, h * 0.45, 0]}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial color="#c9a227" metalness={0.4} roughness={0.4} transparent opacity={opacity} />
      </mesh>
      {/* 상단 지붕 프레임 + 측면 반투명 외벽 */}
      <mesh position={[0, h + 0.08, 0]}>
        <boxGeometry args={[w + 0.2, 0.12, d + 0.2]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim ? 0.1 : 0.5} transparent opacity={opacity} />
      </mesh>
      <mesh position={[-w / 2 - 0.05, h / 2, 0]}>
        <boxGeometry args={[0.04, h, d]} />
        <meshStandardMaterial color="#cdd6df" metalness={0.2} roughness={0.5} transparent opacity={opacity * 0.18} />
      </mesh>
    </group>
  );
}

// 방폭 위험물 별동 (저층 + 방류벽 + 벤트 스택)
function HazmatStructure({ w, d, h, color, opacity, dim }: {
  w: number; d: number; h: number; color: string; opacity: number; dim: boolean;
}) {
  return (
    <group>
      {/* 본체 */}
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={dim ? "#d8dce0" : "#cbd3da"} roughness={0.7} metalness={0.05} transparent opacity={opacity} />
      </mesh>
      {/* 위험물 경고 스트라이프 */}
      <mesh position={[0, h * 0.5, d / 2 + 0.01]}>
        <boxGeometry args={[w, 0.28, 0.02]} />
        <meshStandardMaterial color="#f2c200" emissive="#f2c200" emissiveIntensity={dim ? 0.1 : 0.5} transparent opacity={opacity} />
      </mesh>
      {/* 지붕 (위험물 색) */}
      <mesh position={[0, h + 0.06, 0]}>
        <boxGeometry args={[w + 0.14, 0.12, d + 0.14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim ? 0.1 : 0.5} transparent opacity={opacity} />
      </mesh>
      {/* 방류벽(containment berm) */}
      {[[0, d / 2 + 0.35], [0, -d / 2 - 0.35]].map(([bx, bz], i) => (
        <mesh key={i} position={[bx, 0.18, bz]}>
          <boxGeometry args={[w + 0.9, 0.36, 0.1]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.8} transparent opacity={opacity} />
        </mesh>
      ))}
      {/* 벤트 스택 */}
      {[-w / 2 + 0.4, w / 2 - 0.4].map((vx) => (
        <mesh key={vx} position={[vx, h + 0.55, -d / 2 + 0.4]}>
          <cylinderGeometry args={[0.08, 0.08, 1.0, 10]} />
          <meshStandardMaterial color="#8894a0" metalness={0.6} roughness={0.3} transparent opacity={opacity} />
        </mesh>
      ))}
    </group>
  );
}

// 평치/MRO 중층 창고 (박스 본체 + 지붕 + 도크 셔터)
function FlatStructure({ w, d, h, color, opacity, dim }: {
  w: number; d: number; h: number; color: string; opacity: number; dim: boolean;
}) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={dim ? "#dfe4e8" : "#e2e8f0"} roughness={0.55} metalness={0.05} transparent opacity={opacity} />
      </mesh>
      {/* 지붕 */}
      <mesh position={[0, h + 0.07, 0]}>
        <boxGeometry args={[w + 0.14, 0.14, d + 0.14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim ? 0.1 : 0.5} transparent opacity={opacity} />
      </mesh>
      {/* 도크 셔터 (팹 방향) */}
      {[-d / 4, d / 4].map((dz) => (
        <mesh key={dz} position={[w / 2 + 0.01, h * 0.32, dz]}>
          <boxGeometry args={[0.03, h * 0.55, d * 0.3]} />
          <meshStandardMaterial color="#475569" roughness={0.6} transparent opacity={opacity} />
        </mesh>
      ))}
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

      {meta.kind === "asrs"   && <ASRSStructure   w={w} d={d} h={h} color={color} opacity={opacity} dim={dim} />}
      {meta.kind === "hazmat" && <HazmatStructure w={w} d={d} h={h} color={color} opacity={opacity} dim={dim} />}
      {(meta.kind === "flat" || meta.kind === "mro") &&
        <FlatStructure w={w} d={d} h={h} color={color} opacity={opacity} dim={dim} />}

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
          {`${wh.processCount}개 공정 · ${wh.totalQty.toLocaleString()}/월`}
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
  const lane = meta?.lane ?? 0;
  const y = 0.55 + lane * 0.32;       // 창고별 헤더 높이 분리
  const wz = meta?.z ?? 0;
  const wOut = (meta?.w ?? 2) / 2 + 0.2; // 창고 팹-방향 출구 면
  const hx = WH_HEADER_X - lane * 0.18; // 헤더 X도 살짝 분리
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(WH_X + wOut, y, wz),   // 창고 출구
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
  const x = 9.8, W = 3.2, D = 7.0, H = 5.0;
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
      <group position={[13.8, 0, 2]}>
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
      <group position={[9.8, 0, -10]}>
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
export const OVERVIEW_FOCUS: FocusView = { cam: [-4, 25, 42], look: [0, 0.5, 0] };

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
// Main 3D Scene
// ─────────────────────────────────────────────
function Scene({
  highlightedProcesses, onProcessClick,
  waferStates, warehouses, warehouseLinks,
  hoveredWh, setHoveredWh, onFocusWh, onFocusBay, focus,
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

  const floorW = 11, floorD = 34;

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
        shadow-camera-left={-16} shadow-camera-right={16}
        shadow-camera-top={24} shadow-camera-bottom={-24} />
      <directionalLight position={[-6, 10, -8]} intensity={0.4} color="#dce6ff" />

      {/* IBL 환경광 (금속·유리에 반사 → 실사 느낌). Lightformer로 스튜디오 라이트 구성(외부 다운로드 X) */}
      <Environment resolution={256}>
        <Lightformer intensity={2.2} form="rect" position={[0, 10, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[16, 24, 1]} color="#ffffff" />
        <Lightformer intensity={1.1} form="rect" position={[10, 6, 6]} rotation={[0, -Math.PI / 3, 0]} scale={[8, 10, 1]} color="#eaf0ff" />
        <Lightformer intensity={0.9} form="rect" position={[-10, 6, -4]} rotation={[0, Math.PI / 3, 0]} scale={[8, 10, 1]} color="#fff3e6" />
      </Environment>

      {/* 접지 소프트 섀도우 (장비 바닥 그림자 → 무게감) */}
      <ContactShadows position={[0, 0.02, 0]} scale={44} blur={2.2} opacity={0.35} far={12} resolution={1024} color="#3a4250" />

      {/* 클린룸 에폭시 바닥 (매트 — 반사 아티팩트 없이 균일한 톤) */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[floorW + 2, floorD + 2]} />
        <meshStandardMaterial color="#e7eaef" roughness={0.6} metalness={0.06} />
      </mesh>
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
      {WAFER_CONFIGS.map((cfg, i) => (
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
      {warehouseLinks.map((l) => (
        <SupplyPipe key={`${l.whCode}-${l.procCode}`} link={l} active={pipeActive(l)} />
      ))}

      {/* 자재창고 건물 */}
      {warehouses.map((wh) => (
        <WarehouseBuilding key={wh.code} wh={wh}
          isHL={whIsHL(wh.code)} isDimmed={whIsDimmed(wh.code)}
          onHover={() => setHoveredWh(wh.code)} onLeave={() => setHoveredWh(null)}
          onFocus={() => onFocusWh(wh.code)} />
      ))}

      <CameraControls ref={camRef} minDistance={2.2} maxDistance={75}
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
  activeProcesses = [],
  onProcessClick,
  materialCounts = {},
  warehouses = [],
  warehouseLinks = [],
}: {
  highlightedProcesses?: string[];
  activeProcesses?: string[];
  onProcessClick?: (code: string) => void;
  materialCounts?: Record<string, number>;
  warehouses?: WarehouseInfo[];
  warehouseLinks?: WarehouseLink[];
}) {
  const [hoveredWh, setHoveredWh] = useState<string | null>(null);
  // 카메라 포커스 상태 (클릭 → 줌인)
  const [focus, setFocus] = useState<FocusView>(OVERVIEW_FOCUS);
  const [focusLabel, setFocusLabel] = useState<string | null>(null);
  const focusWh = (code: string) => {
    setFocus(focusForWarehouse(code));
    setFocusLabel(`${code} 창고`);
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
          />
        </Suspense>
      </Canvas>

      {/* 카메라 포커스 컨트롤 */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <button onClick={resetView}
          className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white/90 hover:bg-black/75 transition-colors pointer-events-auto">
          ⤢ 전체 뷰
        </button>
        {focusLabel && (
          <span className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-[#EA002C]/85 text-white pointer-events-none">
            🔍 {focusLabel}
          </span>
        )}
      </div>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[10px] text-white/70 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1 pointer-events-none">
        창고·공정 클릭 → 확대 · 드래그 회전 · 휠 줌
      </div>

      {/* FOUP status overlay */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 pointer-events-none">
        {legendData.map((w) => {
          const recipeSlice = WAFER_RECIPE.slice(
            Math.max(0, w.stepIdx - 2), w.stepIdx + 4
          );
          return (
            <div key={w.id}
              className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1.5">
              <div className="w-3 h-3 rounded-sm flex-shrink-0 animate-pulse"
                style={{ backgroundColor: w.color, animationPlayState: w.phase === "processing" ? "running" : "paused" }} />
              <span className="text-[10px] font-bold text-white/90">{w.label}</span>
              <div className="flex items-center gap-0.5">
                {recipeSlice.map((code, ri) => {
                  const isNow = ri === Math.min(2, w.stepIdx);
                  const proc = PROCESSES.find((p) => p.code === code);
                  return (
                    <span key={ri}
                      className="text-[9px] font-bold px-1 py-0.5 rounded"
                      style={{
                        background: isNow ? proc?.color ?? "#444" : "#333",
                        color: isNow ? "#fff" : "#888",
                        scale: isNow ? "1.1" : "1",
                      }}>
                      {code}
                    </span>
                  );
                })}
                <span className="text-[9px] text-white/40 ml-0.5">…</span>
              </div>
              <span className="text-[9px] text-white/50 ml-auto">
                {w.phase === "processing" ? `⚙ ${(w as any).bayName ?? w.bay}` : "▶ 이동중"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
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
    </div>
  );
}
