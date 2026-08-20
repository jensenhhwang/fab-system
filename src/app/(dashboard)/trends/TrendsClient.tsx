"use client";

import { useEffect, useState } from "react";
import LineChart from "./charts/LineChart";
import BarChart from "./charts/BarChart";
import WarehouseTile from "./charts/WarehouseTile";
import StatTile from "./charts/StatTile";
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

  // setState를 effect 본문에서 동기로 부르면 연쇄 렌더가 된다(react-hooks/set-state-in-effect).
  // 상태 갱신은 전부 await 뒤에서만 하고, 필터를 빠르게 바꿨을 때 늦게 온 응답이 최신 결과를
  // 덮지 않도록 취소 플래그를 둔다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/twin/trends?axis=${axis}&days=${days}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        setPoints(Array.isArray(json.points) ? json.points : []);
      } catch {
        if (!cancelled) setPoints([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [axis, days]);

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

  const latest = points.length ? points[points.length - 1] : null;
  // 전일 대비 델타 — 표본이 1개면 비교 대상이 없으므로 null(화면에 "—").
  const deltaOf = (pick: (s: Snapshot) => number): number | null =>
    points.length < 2 ? null : Math.round((pick(points[points.length - 1]) - pick(points[points.length - 2])) * 10) / 10;
  const heroRate = latest
    ? Math.round(latest.production.reduce((a, x) => a + x.ratePct, 0) / Math.max(latest.production.length, 1))
    : 0;
  const avgFulfillment = latest
    ? latest.shipments.reduce((a, x) => a + x.fulfillmentPct, 0) / Math.max(latest.shipments.length, 1)
    : 0;

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
              onClick={() => { setLoading(true); setAxis(a); }}
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
              onClick={() => { setLoading(true); setDays(d); }}
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

      {/* 히어로 + KPI 타일 — 표본이 1개일 때 막대 하나짜리 차트를 그리는 대신
          숫자로 말한다(dataviz: "한 개짜리 막대차트는 stat tile로"). 히어로는 화면당 하나. */}
      <section className="rounded-2xl border border-[#EDEAE7] bg-white px-5 py-4">
        <div className="text-[11px] font-bold text-[#8A8580]">설계 대비 실산출률 · 3제품 평균</div>
        <div className="mt-1 flex items-end gap-3">
          <span className="text-[52px] font-extrabold leading-none tracking-tight text-[#141413]">{heroRate}</span>
          <span className="pb-1.5 text-lg font-bold text-[#8A8580]">%</span>
          <span className="pb-2 text-[11px] font-bold text-[#B5B0AA]">
            운영 {latest!.operatingDay}일차 기준 · 기준선 100%
          </span>
          <div className="ml-auto flex gap-4 pb-1">
            {latest!.production.map((p) => (
              <span key={p.product} className="flex items-center gap-1.5 text-[11px] font-bold text-[#4A453F]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PRODUCT_COLOR[p.product] }} />
                {p.product}
                <span className="text-[#8A8580]" style={{ fontVariantNumeric: "tabular-nums" }}>{p.ratePct}%</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="결품 자재"
          value={String(latest!.materials.stockoutCount)}
          unit="종"
          delta={deltaOf((s) => s.materials.stockoutCount)}
          deltaLabel="전일 대비"
          deltaGoodWhen="down"
          trend={points.map((s) => s.materials.stockoutCount)}
          accent={STATUS_COLOR.critical}
        />
        <StatTile
          label="커버리지 중앙값"
          value={latest!.materials.medianDoh.toFixed(1)}
          unit="일"
          delta={deltaOf((s) => Math.round(s.materials.medianDoh * 10) / 10)}
          deltaLabel="전일 대비"
          deltaGoodWhen="up"
          trend={points.map((s) => s.materials.medianDoh)}
          accent={SINGLE_SERIES_COLOR}
        />
        <StatTile
          label="임계 근접 자재"
          value={String(latest!.materials.criticalCount)}
          unit="종"
          delta={deltaOf((s) => s.materials.criticalCount)}
          deltaLabel="전일 대비"
          deltaGoodWhen="down"
          trend={points.map((s) => s.materials.criticalCount)}
          accent={STATUS_COLOR.warning}
        />
        <StatTile
          label="계약 이행률 · 3제품 평균"
          value={avgFulfillment.toFixed(0)}
          unit="%"
          delta={deltaOf((s) => Math.round(s.shipments.reduce((a, x) => a + x.fulfillmentPct, 0) / Math.max(s.shipments.length, 1)))}
          deltaLabel="전일 대비"
          deltaGoodWhen="up"
          trend={points.map((s) => s.shipments.reduce((a, x) => a + x.fulfillmentPct, 0) / Math.max(s.shipments.length, 1))}
          accent={PRODUCT_COLOR.DRAM}
        />
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
          {points.length < 2 && (
            <div className="rounded-2xl border border-dashed border-[#DED9D4] bg-white px-5 py-6 text-center">
              <div className="text-sm font-bold text-[#4A453F]">추이를 그리려면 운영일 스냅샷이 2개 이상 필요하다</div>
              <div className="mt-1 text-[12px] text-[#8A8580]">
                지금은 {points.length}개 — 위 타일이 현재 값을 말하고, 다음 운영일 경계(24배속에서 실제 1시간)마다 점이 하나씩 늘어난다.
                과거는 백필하지 않는다: 운영시계의 catch-up 상한 때문에 벽↔운영 매핑이 정지 구간에서 끊겨 과거 운영일을 복원할 수 없다.
              </div>
            </div>
          )}
          <section className={points.length < 2 ? "hidden" : "rounded-2xl border bg-white p-4"}>
            <h2 className="mb-2 text-sm font-bold">생산 — 설계 대비 실산출률</h2>
            <LineChart
              xLabels={xLabels}
              referencePct={100}
              referenceLabel="설계 100%"
              unit="%"
              markers={markers}
              gapBands={axis === "wall" ? gapBands : []}
              series={productSeries((s, p) => s.production.find((x) => x.product === p)?.ratePct ?? null)}
            />
          </section>

          <section className={points.length < 2 ? "hidden" : "rounded-2xl border bg-white p-4"}>
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
                <WarehouseTile
                  key={code}
                  label={code}
                  href={`/warehouse/${code}`}
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

          <section className={points.length < 2 ? "hidden" : "rounded-2xl border bg-white p-4"}>
            <h2 className="mb-2 text-sm font-bold">출하 — 계약 이행률</h2>
            <LineChart
              xLabels={xLabels}
              referencePct={100}
              referenceLabel="설계 100%"
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
