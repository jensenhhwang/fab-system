"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Grid, Html } from "@react-three/drei";
import { Suspense, useRef } from "react";
import * as THREE from "three";
import PanCameraControls from "@/components/PanCameraControls";
import type { WarehouseCapacity } from "@/lib/queries";

// LOT/HU 실물 이동 기록이 없는 완제품 aggregate 재고는 WarehouseDetailClient의 위치 기반 3D와
// 모델이 안 맞는다(§ warehouse/[code]/page.tsx 주석) — 대신 기존 벌크가스/케미컬 탱크와 같은
// 시각 언어(원통+반구 캡, 채움 높이=점유율)로 사일로 하나를 세운다. 창고당(WH-FG01/02/03) 1개.
const PRODUCT_COLOR: Record<string, string> = { HBM: "#EA002C", DRAM: "#0078D4", NAND: "#00B96B" };

const TANK_RADIUS = 2.2;
const TANK_HEIGHT = 6;

function statusColor(pct: number) {
  return pct >= 100 ? "#EA002C" : pct >= 90 ? "#F7A600" : "#00B96B";
}

function PulsingWarningRing({ y, radius }: { y: number; radius: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (Math.sin(clock.elapsedTime * 3) + 1) / 2; // 0~1
    const material = ref.current.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = 0.4 + t * 0.6;
  });
  return (
    <mesh ref={ref} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius + 0.18, 0.06, 10, 40]} />
      <meshStandardMaterial color="#EA002C" emissive="#EA002C" emissiveIntensity={0.6} />
    </mesh>
  );
}

function Silo({ warehouse, product }: { warehouse: WarehouseCapacity; product: string | null }) {
  const pct = warehouse.utilization;
  const fillRatio = Math.min(Math.max(pct, 0), 100) / 100;
  const fillHeight = Math.max(TANK_HEIGHT * fillRatio, 0.02);
  const color = statusColor(pct);
  const productColor = (product && PRODUCT_COLOR[product]) ?? "#667482";

  return (
    <group>
      {/* 외피 — 반투명 셸 */}
      <mesh position={[0, TANK_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[TANK_RADIUS, TANK_RADIUS, TANK_HEIGHT, 32]} />
        <meshStandardMaterial color="#E7EDF2" metalness={0.5} roughness={0.35} transparent opacity={0.22} />
      </mesh>
      <mesh position={[0, TANK_HEIGHT + 0.05, 0]}>
        <sphereGeometry args={[TANK_RADIUS, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#E7EDF2" metalness={0.45} roughness={0.4} transparent opacity={0.22} />
      </mesh>

      {/* 채움 — 점유율만큼 색으로 표현. 100% 넘어도 시각적으로는 꽉 찬 상태로 고정하고 경고 링으로 대신 알린다 */}
      <mesh position={[0, fillHeight / 2, 0]}>
        <cylinderGeometry args={[TANK_RADIUS * 0.94, TANK_RADIUS * 0.94, fillHeight, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.15} roughness={0.5} />
      </mesh>

      {/* 받침대 */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[TANK_RADIUS + 0.3, TANK_RADIUS + 0.3, 0.2, 32]} />
        <meshStandardMaterial color="#667482" metalness={0.5} roughness={0.4} />
      </mesh>

      {/* 25/50/75% 눈금선 */}
      {[0.25, 0.5, 0.75].map((mark) => (
        <mesh key={mark} position={[0, TANK_HEIGHT * mark, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[TANK_RADIUS + 0.02, 0.025, 8, 40]} />
          <meshStandardMaterial color="#8C99A6" />
        </mesh>
      ))}

      {pct >= 90 && <PulsingWarningRing y={TANK_HEIGHT + 0.3} radius={TANK_RADIUS} />}

      <Html position={[0, TANK_HEIGHT + 0.9, 0]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
        <div className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-black shadow" style={{ background: color, color: "#fff" }}>
          {pct}%{pct >= 100 ? " · CAPACITY_OVER" : ""}
        </div>
      </Html>
      {product && (
        <Html position={[0, -0.35, 0]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold text-white shadow" style={{ background: productColor }}>
            {product}
          </div>
        </Html>
      )}
    </group>
  );
}

function Scene({ warehouse, product }: { warehouse: WarehouseCapacity; product: string | null }) {
  return (
    <>
      <color attach="background" args={["#EEF3F8"]} />
      <ambientLight intensity={1.4} />
      <directionalLight position={[8, 15, 10]} intensity={2.3} castShadow />
      <Environment preset="warehouse" />
      <Grid args={[20, 20]} position={[0, 0, 0]} cellSize={1} cellThickness={0.45} cellColor="#B8C2CC"
        sectionSize={3.2} sectionThickness={1.2} sectionColor="#8C99A6" fadeDistance={30} />
      <Silo warehouse={warehouse} product={product} />
      <PanCameraControls minDistance={4} maxDistance={22} maxPolarAngle={Math.PI / 2.05} />
    </>
  );
}

export default function FinishedGoodsSiloClient({ warehouse }: { warehouse: WarehouseCapacity }) {
  const product = warehouse.byCategory[0]?.category ?? null;

  return (
    <div className="grid h-[calc(100dvh-220px)] min-h-[440px] grid-cols-[65fr_35fr] gap-3">
      <section className="relative min-h-0 min-w-0 overflow-hidden rounded-2xl border border-[#E0E5EA] bg-[#EEF3F8] shadow-sm">
        <Canvas camera={{ position: [13, 8, 13], fov: 42 }} shadows dpr={[1, 1.7]}>
          <Suspense fallback={null}>
            <Scene warehouse={warehouse} product={product} />
          </Suspense>
        </Canvas>
        <div className="absolute top-3 left-3 rounded-lg bg-black/65 px-3 py-2 text-[10px] text-white/90 backdrop-blur-sm pointer-events-none">
          드래그 회전 · 휠 줌 · 채움 높이 = 점유율
        </div>
      </section>

      <aside className="rounded-2xl bg-white p-5 shadow-sm overflow-y-auto">
        <div className="text-sm font-extrabold mb-4">{warehouse.name}</div>
        <div className="space-y-3 text-[11px]">
          <div className="flex items-center justify-between border-b border-[#F0F1F3] pb-2.5">
            <span className="text-[#999]">점유율</span>
            <span className="font-bold" style={{ color: statusColor(warehouse.utilization) }}>{warehouse.utilization}%</span>
          </div>
          <div className="flex items-center justify-between border-b border-[#F0F1F3] pb-2.5">
            <span className="text-[#999]">현재 재고</span>
            <span className="font-bold text-[#222]">{warehouse.occupancy.toLocaleString("ko-KR")} {warehouse.unit}</span>
          </div>
          <div className="flex items-center justify-between border-b border-[#F0F1F3] pb-2.5">
            <span className="text-[#999]">계획 용량</span>
            <span className="font-bold text-[#222]">{warehouse.totalCapacity.toLocaleString("ko-KR")} {warehouse.unit}</span>
          </div>
          <div className="flex items-center justify-between border-b border-[#F0F1F3] pb-2.5">
            <span className="text-[#999]">제품</span>
            <span className="font-bold text-[#222]">{product ?? "—"}</span>
          </div>
        </div>
        {warehouse.utilization >= 90 && (
          <div className="mt-4 rounded-xl p-3" style={{ background: warehouse.utilization >= 100 ? "#FFF0F2" : "#FFFBEB" }}>
            <div className="text-[10px] font-extrabold" style={{ color: warehouse.utilization >= 100 ? "#EA002C" : "#B97500" }}>
              {warehouse.utilization >= 100 ? "⚠ 용량 초과 — 완료 스텝 게이팅 중" : "⚠ 90% 이상 — 곧 용량 초과"}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-[#6B5A3A]">
              박물류 판정으로 완제품 창고가 CAPACITY_OVER면 WIP 마지막 스텝(완료·적립)이 보류됩니다. 출하로 재고를 줄여야 다시 진행됩니다.
            </p>
          </div>
        )}
        <a href="/finished-goods" className="mt-5 inline-block text-[11px] font-bold text-[#0078D4] hover:underline">완제품 재고 페이지에서 자세히 보기 →</a>
      </aside>
    </div>
  );
}
