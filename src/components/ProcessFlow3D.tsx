"use client";

import React, { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
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

const PITCH     = 1.05;
const MACHINE_H = 1.75;
const MACHINE_W = 0.72;
const MACHINE_D = 0.65;
const BAY_HALF  = 1.4;
const CORR_HALF = 1.55;

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
// Individual machine cabinet
// ─────────────────────────────────────────────
function FabMachine({ x, z, proc, isHL, isDimmed, machineIdx }: {
  x: number; z: number; proc: typeof PROCESSES[0];
  isHL: boolean; isDimmed: boolean; machineIdx: number;
}) {
  const bodyColor = isDimmed ? "#d8dce0" : isHL ? "#eef4ff" : "#eaecf0";
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, MACHINE_H / 2, 0]} castShadow>
        <boxGeometry args={[MACHINE_W, MACHINE_H, MACHINE_D]} />
        <meshStandardMaterial color={bodyColor} roughness={0.18} metalness={0.07}
          emissive={isHL ? proc.color : "#000"} emissiveIntensity={isHL ? 0.15 : 0}
          transparent opacity={isDimmed ? 0.45 : 1} />
      </mesh>
      <mesh position={[0, MACHINE_H + 0.045, 0]}>
        <boxGeometry args={[MACHINE_W, 0.09, MACHINE_D]} />
        <meshStandardMaterial color={proc.color} emissive={proc.color}
          emissiveIntensity={isHL ? 1.8 : isDimmed ? 0.15 : 0.55}
          transparent opacity={isDimmed ? 0.4 : 1} />
      </mesh>
      <mesh position={[0, 0.35, MACHINE_D / 2 + 0.006]}>
        <boxGeometry args={[0.42, 0.36, 0.01]} />
        <meshStandardMaterial color="#12121e" transparent opacity={isDimmed ? 0.3 : 1} />
      </mesh>
      <mesh position={[0, MACHINE_H * 0.65, MACHINE_D / 2 + 0.006]}>
        <boxGeometry args={[0.26, 0.2, 0.01]} />
        <meshStandardMaterial color="#050510"
          emissive={isHL ? "#80b8ff" : "#1a3a6a"}
          emissiveIntensity={isHL ? 0.9 : 0.25}
          transparent opacity={isDimmed ? 0.3 : 1} />
      </mesh>
      {!isDimmed && (
        <Text position={[0, MACHINE_H + 0.14, MACHINE_D / 2]}
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
  const isFEOL = bayZ < 0;
  const innerZ = isFEOL ? bayZ + BAY_HALF * 0.45 : bayZ - BAY_HALF * 0.45;
  const outerZ = isFEOL ? bayZ - BAY_HALF * 0.55 : bayZ + BAY_HALF * 0.55;
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

      {/* Machines */}
      {xs.map((x, i) => (
        <FabMachine key={`in-${i}`} x={x} z={innerZ} proc={proc}
          isHL={isHL} isDimmed={isDimmed} machineIdx={i} />
      ))}
      {xs.map((x, i) => (
        <FabMachine key={`out-${i}`} x={x} z={outerZ} proc={proc}
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
// Main 3D Scene
// ─────────────────────────────────────────────
function Scene({
  highlightedProcesses, onProcessClick,
  waferStates,
}: {
  highlightedProcesses: string[];
  onProcessClick?: (code: string) => void;
  waferStates: React.MutableRefObject<WaferState>[];
}) {
  const isHL     = (c: string) => highlightedProcesses.includes(c);
  const isDimmed = (c: string) => highlightedProcesses.length > 0 && !isHL(c);
  const floorW = 11, floorD = 30;

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
      <ambientLight intensity={1.2} color="#f4f6ff" />
      <directionalLight position={[6, 14, 10]} intensity={0.5} castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-13} shadow-camera-right={13}
        shadow-camera-top={22} shadow-camera-bottom={-22} />
      <directionalLight position={[-5, 10, -6]} intensity={0.25} color="#e8eeff" />

      {/* Floor */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[floorW + 2, floorD + 2]} />
        <meshStandardMaterial color="#eaecf0" roughness={0.28} metalness={0.04} />
      </mesh>

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
          onClick={() => onProcessClick?.(proc.code)} />
      ))}

      {/* Animated FOUPs */}
      {WAFER_CONFIGS.map((cfg, i) => (
        <AnimatedFoup key={cfg.id} config={cfg} stateRef={waferStates[i]} />
      ))}

      <OrbitControls enablePan minDistance={6} maxDistance={45}
        maxPolarAngle={Math.PI / 2.02} target={[0, 1.2, 0]} />
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
}: {
  highlightedProcesses?: string[];
  activeProcesses?: string[];
  onProcessClick?: (code: string) => void;
  materialCounts?: Record<string, number>;
}) {
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
      <Canvas camera={{ position: [0, 22, 28], fov: 52 }} shadows
        style={{ background: "linear-gradient(180deg,#d0dce8 0%,#e0eaf4 100%)", borderRadius: 16 }}>
        <Suspense fallback={null}>
          <Scene
            highlightedProcesses={highlightedProcesses}
            onProcessClick={onProcessClick}
            waferStates={waferStates}
          />
        </Suspense>
      </Canvas>

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
