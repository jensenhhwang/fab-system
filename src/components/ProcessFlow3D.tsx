"use client";

import { useRef, useState, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";

export const PROCESSES = [
  { code: "P01", name: "산화막",        nameEn: "Oxidation",    color: "#3B82F6", activities: ["열산화 성장", "SiO₂ 게이트막", "절연층 형성"] },
  { code: "P02", name: "CVD",           nameEn: "CVD",           color: "#8B5CF6", activities: ["박막 증착", "PECVD/LPCVD", "유전체 형성"] },
  { code: "P03", name: "포토",          nameEn: "Photo",         color: "#EC4899", activities: ["PR 도포", "EUV/ArF 노광", "현상·검사"] },
  { code: "P04", name: "식각",          nameEn: "Etching",       color: "#F97316", activities: ["건식/습식 식각", "패턴 전사", "선택비 제어"] },
  { code: "P05", name: "이온주입",      nameEn: "Ion Implant",   color: "#EAB308", activities: ["불순물 주입", "도즈량 제어", "열처리 활성화"] },
  { code: "P06", name: "금속배선1",     nameEn: "Metallization", color: "#10B981", activities: ["Al/Cu 스퍼터링", "배선 패터닝", "비아 형성"] },
  { code: "P07", name: "CMP",           nameEn: "CMP",           color: "#06B6D4", activities: ["전면 평탄화", "연마 속도 제어", "슬러리 관리"] },
  { code: "P08", name: "TSV/배선2",     nameEn: "TSV/Metal2",    color: "#EF4444", activities: ["관통 전극 형성", "Cu 도금", "3D 적층 배선"] },
  { code: "P09", name: "웨이퍼테스트",  nameEn: "Wafer Test",    color: "#84CC16", activities: ["전기 특성 검사", "수율 분석", "불량 맵핑"] },
  { code: "P10", name: "패키징",        nameEn: "Packaging",     color: "#D946EF", activities: ["다이 절단", "HBM 적층 본딩", "최종 검사"] },
];

const ZONE_CENTER: Record<string, [number, number, number]> = {
  P01: [-6, 0, -3.5], P02: [-3, 0, -3.5], P03: [0, 0, -3.5], P04: [3, 0, -3.5], P05: [6, 0, -3.5],
  P10: [-6, 0,  3.5], P09: [-3, 0,  3.5], P08: [0, 0,  3.5], P07: [3, 0,  3.5], P06: [6, 0,  3.5],
};

const TUBE_SEGMENTS: [string, string][] = [
  ["P01","P02"],["P02","P03"],["P03","P04"],["P04","P05"],
  ["P05","P06"],
  ["P06","P07"],["P07","P08"],["P08","P09"],["P09","P10"],
];

// Varied equipment layouts per zone — organic, not grid
type EqSpec = { ox: number; oz: number; rot: number; type: "std"|"big"|"cyl"|"wide"|"cab" };

const ZONE_EQ: Record<string, EqSpec[]> = {
  P01: [
    { ox:-0.7, oz:-0.55, rot:0,   type:"big"  },
    { ox: 0.1, oz:-0.6,  rot:0,   type:"std"  },
    { ox: 0.7, oz:-0.5,  rot:0.3, type:"cyl"  },
    { ox:-0.7, oz: 0.1,  rot:0,   type:"std"  },
    { ox: 0.0, oz: 0.05, rot:0,   type:"wide" },
    { ox:-0.65,oz: 0.62, rot:0,   type:"cab"  },
    { ox: 0.6, oz: 0.55, rot:-0.2,type:"std"  },
  ],
  P02: [
    { ox:-0.6, oz:-0.6,  rot:0,   type:"big"  },
    { ox: 0.2, oz:-0.55, rot:0.2, type:"big"  },
    { ox: 0.75,oz:-0.3,  rot:0,   type:"cyl"  },
    { ox:-0.7, oz: 0.2,  rot:0,   type:"std"  },
    { ox: 0.0, oz: 0.3,  rot:0,   type:"std"  },
    { ox: 0.65,oz: 0.55, rot:-0.3,type:"cab"  },
    { ox:-0.3, oz: 0.65, rot:0,   type:"std"  },
  ],
  P03: [
    { ox: 0.0, oz:-0.5,  rot:0,   type:"wide" },
    { ox:-0.75,oz:-0.35, rot:0,   type:"std"  },
    { ox: 0.72,oz:-0.4,  rot:0,   type:"std"  },
    { ox:-0.6, oz: 0.2,  rot:0.1, type:"big"  },
    { ox: 0.55,oz: 0.15, rot:-0.1,type:"std"  },
    { ox: 0.0, oz: 0.55, rot:0,   type:"wide" },
    { ox: 0.78,oz: 0.62, rot:0,   type:"cyl"  },
  ],
  P04: [
    { ox:-0.7, oz:-0.55, rot:0,   type:"cyl"  },
    { ox:-0.1, oz:-0.55, rot:0,   type:"big"  },
    { ox: 0.7, oz:-0.5,  rot:0,   type:"std"  },
    { ox:-0.75,oz: 0.1,  rot:0,   type:"std"  },
    { ox: 0.1, oz: 0.1,  rot:0,   type:"big"  },
    { ox: 0.75,oz: 0.2,  rot:0.3, type:"cyl"  },
    { ox:-0.3, oz: 0.62, rot:0,   type:"std"  },
    { ox: 0.55,oz: 0.65, rot:0,   type:"cab"  },
  ],
  P05: [
    { ox:-0.5, oz:-0.5,  rot:0,   type:"big"  },
    { ox: 0.45,oz:-0.55, rot:0,   type:"big"  },
    { ox:-0.78,oz: 0.15, rot:0,   type:"cyl"  },
    { ox: 0.0, oz: 0.1,  rot:0,   type:"std"  },
    { ox: 0.72,oz: 0.2,  rot:0.2, type:"std"  },
    { ox: 0.0, oz: 0.65, rot:0,   type:"wide" },
  ],
  P06: [
    { ox:-0.7, oz:-0.55, rot:0,   type:"std"  },
    { ox: 0.0, oz:-0.55, rot:0,   type:"big"  },
    { ox: 0.72,oz:-0.45, rot:0,   type:"std"  },
    { ox:-0.72,oz: 0.15, rot:0,   type:"cyl"  },
    { ox: 0.1, oz: 0.1,  rot:0.1, type:"std"  },
    { ox: 0.7, oz: 0.2,  rot:0,   type:"std"  },
    { ox:-0.3, oz: 0.62, rot:0,   type:"cab"  },
    { ox: 0.55,oz: 0.65, rot:0,   type:"std"  },
  ],
  P07: [
    { ox: 0.0, oz:-0.45, rot:0,   type:"wide" },
    { ox:-0.78,oz:-0.3,  rot:0,   type:"std"  },
    { ox: 0.75,oz:-0.35, rot:0.2, type:"cyl"  },
    { ox:-0.6, oz: 0.2,  rot:0,   type:"big"  },
    { ox: 0.5, oz: 0.1,  rot:0,   type:"std"  },
    { ox: 0.0, oz: 0.6,  rot:0,   type:"wide" },
  ],
  P08: [
    { ox:-0.65,oz:-0.55, rot:0,   type:"cyl"  },
    { ox: 0.0, oz:-0.5,  rot:0,   type:"big"  },
    { ox: 0.7, oz:-0.5,  rot:0,   type:"std"  },
    { ox:-0.7, oz: 0.1,  rot:0,   type:"big"  },
    { ox: 0.1, oz: 0.15, rot:0.2, type:"std"  },
    { ox: 0.75,oz: 0.2,  rot:0,   type:"cyl"  },
    { ox:-0.1, oz: 0.65, rot:0,   type:"std"  },
    { ox: 0.6, oz: 0.62, rot:0,   type:"cab"  },
  ],
  P09: [
    { ox:-0.5, oz:-0.55, rot:0,   type:"wide" },
    { ox: 0.5, oz:-0.55, rot:0,   type:"wide" },
    { ox:-0.78,oz: 0.05, rot:0,   type:"std"  },
    { ox: 0.0, oz: 0.0,  rot:0,   type:"big"  },
    { ox: 0.75,oz: 0.1,  rot:0.3, type:"std"  },
    { ox:-0.3, oz: 0.65, rot:0,   type:"std"  },
    { ox: 0.55,oz: 0.6,  rot:0,   type:"cab"  },
  ],
  P10: [
    { ox:-0.65,oz:-0.5,  rot:0,   type:"big"  },
    { ox: 0.2, oz:-0.55, rot:0,   type:"std"  },
    { ox: 0.72,oz:-0.4,  rot:0,   type:"std"  },
    { ox:-0.72,oz: 0.1,  rot:0,   type:"std"  },
    { ox: 0.0, oz: 0.1,  rot:0,   type:"wide" },
    { ox: 0.75,oz: 0.2,  rot:0.2, type:"cyl"  },
    { ox:-0.3, oz: 0.62, rot:0,   type:"std"  },
    { ox: 0.55,oz: 0.65, rot:0,   type:"big"  },
  ],
};

function ToolMesh({ spec, hl, dim, color }: { spec: EqSpec; hl: boolean; dim: boolean; color: string }) {
  const baseColor = dim ? "#d0d8e0" : hl ? "#d0e8ff" : "#b8c5d8";
  const mat = (
    <meshStandardMaterial
      color={baseColor}
      roughness={0.4} metalness={0.4}
      emissive={hl ? color : "#000"}
      emissiveIntensity={hl ? 0.35 : 0}
      transparent opacity={dim ? 0.45 : 1}
    />
  );
  const dimMat = <meshStandardMaterial color={dim ? "#c0cad4" : hl ? "#7a9ab8" : "#7a8a9a"} roughness={0.6} transparent opacity={dim ? 0.45 : 1} />;

  if (spec.type === "big") return (
    <group>
      <mesh position={[0, 0.19, 0]} castShadow>{mat}<boxGeometry args={[0.62, 0.38, 0.52]} /></mesh>
      <mesh position={[0, 0.44, 0]}>{dimMat}<cylinderGeometry args={[0.14, 0.14, 0.1, 10]} /></mesh>
      <mesh position={[0, 0.19, 0.265]}>
        <boxGeometry args={[0.22, 0.12, 0.01]} />
        <meshStandardMaterial color="#0f172a" emissive={hl ? color : "#1e40af"} emissiveIntensity={hl ? 0.5 : 0.25} />
      </mesh>
    </group>
  );

  if (spec.type === "cyl") return (
    <group>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.13, 0.65, 12]} />
        <meshStandardMaterial color={hl ? "#c0d8f0" : "#94a8bc"} roughness={0.3} metalness={0.6}
          emissive={hl ? color : "#000"} emissiveIntensity={hl ? 0.3 : 0} />
      </mesh>
      <mesh position={[0, 0.68, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 0.06, 8]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
    </group>
  );

  if (spec.type === "wide") return (
    <group>
      <mesh position={[0, 0.09, 0]} castShadow>
        <boxGeometry args={[0.88, 0.18, 0.44]} />
        {mat}
      </mesh>
      <mesh position={[0.2, 0.25, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.14, 6]} />
        <meshStandardMaterial color={hl ? "#fff" : "#64748b"} />
      </mesh>
    </group>
  );

  if (spec.type === "cab") return (
    <group>
      <mesh position={[0, 0.27, 0]} castShadow>
        <boxGeometry args={[0.18, 0.55, 0.3]} />
        <meshStandardMaterial color={hl ? "#dbeafe" : "#94a3b8"} roughness={0.5} metalness={0.2}
          emissive={hl ? color : "#000"} emissiveIntensity={hl ? 0.25 : 0} />
      </mesh>
      <mesh position={[0, 0.27, 0.152]}>
        <boxGeometry args={[0.08, 0.3, 0.01]} />
        <meshStandardMaterial color="#1e293b" emissive={hl ? color : "#334155"} emissiveIntensity={hl ? 0.5 : 0.15} />
      </mesh>
    </group>
  );

  // std
  return (
    <group>
      <mesh position={[0, 0.14, 0]} castShadow>{mat}<boxGeometry args={[0.38, 0.28, 0.32]} /></mesh>
      <mesh position={[0.1, 0.305, 0]}>
        <cylinderGeometry args={[0.024, 0.024, 0.1, 6]} />
        <meshStandardMaterial color={hl ? "#fff" : "#7a8fa8"} />
      </mesh>
      <mesh position={[0, 0.14, 0.163]}>
        <boxGeometry args={[0.18, 0.1, 0.01]} />
        <meshStandardMaterial color="#0f172a" emissive={hl ? color : "#1e40af"} emissiveIntensity={hl ? 0.45 : 0.2} />
      </mesh>
    </group>
  );
}

function ProcessZone({
  proc, position, isHL, isDimmed, onClick, matCount,
}: {
  proc: typeof PROCESSES[0]; position: [number,number,number];
  isHL: boolean; isDimmed: boolean; onClick: () => void; matCount: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    const ty = isHL ? 0.18 : 0;
    groupRef.current.position.y += (ty - groupRef.current.position.y) * 5 * dt;
  });

  const specs = ZONE_EQ[proc.code] ?? [];

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = "default"; }}
    >
      {/* Very subtle floor tint — just a thin stripe to indicate area */}
      <mesh position={[0, 0.002, 0]} receiveShadow>
        <boxGeometry args={[2.1, 0.004, 1.9]} />
        <meshStandardMaterial
          color={proc.color}
          transparent opacity={isDimmed ? 0.04 : isHL ? 0.22 : hovered ? 0.12 : 0.06}
        />
      </mesh>

      {/* Equipment */}
      {specs.map((spec, i) => (
        <group key={i} position={[spec.ox, 0, spec.oz]} rotation={[0, spec.rot, 0]}>
          <ToolMesh spec={spec} hl={isHL} dim={isDimmed} color={proc.color} />
        </group>
      ))}

      {/* Point light when highlighted */}
      {isHL && <pointLight position={[0, 3, 0]} color={proc.color} intensity={6} distance={4.5} decay={2} />}

      {/* Zone label */}
      <Text position={[0, 1.85, 0]} fontSize={0.2} color={isHL ? proc.color : hovered ? proc.color : "#334155"}
        anchorX="center" anchorY="middle" renderOrder={10}>
        {`${proc.code}  ${proc.name}`}
      </Text>
      <Text position={[0, 1.6, 0]} fontSize={0.12} color={isHL ? proc.color : "#94a3b8"}
        anchorX="center" anchorY="middle" renderOrder={10}>
        {proc.nameEn}
      </Text>

      {matCount > 0 && (
        <Text position={[0.9, 0.6, 0.82]} fontSize={0.14} color={isHL ? "#fff" : proc.color}
          anchorX="center" anchorY="middle">
          {matCount}종
        </Text>
      )}
    </group>
  );
}

function ConveyorTube({
  from, to, isConnector, isHL, isDimmed, secondary,
}: {
  from: [number,number,number]; to: [number,number,number];
  isConnector?: boolean; isHL: boolean; isDimmed: boolean; secondary?: boolean;
}) {
  const Y = secondary ? 1.8 : 0.75;
  const R = secondary ? 0.055 : 0.09;

  const curve = useMemo(() => {
    if (isConnector) {
      return new THREE.CatmullRomCurve3([
        new THREE.Vector3(from[0], Y, from[2]),
        new THREE.Vector3(from[0] + 1.7, Y, from[2] + 1.4),
        new THREE.Vector3(from[0] + 1.7, Y, to[2] - 1.4),
        new THREE.Vector3(to[0], Y, to[2]),
      ]);
    }
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(from[0], Y, from[2]),
      new THREE.Vector3((from[0]+to[0])/2, Y, (from[2]+to[2])/2),
      new THREE.Vector3(to[0], Y, to[2]),
    ]);
  }, [from, to, isConnector, Y]);

  const geo = useMemo(() => new THREE.TubeGeometry(curve, 48, R, 8, false), [curve, R]);

  return (
    <mesh geometry={geo}>
      <meshStandardMaterial
        color={secondary ? "#64748b" : isHL ? "#fb923c" : "#475569"}
        roughness={0.25} metalness={0.65}
        emissive={isHL && !secondary ? "#f97316" : "#000"}
        emissiveIntensity={isHL && !secondary ? 0.8 : 0}
        transparent opacity={isDimmed ? 0.12 : 1}
      />
    </mesh>
  );
}

// Vertical support pillar from conveyor down to floor
function ConveyorSupport({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x, 0.375, z]}>
      <cylinderGeometry args={[0.04, 0.04, 0.75, 6]} />
      <meshStandardMaterial color="#64748b" roughness={0.5} metalness={0.5} />
    </mesh>
  );
}

function Scene({
  highlightedProcesses, activeProcesses, onProcessClick, materialCounts,
}: {
  highlightedProcesses: string[]; activeProcesses: string[];
  onProcessClick?: (code: string) => void; materialCounts: Record<string, number>;
}) {
  const isHL = (c: string) => highlightedProcesses.includes(c);
  const isDimmed = (c: string) => {
    if (highlightedProcesses.length > 0) return !isHL(c);
    if (activeProcesses.length > 0) return !activeProcesses.includes(c);
    return false;
  };

  // Support pillar positions along conveyor route
  const pillars: [number, number][] = [
    [-4.5, -3.5], [-1.5, -3.5], [1.5, -3.5], [4.5, -3.5],
    [7.5, -2], [7.5, 2],
    [-4.5,  3.5], [-1.5,  3.5], [1.5,  3.5], [4.5,  3.5],
  ];

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[10, 22, 12]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-8, 10, -8]} intensity={0.3} color="#b0c4de" />

      {/* Floor */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
        <planeGeometry args={[32, 18]} />
        <meshStandardMaterial color="#d4dce8" roughness={0.92} />
      </mesh>

      {/* Subtle floor grid */}
      <gridHelper args={[32, 32, "#bcc8d8", "#c8d2e0"]} position={[0, 0.002, 0]} />

      {/* Aisle marker lines between row1 and row2 */}
      <mesh position={[0, 0.003, 0]}>
        <boxGeometry args={[28, 0.005, 1.4]} />
        <meshStandardMaterial color="#e2e8f0" transparent opacity={0.6} />
      </mesh>

      {/* Process zones */}
      {PROCESSES.map((proc) => (
        <ProcessZone
          key={proc.code}
          proc={proc}
          position={ZONE_CENTER[proc.code]}
          isHL={isHL(proc.code)}
          isDimmed={isDimmed(proc.code)}
          onClick={() => onProcessClick?.(proc.code)}
          matCount={materialCounts[proc.code] ?? 0}
        />
      ))}

      {/* Main conveyor tubes (orange, elevated at 0.75) */}
      {TUBE_SEGMENTS.map(([a, b]) => {
        const hl = isHL(a) || isHL(b);
        const dim = !hl && highlightedProcesses.length > 0;
        return (
          <ConveyorTube key={`main-${a}-${b}`}
            from={ZONE_CENTER[a]} to={ZONE_CENTER[b]}
            isConnector={a === "P05" && b === "P06"}
            isHL={hl} isDimmed={dim}
          />
        );
      })}

      {/* Secondary overhead conveyor (gray, at 1.8) */}
      {TUBE_SEGMENTS.map(([a, b]) => (
        <ConveyorTube key={`sec-${a}-${b}`}
          from={ZONE_CENTER[a]} to={ZONE_CENTER[b]}
          isConnector={a === "P05" && b === "P06"}
          isHL={false} isDimmed={highlightedProcesses.length > 0}
          secondary
        />
      ))}

      {/* Conveyor support pillars */}
      {pillars.map(([x, z], i) => <ConveyorSupport key={i} x={x} z={z} />)}

      {/* Section labels */}
      <Text position={[-3.5, 2.8, -3.5]} fontSize={0.26} color="#64748b" anchorX="center">전공정 (FEOL)</Text>
      <Text position={[ 3.5, 2.8,  3.5]} fontSize={0.26} color="#64748b" anchorX="center">후공정 (BEOL)</Text>

      <OrbitControls enablePan minDistance={5} maxDistance={32} maxPolarAngle={Math.PI / 2.1} target={[0, 0.5, 0]} />
    </>
  );
}

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
  return (
    <Canvas
      camera={{ position: [8, 14, 18], fov: 42 }}
      shadows
      style={{ background: "linear-gradient(150deg,#dce8f4 0%,#eaf0f8 100%)", borderRadius: 16 }}
    >
      <Suspense fallback={null}>
        <Scene
          highlightedProcesses={highlightedProcesses}
          activeProcesses={activeProcesses}
          onProcessClick={onProcessClick}
          materialCounts={materialCounts}
        />
      </Suspense>
    </Canvas>
  );
}
