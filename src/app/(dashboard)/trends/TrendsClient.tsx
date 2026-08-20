"use client";

import { useCallback, useEffect, useState } from "react";
import LineChart from "./charts/LineChart";
import BarChart from "./charts/BarChart";
import Sparkline from "./charts/Sparkline";
import { PRODUCT_COLOR, STATUS_COLOR, SINGLE_SERIES_COLOR } from "./charts/palette";
import { policyChangePoints } from "./chart-scale";
import type { Product } from "@/lib/db";

type Snapshot = {
  operatingDay: number;
  wallDayKey: string;
  recordedAt: string;
  production: { product: Product; producedQty: number; designDailyQty: number; ratePct: number }[];
  materials: {
    stockoutCount: number;
    criticalCount: number;
    medianDoh: number;
    worst: { materialCode: string; doh: number }[];
  };
  warehouses: { code: string; utilization: number; baselineUtilization: number }[];
  shipments: { product: Product; shippedQty: number; contractDailyQty: number; fulfillmentPct: number }[];
  policy: { r1: number; r2: number; r3: number; r4: number };
  engine: { ticks: number; elapsedOperatingMs: number; clampedCatchUps: number };
};

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];
const RANGES = [7, 30, 90];

export default function TrendsClient() {
  const [axis, setAxis] = useState<"operating" | "wall">("operating");
  const [days, setDays] = useState(30);
  const [points, setPoints] = useState<Snapshot[]>([]);
  const [showTable, setShowTable] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/twin/trends?axis=${axis}&days=${days}`, { cache: "no-store" });
    const json = await res.json();
    setPoints(Array.isArray(json.points) ? json.points : []);
    setLoading(false);
  }, [axis, days]);

  useEffect(() => { void load(); }, [load]);

  const xLabels = points.map((p) => (axis === "operating" ? `${p.operatingDay}일차` : p.wallDayKey.slice(5)));

  const productSeries = (pick: (s: Snapshot, product: Product) => number | null) =>
    PRODUCTS.map((product) => ({
      key: product,
      label: product,
      color: PRODUCT_COLOR[product],
      points: points.map((s) => pick(s, product)),
    }));

  const warehouseCodes = [...new Set(points.flatMap((p) => p.warehouses.map((w) => w.code)))].sort();
  const markers = policyChangePoints(points);
  // 엔진이 catch-up 상한에 걸린 날 = 그 앞에 정지 구간이 있었다는 증거.
  const gapBands: [number, number][] = points
    .map((s, i) => (s.engine.clampedCatchUps > 0 && i > 0 ? ([i - 1, i] as [number, number]) : null))
    .filter((v): v is [number, number] => v !== null);

  if (loading) return <div className="text-sm text-[#999]">불러오는 중…</div>;

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border bg-white px-5 py-8 text-center text-sm text-[#666]">
        아직 스냅샷이 없다. 엔진이 운영일 경계를 한 번 넘으면 첫 점이 찍힌다 — 24배속에서 실제 1시간이다.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border">
          {(["operating", "wall"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAxis(a)}
              className={`px-3 py-1.5 text-xs font-bold ${axis === a ? "bg-[#141413] text-white" : "bg-white text-[#666]"}`}
            >
              {a === "operating" ? "운영일" : "벽시계일"}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-lg border">
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs font-bold ${days === d ? "bg-[#141413] text-white" : "bg-white text-[#666]"}`}
            >
              {d}일
            </button>
          ))}
        </div>
        <button onClick={() => setShowTable((v) => !v)} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-[#666]">
          {showTable ? "차트 보기" : "표 보기"}
        </button>
        {markers.length > 0 && (
          <span className="text-[10px] font-bold text-[#7C3AED]">┆ 정책 변경 {markers.length}회</span>
        )}
      </div>

      {showTable ? (
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full text-xs">
            <thead className="bg-[#F5F5F5] text-[10px] font-bold text-[#666]">
              <tr>
                <th className="px-3 py-2 text-left">축</th>
                <th className="px-3 py-2">결품</th>
                <th className="px-3 py-2">중앙DOH</th>
                {PRODUCTS.map((p) => <th key={`prod-${p}`} className="px-3 py-2">{p} 산출률</th>)}
                {PRODUCTS.map((p) => <th key={`ship-${p}`} className="px-3 py-2">{p} 이행률</th>)}
              </tr>
            </thead>
            <tbody>
              {points.map((s) => (
                <tr key={s.operatingDay} className="border-t">
                  <td className="px-3 py-1.5 font-bold">{axis === "operating" ? `${s.operatingDay}일차` : s.wallDayKey}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{s.materials.stockoutCount}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{s.materials.medianDoh.toFixed(1)}</td>
                  {PRODUCTS.map((p) => (
                    <td key={`prod-${p}`} className="px-3 py-1.5 text-center tabular-nums">
                      {s.production.find((x) => x.product === p)?.ratePct ?? "—"}
                    </td>
                  ))}
                  {PRODUCTS.map((p) => (
                    <td key={`ship-${p}`} className="px-3 py-1.5 text-center tabular-nums">
                      {s.shipments.find((x) => x.product === p)?.fulfillmentPct ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border bg-white p-4">
            <h2 className="mb-2 text-sm font-bold">생산 — 설계 대비 실산출률</h2>
            <LineChart
              xLabels={xLabels}
              referencePct={100}
              unit="%"
              markers={markers}
              gapBands={axis === "wall" ? gapBands : []}
              series={productSeries((s, p) => s.production.find((x) => x.product === p)?.ratePct ?? null)}
            />
          </section>

          <section className="rounded-2xl border bg-white p-4">
            <h2 className="mb-2 text-sm font-bold">자재 — 결품 종수</h2>
            <BarChart
              xLabels={xLabels}
              label="재고 0 자재"
              color={STATUS_COLOR.critical}
              values={points.map((s) => s.materials.stockoutCount)}
            />
            <h2 className="mb-2 mt-4 text-sm font-bold">자재 — 커버리지 중앙값</h2>
            <LineChart
              xLabels={xLabels}
              unit="일"
              markers={markers}
              series={[{
                key: "medianDoh",
                label: "중앙 DOH",
                color: SINGLE_SERIES_COLOR,
                points: points.map((s) => Math.round(s.materials.medianDoh * 10) / 10),
              }]}
            />
          </section>

          <section className="rounded-2xl border bg-white p-4">
            <h2 className="mb-2 text-sm font-bold">창고 — 점유율</h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {warehouseCodes.map((code) => (
                <Sparkline
                  key={code}
                  label={code}
                  values={points.map((s) => s.warehouses.find((w) => w.code === code)?.utilization ?? 0)}
                  thresholds={[
                    { value: 95, color: STATUS_COLOR.warning, label: "발주 상한" },
                    { value: 100, color: STATUS_COLOR.critical, label: "포화 임계" },
                  ]}
                />
              ))}
            </div>
            <div className="mt-2 text-[10px] font-bold text-[#999]">
              점선 — 노랑 95%(발주 상한 ORDER_CAPACITY_TARGET_RATIO) · 빨강 100%(포화 임계, 초과 시 입고 보류)
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4">
            <h2 className="mb-2 text-sm font-bold">출하 — 계약 이행률</h2>
            <LineChart
              xLabels={xLabels}
              referencePct={100}
              unit="%"
              markers={markers}
              gapBands={axis === "wall" ? gapBands : []}
              series={productSeries((s, p) => s.shipments.find((x) => x.product === p)?.fulfillmentPct ?? null)}
            />
          </section>
        </>
      )}
    </div>
  );
}
