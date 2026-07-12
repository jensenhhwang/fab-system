"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { CameraControls, Edges, Environment, Grid, Html, RoundedBox } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { WarehouseCapacity } from "@/lib/queries";
import type { VirtualStorageLocation } from "@/lib/warehouse-layout";

const CATEGORY_COLOR: Record<string, string> = {
  GAS: "#C81E1E", CHM: "#2563EB", CSM: "#7C3AED", UTL: "#059669", PKG: "#64748B",
};

function LocationBox({ location, selected, dimmed, warehouseType, onSelect }: {
  location: VirtualStorageLocation;
  selected: boolean;
  dimmed: boolean;
  warehouseType: string;
  onSelect: () => void;
}) {
  const occupied = location.status !== "AVAILABLE";
  const color = occupied ? CATEGORY_COLOR[location.category ?? ""] ?? "#0078D4" : "#CBD5E1";
  const isUtilityFacility = ["BULK_GAS", "BULK_CHEM", "PRECURSOR", "ON_SITE"].includes(warehouseType);
  if (isUtilityFacility) {
    const opacity = dimmed ? 0.08 : occupied ? 0.94 : 0.16;
    const tankHeight = warehouseType === "BULK_GAS" ? 3.8 : warehouseType === "BULK_CHEM" ? 3.15 : warehouseType === "ON_SITE" ? 3.4 : 1.25;
    const radius = warehouseType === "PRECURSOR" ? 0.38 : warehouseType === "ON_SITE" ? 1.7 : 1.05;
    return (
      <group position={location.position} onClick={(event) => { event.stopPropagation(); onSelect(); }}
        onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = "default"; }}>
        <mesh position={[0, tankHeight / 2, 0]} castShadow>
          <cylinderGeometry args={[radius, radius, tankHeight, 24]} />
          <meshStandardMaterial color={warehouseType === "BULK_GAS" ? "#E7EDF2" : color} metalness={warehouseType === "BULK_GAS" ? 0.55 : 0.2}
            roughness={0.38} transparent opacity={opacity} emissive={selected ? "#FFFFFF" : "#000000"} emissiveIntensity={selected ? 0.35 : 0} />
        </mesh>
        <mesh position={[0, tankHeight + 0.12, 0]}>
          <sphereGeometry args={[radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={warehouseType === "BULK_GAS" ? "#E7EDF2" : color} metalness={0.45} roughness={0.4} transparent opacity={opacity} />
        </mesh>
        {warehouseType !== "PRECURSOR" && (
          <mesh position={[0, 0.1, 0]}>
            <cylinderGeometry args={[radius + 0.28, radius + 0.28, 0.2, 24]} />
            <meshStandardMaterial color="#667482" metalness={0.5} roughness={0.4} transparent opacity={opacity} />
          </mesh>
        )}
        {(location.status === "HOLD" || location.status === "QUARANTINE") && (
          <mesh position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius + 0.34, 0.09, 10, 30]} />
            <meshStandardMaterial color={location.status === "HOLD" ? "#FACC15" : "#F97316"}
              emissive={location.status === "HOLD" ? "#FACC15" : "#F97316"} emissiveIntensity={0.65} />
          </mesh>
        )}
        <Html position={[0, tankHeight + radius + 0.55, 0]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
          <div className={`whitespace-nowrap rounded-md px-2 py-1 text-[8px] font-bold shadow ${selected ? "bg-black text-white" : "bg-white/90 text-[#344150]"}`}>
            {location.materialName ?? "가용 위치"}{location.quantity != null ? ` · ${location.quantity.toLocaleString()} ${location.unit}` : ""}
          </div>
        </Html>
      </group>
    );
  }
  const isMro = warehouseType === "MRO";
  const isFlat = warehouseType === "FLAT";
  const isHazmat = warehouseType === "HAZMAT";
  const boxSize: [number, number, number] = isMro ? [0.78, 0.34, 0.68]
    : isFlat ? [2.05, 0.5, 1.15]
    : isHazmat ? (location.category === "GAS" ? [1.25, 0.76, 0.88] : [1.65, 0.64, 1.18])
    : [1.95, 0.48, 0.9];
  return (
    <group position={location.position}>
      <RoundedBox args={boxSize} radius={0.05} smoothness={2}
        onClick={(event) => { event.stopPropagation(); onSelect(); }}
        onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = "default"; }}>
        <meshStandardMaterial color={color} transparent opacity={dimmed ? 0.055 : occupied ? 0.94 : 0.16}
          roughness={0.55} metalness={0.05} emissive={selected ? "#FFFFFF" : "#000000"} emissiveIntensity={selected ? 0.38 : 0} />
        {(location.status === "HOLD" || location.status === "QUARANTINE") && (
          <Edges threshold={15} color={location.status === "HOLD" ? "#FACC15" : "#F97316"} lineWidth={3} />
        )}
      </RoundedBox>
      {warehouseType === "AS_RS" || isFlat ? (
        <mesh position={[0, -0.29, 0]}>
          <boxGeometry args={isFlat ? [2.25, 0.1, 1.3] : [2.15, 0.1, 1.02]} />
          <meshStandardMaterial color="#9B6B43" roughness={0.8} />
        </mesh>
      ) : isMro || isHazmat ? null : (
        <mesh position={[0, -0.39, 0]}>
          <boxGeometry args={[2.5, 0.08, 1.22]} />
          <meshStandardMaterial color="#59636F" metalness={0.55} roughness={0.35} />
        </mesh>
      )}
      {selected && (
        <Html position={[0, 0.75, 0]} center distanceFactor={9} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-lg bg-black/80 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg">
            {location.code} · {location.materialName ?? "빈 위치"}
          </div>
        </Html>
      )}
    </group>
  );
}

function UtilityFacilityStructure({ type, locations }: { type: string; locations: VirtualStorageLocation[] }) {
  if (type === "BULK_GAS") return (
    <group>
      {/* 탱크 하부에서 기화·정제 스키드로 모이는 헤더 */}
      <mesh position={[0, 0.48, -2.0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.12, 0.12, 22, 14]} /><meshStandardMaterial color="#667786" metalness={0.75} roughness={0.25} />
      </mesh>
      {locations.map((location) => (
        <mesh key={location.id} position={[location.position[0], 0.48, -1.0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 2, 10]} /><meshStandardMaterial color={CATEGORY_COLOR.GAS} metalness={0.55} />
        </mesh>
      ))}
      <group position={[0, 0.65, -3.4]}>
        <mesh><boxGeometry args={[7.2, 1.3, 1.5]} /><meshStandardMaterial color="#AAB6C0" metalness={0.35} roughness={0.4} /></mesh>
        <Html position={[0, 1.05, 0]} center style={{ pointerEvents: "none" }}><div className="whitespace-nowrap rounded bg-[#455565] px-2 py-1 text-[9px] font-bold text-white">기화기 · 정제기 · 압력조정 · CQC</div></Html>
      </group>
      <mesh position={[0, 0.08, 0]}><boxGeometry args={[23, 0.12, 7.5]} /><meshStandardMaterial color="#CDD5DC" roughness={0.9} /></mesh>
    </group>
  );
  if (type === "BULK_CHEM") return (
    <group>
      {/* 물질별 독립 방유 구획 */}
      {locations.map((location) => (
        <group key={location.id} position={[location.position[0], 0, 0]}>
          <mesh position={[0, 0.2, 0]}><boxGeometry args={[2.85, 0.4, 4.8]} /><meshStandardMaterial color="#C8D1D8" transparent opacity={0.7} /></mesh>
          <mesh position={[0, 0.43, -1.9]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.07, 0.07, 2.2, 10]} /><meshStandardMaterial color="#2563EB" /></mesh>
        </group>
      ))}
      <group position={[0, 0.7, -3.6]}>
        <mesh><boxGeometry args={[9, 1.4, 1.7]} /><meshStandardMaterial color="#8BAFA8" metalness={0.2} /></mesh>
        <Html position={[0, 1.08, 0]} center style={{ pointerEvents: "none" }}><div className="whitespace-nowrap rounded bg-[#0F766E] px-2 py-1 text-[9px] font-bold text-white">BCDS · 이중펌프 · 필터 · 누출감지</div></Html>
      </group>
      <mesh position={[0, 0.035, 2.8]}><boxGeometry args={[24, 0.07, 0.22]} /><meshStandardMaterial color="#F0B429" /></mesh>
    </group>
  );
  if (type === "PRECURSOR") return (
    <group>
      {[-3.1, 0, 3.1].map((x) => (
        <group key={x} position={[x, 1.65, 0]}>
          <mesh><boxGeometry args={[2.5, 3.3, 5]} /><meshStandardMaterial color="#DDE5EA" transparent opacity={0.48} /></mesh>
          <mesh position={[0, 0, 2.52]}><boxGeometry args={[2.25, 3.0, 0.05]} /><meshStandardMaterial color="#536475" transparent opacity={0.7} /></mesh>
        </group>
      ))}
      <group position={[0, 0.65, -3.6]}>
        <mesh><boxGeometry args={[7.2, 1.3, 1.4]} /><meshStandardMaterial color="#7C6AA8" /></mesh>
        <Html position={[0, 1.0, 0]} center style={{ pointerEvents: "none" }}><div className="whitespace-nowrap rounded bg-[#6D28D9] px-2 py-1 text-[9px] font-bold text-white">항온제어 · Carrier Gas · 기화 공급 Skid</div></Html>
      </group>
    </group>
  );
  if (type === "ON_SITE") return (
    <group>
      <mesh position={[-4.5, 1.1, 0]}><boxGeometry args={[4.4, 2.2, 4.2]} /><meshStandardMaterial color="#BDD9E8" /></mesh>
      <Html position={[-4.5, 2.6, 0]} center style={{ pointerEvents: "none" }}><div className="rounded bg-[#0078D4] px-2 py-1 text-[9px] font-bold text-white">RO · EDI · UV · Polisher</div></Html>
      <mesh position={[4.3, 0.65, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[3.0, 0.12, 12, 48]} /><meshStandardMaterial color="#059669" metalness={0.4} /></mesh>
      <Html position={[4.3, 4.3, 0]} center style={{ pointerEvents: "none" }}><div className="rounded bg-[#05845E] px-2 py-1 text-[9px] font-bold text-white">UPW 순환 Loop · 상시 수질감시</div></Html>
    </group>
  );
  return null;
}

function HazmatWarehouseStructure({ locations }: { locations: VirtualStorageLocation[] }) {
  const zones = [...new Set(locations.map((item) => item.zone))];
  const zoneColors = ["#8B1E3F", "#C2410C", "#4F46E5", "#B91C1C", "#0F766E", "#7C3AED"];

  return (
    <group>
      {zones.map((zone, index) => {
        const sample = locations.find((item) => item.zone === zone);
        if (!sample) return null;
        const x = sample.position[0];
        const color = zoneColors[index];
        return (
          <group key={zone} position={[x, 0, 0]}>
            {/* 방화 구획과 내약품 바닥 */}
            <mesh position={[0, 0.03, 0]}>
              <boxGeometry args={[3.85, 0.06, 8]} />
              <meshStandardMaterial color={index < 3 ? "#D7DEE5" : "#D8E6E3"} roughness={0.85} />
            </mesh>
            <mesh position={[0, 1.75, -4]}>
              <boxGeometry args={[3.95, 3.5, 0.12]} />
              <meshStandardMaterial color="#D9E0E6" roughness={0.8} />
            </mesh>
            {[-1.95, 1.95].map((wallX) => (
              <mesh key={wallX} position={[wallX, 1.75, 0]}>
                <boxGeometry args={[0.12, 3.5, 8]} />
                <meshStandardMaterial color="#C7D0D8" transparent opacity={0.6} />
              </mesh>
            ))}
            {/* 방유턱/트렌치 */}
            <mesh position={[0, 0.09, 3.75]}>
              <boxGeometry args={[3.55, 0.15, 0.18]} />
              <meshStandardMaterial color={color} />
            </mesh>
            {/* 감지기와 경광등 */}
            <mesh position={[1.45, 3.0, -3.65]}>
              <sphereGeometry args={[0.13, 16, 12]} />
              <meshStandardMaterial color="#EA002C" emissive="#EA002C" emissiveIntensity={0.7} />
            </mesh>
            <Html position={[0, 3.2, -3.75]} center style={{ pointerEvents: "none" }}>
              <div className="w-28 rounded-md px-2 py-1 text-center text-[8px] font-bold text-white shadow" style={{ background: color }}>{zone}</div>
            </Html>
          </group>
        );
      })}

      {/* 공통 강제배기 헤더와 분기 덕트 */}
      <mesh position={[0, 4.15, -3.6]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.22, 0.22, 25.5, 16]} />
        <meshStandardMaterial color="#8B98A5" metalness={0.65} roughness={0.3} />
      </mesh>
      {zones.map((zone) => {
        const sample = locations.find((item) => item.zone === zone);
        if (!sample) return null;
        return (
          <mesh key={`duct-${zone}`} position={[sample.position[0], 3.65, -3.6]}>
            <cylinderGeometry args={[0.12, 0.12, 1, 12]} />
            <meshStandardMaterial color="#98A5B1" metalness={0.6} roughness={0.3} />
          </mesh>
        );
      })}

      {/* 비상 샤워·세안기 */}
      <group position={[13.4, 0, 4.7]}>
        <mesh position={[0, 1.25, 0]}><cylinderGeometry args={[0.07, 0.07, 2.5, 10]} /><meshStandardMaterial color="#12A150" /></mesh>
        <mesh position={[0, 2.48, 0]}><cylinderGeometry args={[0.42, 0.2, 0.18, 16]} /><meshStandardMaterial color="#12A150" /></mesh>
        <mesh position={[0, 0.85, 0.25]}><cylinderGeometry args={[0.25, 0.18, 0.12, 16]} /><meshStandardMaterial color="#DDE5EA" /></mesh>
        <Html position={[0, 2.9, 0]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-[#0B8F45] px-2 py-1 text-[8px] font-bold text-white">비상 샤워·세안기</div>
        </Html>
      </group>

      {/* 저장창고와 공급설비 사이 출고·검사 스테이징 */}
      <group position={[0, 0.22, 5.0]}>
        <mesh><boxGeometry args={[9.4, 0.14, 1.1]} /><meshStandardMaterial color="#F1C84B" roughness={0.8} /></mesh>
        <Html position={[0, 0.65, 0]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-[#8A6200] px-2 py-1 text-[8px] font-bold text-white">출고검사 · 누출확인 · 전용카트 인계</div>
        </Html>
      </group>

      {/* 보관용 WH-C와 분리된 실제 공급실 */}
      <group position={[-5.3, 1.35, 7.25]}>
        <mesh><boxGeometry args={[7.8, 2.7, 2.8]} /><meshStandardMaterial color="#DCE6ED" transparent opacity={0.55} /></mesh>
        {[-2.25, 0, 2.25].map((x) => (
          <group key={x} position={[x, -0.25, 0]}>
            <mesh><boxGeometry args={[1.55, 1.8, 1.25]} /><meshStandardMaterial color="#687786" metalness={0.45} roughness={0.4} /></mesh>
            <mesh position={[0, 0, 0.64]}><boxGeometry args={[1.25, 1.5, 0.03]} /><meshStandardMaterial color="#263746" /></mesh>
            <mesh position={[0.43, 0.48, 0.67]}><sphereGeometry args={[0.08, 12, 10]} /><meshStandardMaterial color="#00C878" emissive="#00C878" emissiveIntensity={0.6} /></mesh>
          </group>
        ))}
        <Html position={[0, 1.75, 0]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-[#8B1E3F] px-2.5 py-1 text-[9px] font-bold text-white">GAS SUPPLY ROOM · 캐비닛/자동전환/퍼지</div>
        </Html>
      </group>

      <group position={[5.3, 1.35, 7.25]}>
        <mesh><boxGeometry args={[7.8, 2.7, 2.8]} /><meshStandardMaterial color="#DFF0EC" transparent opacity={0.55} /></mesh>
        {[-2.2, 0, 2.2].map((x) => (
          <group key={x} position={[x, -0.35, 0]}>
            <mesh><cylinderGeometry args={[0.62, 0.62, 1.55, 20]} /><meshStandardMaterial color="#287B70" metalness={0.25} roughness={0.5} /></mesh>
            <mesh position={[0, 0.87, 0]}><cylinderGeometry args={[0.18, 0.18, 0.2, 12]} /><meshStandardMaterial color="#B9C5CC" metalness={0.7} /></mesh>
          </group>
        ))}
        <Html position={[0, 1.75, 0]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-[#0F766E] px-2.5 py-1 text-[9px] font-bold text-white">CHEMICAL SUPPLY ROOM · 펌프/필터/이중배관</div>
        </Html>
      </group>

      {/* 생산 배관은 창고가 아니라 공급실에서 시작 */}
      {[-6.1, -5.3, -4.5].map((x, index) => (
        <mesh key={`gas-line-${x}`} position={[x, 2.15 + index * 0.16, 10.2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 4.0, 10]} />
          <meshStandardMaterial color={["#E24A4A", "#8B5CF6", "#F59E0B"][index]} metalness={0.45} />
        </mesh>
      ))}
      {[4.6, 5.3, 6.0].map((x, index) => (
        <mesh key={`chem-line-${x}`} position={[x, 1.7 + index * 0.16, 10.2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.075, 0.075, 4.0, 10]} />
          <meshStandardMaterial color={["#2563EB", "#0D9488", "#7C3AED"][index]} metalness={0.35} />
        </mesh>
      ))}
      <Html position={[0, 3.0, 11.5]} center style={{ pointerEvents: "none" }}>
        <div className="whitespace-nowrap rounded bg-black/70 px-2 py-1 text-[8px] font-bold text-white">VMB/VMP → FAB 공정 장비</div>
      </Html>
    </group>
  );
}

function FlatWarehouseStructure({ locations }: { locations: VirtualStorageLocation[] }) {
  const aisles = [...new Set(locations.map((item) => item.aisle))];
  const bays = [...new Set(locations.map((item) => item.bay))];
  const maxLevel = Math.max(...locations.map((item) => item.level));
  const height = maxLevel * 0.88 + 0.75;

  return (
    <group>
      {aisles.flatMap((aisle) => bays.map((bay) => {
        const slot = locations.find((item) => item.aisle === aisle && item.bay === bay);
        if (!slot) return null;
        const [x, , z] = slot.position;
        return (
          <group key={`flat-rack-${aisle}-${bay}`} position={[x, 0, z]}>
            {[-1.2, 1.2].flatMap((px) => [-0.72, 0.72].map((pz) => (
              <mesh key={`${px}-${pz}`} position={[px, height / 2, pz]}>
                <boxGeometry args={[0.1, height, 0.1]} />
                <meshStandardMaterial color="#31506B" metalness={0.55} roughness={0.35} />
              </mesh>
            )))}
            {Array.from({ length: maxLevel }, (_, level) => (
              <group key={level} position={[0, (level + 1) * 0.88 - 0.34, 0]}>
                {[-0.72, 0.72].map((pz) => (
                  <mesh key={pz} position={[0, 0, pz]}>
                    <boxGeometry args={[2.5, 0.1, 0.1]} />
                    <meshStandardMaterial color="#EF9B1A" metalness={0.35} roughness={0.4} />
                  </mesh>
                ))}
              </group>
            ))}
          </group>
        );
      }))}
      {/* 지게차가 회전할 수 있는 주통로 */}
      <mesh position={[0, 0.015, 5.7]}>
        <boxGeometry args={[17, 0.03, 1.8]} />
        <meshStandardMaterial color="#D8DEE4" roughness={0.9} />
      </mesh>
      {[-8.1, 8.1].map((x) => (
        <mesh key={x} position={[x, 0.035, 0]}>
          <boxGeometry args={[0.12, 0.04, 11]} />
          <meshStandardMaterial color="#F6C800" />
        </mesh>
      ))}
      <group position={[-6.6, 0.35, 6.1]}>
        <mesh><boxGeometry args={[3.2, 0.7, 1.4]} /><meshStandardMaterial color="#8D99A5" /></mesh>
        <Html position={[0, 0.8, 0]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-[#31506B] px-2 py-1 text-[9px] font-bold text-white">입고 검수·스테이징</div>
        </Html>
      </group>
      <group position={[6.6, 0.55, 6.1]}>
        <mesh><boxGeometry args={[3.2, 1.1, 1.4]} /><meshStandardMaterial color="#C7E8F7" transparent opacity={0.65} /></mesh>
        <Html position={[0, 0.9, 0]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-[#0078D4] px-2 py-1 text-[9px] font-bold text-white">항온 보관 Zone</div>
        </Html>
      </group>
    </group>
  );
}

function MROWarehouseStructure({ locations }: { locations: VirtualStorageLocation[] }) {
  const aisles = [...new Set(locations.map((item) => item.aisle))];
  const bays = [...new Set(locations.map((item) => item.bay))];
  const maxLevel = Math.max(...locations.map((item) => item.level));
  const height = maxLevel * 0.58 + 0.5;

  return (
    <group>
      {aisles.flatMap((aisle) => bays.map((bay) => {
        const slot = locations.find((item) => item.aisle === aisle && item.bay === bay);
        if (!slot) return null;
        const [x, , z] = slot.position;
        const secured = aisle === 3;
        return (
          <group key={`cabinet-${aisle}-${bay}`} position={[x, height / 2, z]}>
            <mesh>
              <boxGeometry args={[1.25, height, 0.82]} />
              <meshStandardMaterial color={secured ? "#34495E" : "#E8EDF1"} metalness={0.25} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0, 0.43]}>
              <boxGeometry args={[1.15, height - 0.12, 0.04]} />
              <meshStandardMaterial color={secured ? "#52697D" : "#C8D1D9"} />
            </mesh>
            {Array.from({ length: maxLevel }, (_, level) => (
              <mesh key={level} position={[0, -height / 2 + (level + 1) * 0.58 - 0.28, 0.47]}>
                <boxGeometry args={[1.08, 0.04, 0.05]} />
                <meshStandardMaterial color="#7B8792" />
              </mesh>
            ))}
          </group>
        );
      }))}
      {/* 작업·검사 벤치 */}
      <group position={[0, 0.72, 4.6]}>
        <mesh><boxGeometry args={[5.2, 0.18, 1.4]} /><meshStandardMaterial color="#5D6873" /></mesh>
        {[-2.3, 2.3].flatMap((x) => [-0.55, 0.55].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, -0.55, z]}><boxGeometry args={[0.12, 1.1, 0.12]} /><meshStandardMaterial color="#3F4851" /></mesh>
        )))}
        <Html position={[0, 0.55, 0]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-[#6D28D9] px-2 py-1 text-[9px] font-bold text-white">검사·수리·Hold 작업대</div>
        </Html>
      </group>
      {/* 보행 통로 */}
      {[-3.52, -1.17, 1.17, 3.52].map((x) => (
        <mesh key={x} position={[x, 0.018, 0]}>
          <boxGeometry args={[0.06, 0.035, 7.5]} />
          <meshStandardMaterial color="#35B36B" />
        </mesh>
      ))}
    </group>
  );
}

function ASRSStructure({ locations }: { locations: VirtualStorageLocation[] }) {
  const aisles = [...new Set(locations.map((item) => item.aisle))];
  const bays = [...new Set(locations.map((item) => item.bay))];
  const maxLevel = Math.max(...locations.map((item) => item.level));
  const rackHeight = maxLevel * 0.85 + 0.85;

  return (
    <group>
      {/* 고층 랙 프레임: 팔레트와 분리해 실제 AS/RS 골조로 표현 */}
      {aisles.flatMap((aisle) => bays.map((bay) => {
        const slot = locations.find((item) => item.aisle === aisle && item.bay === bay);
        if (!slot) return null;
        const [x, , z] = slot.position;
        return (
          <group key={`rack-${aisle}-${bay}`} position={[x, 0, z]}>
            {[-1.15, 1.15].flatMap((px) => [-0.56, 0.56].map((pz) => (
              <mesh key={`${px}-${pz}`} position={[px, rackHeight / 2, pz]} castShadow>
                <boxGeometry args={[0.08, rackHeight, 0.08]} />
                <meshStandardMaterial color="#526171" metalness={0.65} roughness={0.3} />
              </mesh>
            )))}
            {Array.from({ length: maxLevel }, (_, index) => (
              <group key={index} position={[0, (index + 1) * 0.85 - 0.38, 0]}>
                {[-0.56, 0.56].map((pz) => (
                  <mesh key={pz} position={[0, 0, pz]}>
                    <boxGeometry args={[2.38, 0.09, 0.08]} />
                    <meshStandardMaterial color="#F2A000" metalness={0.35} roughness={0.45} />
                  </mesh>
                ))}
              </group>
            ))}
          </group>
        );
      }))}

      {/* 중앙 스태커 크레인 */}
      <group position={[0, 0, -0.7]}>
        <mesh position={[0, rackHeight / 2, 0]} castShadow>
          <boxGeometry args={[0.18, rackHeight, 0.2]} />
          <meshStandardMaterial color="#E5A000" metalness={0.55} roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.8, 0]} castShadow>
          <boxGeometry args={[1.25, 0.15, 1.05]} />
          <meshStandardMaterial color="#FFC928" metalness={0.4} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.08, 0]}>
          <boxGeometry args={[1.6, 0.15, 1.1]} />
          <meshStandardMaterial color="#344150" metalness={0.7} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.025, 0]}>
          <boxGeometry args={[0.12, 0.05, 10.8]} />
          <meshStandardMaterial color="#667482" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>

      {/* 입출고 컨베이어와 I/O 스테이션 */}
      <group position={[0, 0.42, 5.25]}>
        <mesh>
          <boxGeometry args={[2.3, 0.18, 2.1]} />
          <meshStandardMaterial color="#384553" metalness={0.55} roughness={0.35} />
        </mesh>
        {[-0.75, -0.25, 0.25, 0.75].map((z) => (
          <mesh key={z} position={[0, 0.13, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.08, 0.08, 2, 12]} />
            <meshStandardMaterial color="#AAB4BE" metalness={0.7} roughness={0.25} />
          </mesh>
        ))}
        <Html position={[0, 1.05, 0]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-md bg-[#0078D4] px-2 py-1 text-[9px] font-bold text-white shadow">I/O STATION · 입출고</div>
        </Html>
      </group>

      {/* 안전 통로 */}
      <mesh position={[0, 0.012, 3.75]}>
        <boxGeometry args={[13.5, 0.025, 0.12]} />
        <meshStandardMaterial color="#F6C800" />
      </mesh>
    </group>
  );
}

function CameraFocus({ selected, controls, warehouseType }: {
  selected: VirtualStorageLocation | null;
  controls: React.RefObject<CameraControls | null>;
  warehouseType: string;
}) {
  useEffect(() => {
    if (!controls.current) return;
    if (selected) {
      const [x, y, z] = selected.position;
      controls.current.setLookAt(x + 5.5, y + 3.5, z + 5.5, x, y, z, true);
    } else {
      const overview: Record<string, [number, number, number, number]> = {
        AS_RS: [11, 9, 13, 2.1], FLAT: [17, 12, 19, 1.8],
        MRO: [10, 7, 12, 1.4], HAZMAT: [22, 15, 25, 1.7],
        BULK_GAS: [18, 12, 22, 1.8], BULK_CHEM: [20, 13, 24, 1.5],
        PRECURSOR: [12, 9, 15, 1.4], ON_SITE: [13, 9, 16, 1.5],
      };
      const [x, y, z, targetY] = overview[warehouseType] ?? overview.AS_RS;
      controls.current.setLookAt(x, y, z, 0, targetY, 0, true);
    }
  }, [selected, controls, warehouseType]);
  return null;
}

function Scene({ locations, selectedId, visibleIds, warehouseType, onSelect }: {
  locations: VirtualStorageLocation[];
  selectedId: string | null;
  visibleIds: Set<string>;
  warehouseType: string;
  onSelect: (id: string) => void;
}) {
  const controls = useRef<CameraControls>(null);
  const { gl } = useThree();
  const selected = locations.find((item) => item.id === selectedId) ?? null;
  useEffect(() => () => { gl.domElement.style.cursor = "default"; }, [gl]);

  return (
    <>
      <color attach="background" args={["#EEF3F8"]} />
      <ambientLight intensity={1.4} />
      <directionalLight position={[8, 15, 10]} intensity={2.3} castShadow />
      <Environment preset="warehouse" />
      <Grid args={[28, 22]} position={[0, 0, 0]} cellSize={1} cellThickness={0.45} cellColor="#B8C2CC"
        sectionSize={3.2} sectionThickness={1.2} sectionColor="#8C99A6" fadeDistance={35} />
      {warehouseType === "AS_RS" && <ASRSStructure locations={locations} />}
      {warehouseType === "FLAT" && <FlatWarehouseStructure locations={locations} />}
      {warehouseType === "MRO" && <MROWarehouseStructure locations={locations} />}
      {warehouseType === "HAZMAT" && <HazmatWarehouseStructure locations={locations} />}
      <UtilityFacilityStructure type={warehouseType} locations={locations} />
      {locations.map((location) => (
        <LocationBox key={location.id} location={location} selected={location.id === selectedId}
          dimmed={!visibleIds.has(location.id)} warehouseType={warehouseType}
          onSelect={() => onSelect(location.id)} />
      ))}
      <CameraControls ref={controls} minDistance={3} maxDistance={36} maxPolarAngle={Math.PI / 2.05} />
      <CameraFocus selected={selected} controls={controls} warehouseType={warehouseType} />
    </>
  );
}

function statusLabel(status: VirtualStorageLocation["status"]) {
  if (status === "HOLD") return "Hold · 출고/사용 금지";
  if (status === "QUARANTINE") return "Quarantine · 물리 격리";
  if (status === "OCCUPIED") return "사용 중";
  return "가용";
}

export default function WarehouseDetailClient({ warehouse, locations }: {
  warehouse: WarehouseCapacity;
  locations: VirtualStorageLocation[];
}) {
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const zones = useMemo(() => [...new Set(locations.map((item) => item.zone))], [locations]);
  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(() => locations.filter((item) => {
    const zoneMatch = zone === "ALL" || item.zone === zone;
    const queryMatch = !normalized || `${item.code} ${item.materialCode ?? ""} ${item.materialName ?? ""}`.toLowerCase().includes(normalized);
    return zoneMatch && queryMatch;
  }), [locations, zone, normalized]);
  const visibleIds = useMemo(() => new Set(filtered.map((item) => item.id)), [filtered]);
  const selected = locations.find((item) => item.id === selectedId) ?? null;
  const occupied = locations.filter((item) => item.status !== "AVAILABLE").length;
  const available = locations.filter((item) => item.status === "AVAILABLE").length;
  const hold = locations.filter((item) => item.status === "HOLD" || item.status === "QUARANTINE").length;

  const selectLocation = (id: string) => setSelectedId(id);
  const selectFromList = (id: string) => {
    setSelectedId(id);
    const item = locations.find((location) => location.id === id);
    if (item) setZone(item.zone);
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="grid grid-cols-4 gap-3 mb-3 shrink-0">
        {[
          ["현재 점유율", `${warehouse.utilization}%`, "#0078D4"],
          ["사용 위치", `${occupied} slot`, "#6D28D9"],
          ["가용 위치", `${available} slot`, "#00A96B"],
          ["출고 제한·격리", `${hold} slot`, hold ? "#D97706" : "#777"],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-xl bg-white px-4 py-2.5 shadow-sm border border-[#EDF0F3]">
            <div className="text-[10px] font-semibold text-[#999]">{label}</div>
            <div className="text-lg font-black" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[210px_minmax(0,1fr)_250px] gap-3">
        <aside className="bg-white rounded-2xl shadow-sm p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="text-xs font-extrabold mb-3">위치·자재 찾기</div>
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="자재명, 코드, 위치 검색"
            className="w-full rounded-lg border border-[#DDE2E8] bg-[#FAFBFC] px-3 py-2 text-[11px] outline-none focus:border-[#0078D4]" />
          <div className="text-[10px] font-bold text-[#999] mt-5 mb-2">보관 Zone</div>
          <div className="space-y-1">
            {["ALL", ...zones].map((item) => (
              <button key={item} onClick={() => setZone(item)}
                className={`w-full rounded-lg px-3 py-2 text-left text-[11px] font-semibold transition-colors ${zone === item ? "bg-[#EAF4FF] text-[#0078D4]" : "text-[#666] hover:bg-[#F5F7FA]"}`}>
                {item === "ALL" ? "전체 Zone" : item}
              </button>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-[#EEF0F2] flex-1 min-h-0 overflow-y-auto">
            <div className="flex justify-between mb-2 text-[10px] font-bold text-[#999]"><span>검색 결과</span><span>{filtered.length}</span></div>
            <div className="space-y-1.5">
              {filtered.filter((item) => item.status !== "AVAILABLE").map((item) => (
                <button key={item.id} onClick={() => selectFromList(item.id)}
                  className={`w-full rounded-lg border p-2.5 text-left ${selectedId === item.id ? "border-[#0078D4] bg-[#F2F8FF]" : "border-[#EDF0F3] hover:border-[#B9D8F3]"}`}>
                  <div className="text-[9px] font-mono text-[#999]">{item.code}</div>
                  <div className="text-[11px] font-bold text-[#222] truncate">{item.materialName}</div>
                  <div className="text-[9px] text-[#888] mt-0.5">{item.quantity?.toLocaleString()} {item.unit}</div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="relative min-h-0 min-w-0 overflow-hidden rounded-2xl border border-[#E0E5EA] bg-[#EEF3F8] shadow-sm">
          <Canvas camera={{ position: [11, 9, 13], fov: 46 }} shadows dpr={[1, 1.7]}>
            <Suspense fallback={null}>
              <Scene locations={locations} selectedId={selectedId} visibleIds={visibleIds}
                warehouseType={warehouse.type} onSelect={selectLocation} />
            </Suspense>
          </Canvas>
          <div className="absolute top-3 left-3 rounded-lg bg-black/65 px-3 py-2 text-[10px] text-white/90 backdrop-blur-sm pointer-events-none">
            위치 클릭 · 드래그 회전 · 휠 줌
          </div>
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/92 px-3 py-2 text-[9px] font-semibold text-[#555] backdrop-blur-sm pointer-events-none">
            <span className="font-extrabold text-[#333]">자재 구분</span>
            {Object.entries(CATEGORY_COLOR).map(([category, color]) => (
              <span key={category} className="inline-flex items-center gap-1">
                <i className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />{category}
              </span>
            ))}
            <span className="mx-0.5 h-3 w-px bg-[#D8DDE3]" />
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-[#CBD5E1]" />빈 위치</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-3 rounded border-2 border-[#FACC15] bg-transparent" />노란 테두리 = Hold(출고금지)</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-3 rounded border-2 border-[#F97316] bg-transparent" />주황 테두리 = 물리 격리</span>
            <span className="text-[#999]">옅은 표시 = 현재 필터 제외</span>
          </div>
        </section>

        <aside className="bg-white rounded-2xl shadow-sm p-4 min-h-0 overflow-y-auto">
          <div className="text-xs font-extrabold mb-4">선택 위치 상세</div>
          {selected ? (
            <div>
              <div className="rounded-xl bg-[#F5F8FB] p-4 mb-4">
                <div className="font-mono text-lg font-black text-[#0078D4]">{selected.code}</div>
                <div className="text-[10px] text-[#777] mt-1">{selected.zone} · Aisle {selected.aisle} / Bay {selected.bay} / Level {selected.level}</div>
              </div>
              <div className="space-y-3 text-[11px]">
                <Detail label="상태" value={statusLabel(selected.status)} accent={selected.status === "HOLD" || selected.status === "QUARANTINE"} />
                <Detail label="자재 코드" value={selected.materialCode ?? "—"} />
                <Detail label="자재명" value={selected.materialName ?? "빈 위치"} />
                <Detail label="카테고리" value={selected.category ?? "—"} />
                {selected.hazard && <Detail label="위험 특성" value={selected.hazard} accent />}
                {selected.supplyLabel && <Detail label="공급 방식" value={selected.supplyLabel} />}
                {selected.targetFacility && <Detail label="목적 공급시설" value={selected.targetFacility} accent={selected.relocationRequired} />}
                <Detail label="보관 수량" value={selected.quantity != null ? `${selected.quantity.toLocaleString()} ${selected.unit}` : "—"} />
                <Detail label="보관일수" value={selected.doh != null ? `${selected.doh.toFixed(1)}일` : "—"} />
              </div>
              {selected.rationale && (
                <div className="mt-4 rounded-xl bg-[#FFF8E7] p-3">
                  <div className="text-[10px] font-extrabold text-[#A86500] mb-1.5">이 위치에 배치한 이유</div>
                  <p className="text-[10px] leading-relaxed text-[#6B5A3A]">{selected.rationale}</p>
                  {selected.controls && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {selected.controls.map((control) => <span key={control} className="rounded bg-white/80 px-1.5 py-0.5 text-[8px] font-semibold text-[#8A6A24]">{control}</span>)}
                    </div>
                  )}
                </div>
              )}
              {selected.supplyFlow && (
                <div className={`mt-3 rounded-xl p-3 ${selected.relocationRequired ? "bg-[#FFF0F2]" : "bg-[#EEF7FF]"}`}>
                  <div className={`text-[10px] font-extrabold mb-1.5 ${selected.relocationRequired ? "text-[#C4142C]" : "text-[#0069B4]"}`}>
                    {selected.relocationRequired ? "⚠ 현재 C동 재고에서 이관 대상" : "실제 공급 흐름"}
                  </div>
                  <p className="text-[9px] leading-relaxed text-[#52606D]">{selected.supplyFlow}</p>
                </div>
              )}
              <div className="mt-5 rounded-xl border border-dashed border-[#C9D2DC] p-3 text-[9px] leading-relaxed text-[#888]">
                현재 위치는 기존 재고로 생성한 시뮬레이션 값입니다. 다음 데이터 단계에서 실제 Zone·랙·로트 컬렉션으로 교체됩니다.
              </div>
            </div>
          ) : <div className="text-[11px] text-[#999]">3D에서 위치를 선택하세요.</div>}
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#F0F1F3] pb-2.5">
      <span className="text-[#999] flex-shrink-0">{label}</span>
      <span className={`font-bold text-right ${accent ? "text-[#D97706]" : "text-[#222]"}`}>{value}</span>
    </div>
  );
}
