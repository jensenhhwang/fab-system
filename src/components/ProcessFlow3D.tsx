"use client";

import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, RoundedBox } from "@react-three/drei";
import * as THREE from "three";

export const PROCESSES = [
  { code: "P01", name: "산화막",    nameEn: "Oxidation",    color: "#60a5fa" },
  { code: "P02", name: "CVD",       nameEn: "CVD",           color: "#a78bfa" },
  { code: "P03", name: "포토",      nameEn: "Photo",         color: "#f472b6" },
  { code: "P04", name: "식각",      nameEn: "Etching",       color: "#fb923c" },
  { code: "P05", name: "이온주입",  nameEn: "Ion Implant",   color: "#facc15" },
  { code: "P06", name: "금속배선1", nameEn: "Metallization", color: "#34d399" },
  { code: "P07", name: "CMP",       nameEn: "CMP",           color: "#22d3ee" },
  { code: "P08", name: "TSV/배선2", nameEn: "TSV/Metal2",    color: "#f87171" },
  { code: "P09", name: "웨이퍼테스트", nameEn: "Wafer Test", color: "#a3e635" },
  { code: "P10", name: "패키징",    nameEn: "Packaging",     color: "#e879f9" },
];

// 공정 박스를 2열로 배치 (5×2 그리드)
const POSITIONS: [number, number, number][] = [
  [-6, 2.5, 0], [-2, 2.5, 0], [2, 2.5, 0], [6, 2.5, 0], [10, 2.5, 0],
  [-6,-2.5, 0], [-2,-2.5, 0], [2,-2.5, 0], [6,-2.5, 0], [10,-2.5, 0],
];

function ProcessBox({
  proc, pos, isActive, isHighlighted, onClick,
}: {
  proc: typeof PROCESSES[0];
  pos: [number, number, number];
  isActive: boolean;
  isHighlighted: boolean;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const targetY = isHighlighted ? pos[1] + 0.35 : pos[1];
    meshRef.current.position.y += (targetY - meshRef.current.position.y) * 8 * delta;
    const targetScale = isHighlighted ? 1.08 : hovered ? 1.04 : 1;
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 8 * delta);
  });

  const color = isHighlighted ? proc.color : isActive ? proc.color : "#cbd5e1";
  const emissive = isHighlighted ? proc.color : "#000000";
  const emissiveIntensity = isHighlighted ? 0.4 : 0;

  return (
    <group>
      <mesh
        ref={meshRef}
        position={pos}
        onClick={onClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <RoundedBox args={[3.2, 1.6, 0.5]} radius={0.15} smoothness={4}>
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
            metalness={0.15}
            roughness={0.45}
            transparent
            opacity={isHighlighted ? 1 : isActive ? 0.85 : 0.45}
          />
        </RoundedBox>

        {/* 공정 코드 */}
        <Text
          position={[0, 0.28, 0.28]}
          fontSize={0.28}
          color={isHighlighted || isActive ? "#ffffff" : "#94a3b8"}
          anchorX="center" anchorY="middle"
          font={undefined}
        >
          {proc.code}
        </Text>
        {/* 공정 이름 */}
        <Text
          position={[0, -0.1, 0.28]}
          fontSize={0.22}
          color={isHighlighted || isActive ? "#ffffff" : "#94a3b8"}
          anchorX="center" anchorY="middle"
        >
          {proc.name}
        </Text>
        {/* 영문 */}
        <Text
          position={[0, -0.38, 0.28]}
          fontSize={0.15}
          color={isHighlighted || isActive ? "rgba(255,255,255,0.7)" : "#cbd5e1"}
          anchorX="center" anchorY="middle"
        >
          {proc.nameEn}
        </Text>
      </mesh>
    </group>
  );
}

// 화살표 연결선
function Arrows({ highlightedCodes }: { highlightedCodes: string[] }) {
  const arrows = [
    // 상단 행 연결 (P01→P02→...→P05)
    { from: POSITIONS[0], to: POSITIONS[1] },
    { from: POSITIONS[1], to: POSITIONS[2] },
    { from: POSITIONS[2], to: POSITIONS[3] },
    { from: POSITIONS[3], to: POSITIONS[4] },
    // 상단 끝 → 하단 (P05→P10)
    { from: POSITIONS[4], to: POSITIONS[9] },
    // 하단 행 역방향 (P10←P09←...←P06)
    { from: POSITIONS[9], to: POSITIONS[8] },
    { from: POSITIONS[8], to: POSITIONS[7] },
    { from: POSITIONS[7], to: POSITIONS[6] },
    { from: POSITIONS[6], to: POSITIONS[5] },
  ];

  return (
    <>
      {arrows.map((a, i) => {
        const from = new THREE.Vector3(...a.from);
        const to   = new THREE.Vector3(...a.to);
        const mid  = from.clone().lerp(to, 0.5);
        const dir  = to.clone().sub(from).normalize();
        const len  = from.distanceTo(to);
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

        return (
          <mesh key={i} position={mid} quaternion={quat}>
            <cylinderGeometry args={[0.04, 0.04, len - 3.4, 8]} />
            <meshStandardMaterial color="#94a3b8" opacity={0.5} transparent />
          </mesh>
        );
      })}
    </>
  );
}

export default function ProcessFlow3D({
  highlightedProcesses = [],
  activeProcesses = [],
  onProcessClick,
}: {
  highlightedProcesses?: string[];
  activeProcesses?: string[];
  onProcessClick?: (code: string) => void;
}) {
  return (
    <Canvas
      camera={{ position: [2, 1, 14], fov: 45 }}
      style={{ background: "#0f172a", borderRadius: "16px" }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} />
      <pointLight position={[-5, 5, 5]} intensity={0.5} color="#a78bfa" />

      {PROCESSES.map((proc, i) => (
        <ProcessBox
          key={proc.code}
          proc={proc}
          pos={POSITIONS[i]}
          isActive={activeProcesses.includes(proc.code)}
          isHighlighted={highlightedProcesses.includes(proc.code)}
          onClick={() => onProcessClick?.(proc.code)}
        />
      ))}

      <Arrows highlightedCodes={highlightedProcesses} />

      <OrbitControls
        enablePan={false}
        minDistance={8}
        maxDistance={22}
        maxPolarAngle={Math.PI / 1.8}
      />
    </Canvas>
  );
}
