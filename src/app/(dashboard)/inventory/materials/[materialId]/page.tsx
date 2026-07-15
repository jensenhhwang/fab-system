export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { collections } from "@/lib/db";
import { getMaterialDailyUsage } from "@/lib/queries";
import { buildProcurementSummary } from "@/lib/procurement";
import ProcurementMasterClient from "../../../scm/ProcurementMasterClient";

const DAY = 86_400_000;
const QUALITY_LABEL: Record<string, string> = {
  AVAILABLE: "가용", HOLD: "보류", QUARANTINE: "격리", CONSUMED: "소진",
};
const SUPPLY_LABEL: Record<string, string> = {
  BULK: "벌크 공급", CYLINDER: "용기 공급", CANISTER: "캐니스터", DRUM: "드럼",
  PALLET: "팔레트", CONTINUOUS: "연속 공급", GENERAL: "일반 조달",
};

function dateLabel(value?: Date | null) {
  return value ? new Date(value).toLocaleDateString("ko-KR") : "—";
}

export default async function MaterialDetailPage({ params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  const { materials, inventory, warehouses, inventoryLots, processUsage, materialSuppliers, suppliers, bomTemplates } = await collections();
  const material = await materials.findOne({ _id: materialId });
  if (!material) notFound();

  const [inventoryDocs, lotDocs, usageDocs, links, supplierDocs, templates, usageMap] = await Promise.all([
    inventory.find({ materialId }).toArray(),
    inventoryLots.find({ materialId, qualityStatus: { $ne: "CONSUMED" } }).sort({ expiryDate: 1, receivedAt: 1 }).toArray(),
    processUsage.find({ materialId }).sort({ site: 1, processCode: 1, product: 1 }).toArray(),
    materialSuppliers.find({ materialId }).sort({ isPrimary: -1 }).toArray(),
    suppliers.find({}).sort({ name: 1 }).toArray(),
    bomTemplates.find({ "lines.materialId": materialId }).sort({ processCode: 1, product: 1 }).toArray(),
    getMaterialDailyUsage(),
  ]);
  const warehouseIds = [...new Set([...inventoryDocs.map((item) => item.warehouseId), ...lotDocs.flatMap((lot) => lot.warehouseId ? [lot.warehouseId] : [])])];
  const warehouseDocs = await warehouses.find({ _id: { $in: warehouseIds } }).toArray();
  const warehouseMap = new Map(warehouseDocs.map((warehouse) => [warehouse._id, warehouse]));
  const totalQuantity = inventoryDocs.reduce((sum, item) => sum + item.quantity, 0);
  const usage = usageMap.get(materialId) ?? { daily: 0, monthlyQty: 0, source: "fallback" as const };
  const doh = material.ropDays === 0 || usage.daily <= 0 ? null : totalQuantity / usage.daily;
  const status = material.ropDays === 0 ? "현장생산" : doh == null ? "사용량 미등록" : doh < 5 ? "위급" : doh < material.ropDays ? "ROP 미달" : "정상";
  const procurement = buildProcurementSummary(links, supplierDocs);
  const now = new Date();
  const expiringLots = lotDocs.filter((lot) => lot.expiryDate && new Date(lot.expiryDate).getTime() <= now.getTime() + 30 * DAY);
  const qualityQty = lotDocs.reduce<Record<string, number>>((acc, lot) => {
    acc[lot.qualityStatus] = (acc[lot.qualityStatus] ?? 0) + lot.availableQuantity;
    return acc;
  }, {});
  const warnings = [
    ...(material.ropDays > 0 && doh != null && doh < material.ropDays ? [`현재 보관일수 ${doh.toFixed(1)}일이 ROP ${material.ropDays}일보다 짧습니다.`] : []),
    ...(usage.daily <= 0 ? ["사용량 기준이 없어 보관일수와 예상 소진일을 계산할 수 없습니다."] : []),
    ...(!links.length ? ["연결된 공급사가 없습니다."] : []),
    ...(links.length && !links.some((link) => link.qualificationStatus === "APPROVED") ? ["승인된 공급사가 없습니다."] : []),
    ...(links.length && !links.some((link) => (link.sourcingRole ?? (link.isPrimary ? "PRIMARY" : "SECONDARY")) === "PRIMARY") ? ["주공급사가 지정되지 않았습니다."] : []),
    ...(procurement && !procurement.rangeComplete ? ["주공급사의 최소·최대 리드타임 범위가 미등록 상태입니다."] : []),
    ...(expiringLots.length ? [`30일 이내 유효기한 도래 Lot이 ${expiringLots.length}건 있습니다.`] : []),
    ...(lotDocs.some((lot) => lot.qualityStatus === "HOLD" || lot.qualityStatus === "QUARANTINE") ? ["보류 또는 격리 상태의 Lot이 있습니다."] : []),
  ];
  const serializedLinks = links.map((link) => ({
    ...link,
    currentExpectedValidUntil: link.currentExpectedValidUntil?.toISOString() ?? null,
    updatedAt: link.updatedAt?.toISOString(),
  }));

  return <div className="space-y-6">
    <div>
      <Link href="/inventory" className="text-xs font-bold text-[#0078D4] hover:underline">← 재고 · 보관일수</Link>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div><div className="font-mono text-xs text-[#888]">{material.code}</div><h1 className="mt-1 text-3xl font-extrabold">{material.name}</h1><div className="mt-1 text-sm text-[#888]">{material.nameEn ?? "영문명 미등록"} · {material.category} · {material.unit}</div></div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${status === "정상" || status === "현장생산" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{status}</span>
      </div>
    </div>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      {[
        ["전체 재고", `${totalQuantity.toLocaleString()} ${material.unit}`],
        ["일사용량", usage.daily > 0 ? `${usage.daily.toFixed(1)} ${material.unit}` : "—"],
        ["월소요량", usage.monthlyQty > 0 ? `${Math.round(usage.monthlyQty).toLocaleString()} ${material.unit}` : "—"],
        ["보관일수", doh == null ? "—" : `${doh.toFixed(1)}일`],
        ["ROP", material.ropDays > 0 ? `${material.ropDays}일` : "비적용"],
        ["공급 형태", SUPPLY_LABEL[material.supplyMode ?? "GENERAL"] ?? material.supplyMode ?? "일반 조달"],
      ].map(([label, value]) => <div key={label} className="rounded-2xl border bg-white p-4"><div className="text-[11px] text-[#888]">{label}</div><div className="mt-2 text-base font-extrabold">{value}</div></div>)}
    </section>

    {warnings.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="text-sm font-extrabold text-amber-900">운영 확인 필요 · {warnings.length}건</h2><ul className="mt-3 grid gap-2 text-xs text-amber-800 md:grid-cols-2">{warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></section>}

    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-extrabold">창고별 재고</h2><p className="mt-1 text-xs text-[#888]">전체 재고는 아래 창고 수량을 자재 기준으로 한 번만 합산합니다.</p><div className="mt-4 space-y-3">{inventoryDocs.length ? inventoryDocs.map((item) => { const warehouse = warehouseMap.get(item.warehouseId); const share = totalQuantity > 0 ? item.quantity / totalQuantity * 100 : 0; return <div key={item._id}><div className="flex justify-between text-xs"><span className="font-bold">{warehouse?.name ?? item.warehouseId}</span><span>{item.quantity.toLocaleString()} {material.unit} · {share.toFixed(1)}%</span></div><div className="mt-1.5 h-2 rounded-full bg-[#eee]"><div className="h-full rounded-full bg-[#0078D4]" style={{ width: `${share}%` }} /></div></div> }) : <div className="py-8 text-center text-sm text-[#999]">등록된 재고가 없습니다.</div>}</div></section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-extrabold">Lot 품질 현황</h2><div className="mt-4 grid grid-cols-3 gap-3">{["AVAILABLE", "HOLD", "QUARANTINE"].map((quality) => <div key={quality} className="rounded-xl bg-[#F8F6F4] p-3"><div className="text-[10px] text-[#888]">{QUALITY_LABEL[quality]}</div><div className="mt-1 font-extrabold">{(qualityQty[quality] ?? 0).toLocaleString()} <span className="text-[10px] font-normal">{material.unit}</span></div></div>)}</div><div className="mt-4 max-h-64 overflow-auto"><table className="w-full text-xs"><thead><tr className="border-b text-left text-[#888]"><th className="py-2">Lot</th><th>보관처</th><th>가용량</th><th>입고일</th><th>유효기한</th><th>상태</th></tr></thead><tbody>{lotDocs.map((lot) => <tr key={lot._id} className="border-b last:border-0"><td className="py-2 font-mono">{lot.lotNo}</td><td>{warehouseMap.get(lot.warehouseId ?? "")?.code ?? "—"}</td><td>{lot.availableQuantity.toLocaleString()}</td><td>{dateLabel(lot.receivedAt)}</td><td className={expiringLots.some((item) => item._id === lot._id) ? "font-bold text-amber-700" : ""}>{dateLabel(lot.expiryDate)}</td><td>{QUALITY_LABEL[lot.qualityStatus] ?? lot.qualityStatus}</td></tr>)}</tbody></table>{!lotDocs.length && <div className="py-8 text-center text-sm text-[#999]">활성 Lot이 없습니다.</div>}</div></section>
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-extrabold">운영 구도</h2><p className="mt-1 text-xs text-[#888]">공정별 사용량이 소비량 계산의 단일 기준입니다.</p><div className="mt-4 overflow-auto"><table className="w-full text-xs"><thead><tr className="border-b text-left text-[#888]"><th className="py-2">사이트</th><th>공정</th><th>제품</th><th className="text-right">월소요량</th></tr></thead><tbody>{usageDocs.map((item) => <tr key={item._id} className="border-b last:border-0"><td className="py-2">{item.site ?? "공통"}</td><td className="font-bold">{item.processCode}</td><td>{item.product}</td><td className="text-right">{item.monthlyQty.toLocaleString()} {material.unit}</td></tr>)}</tbody></table>{!usageDocs.length && <div className="py-8 text-center text-sm text-[#999]">연결된 공정 사용량이 없습니다.</div>}</div></section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-extrabold">생산 · BOM 연결</h2><p className="mt-1 text-xs text-[#888]">BOM은 연결 관계를 보여주며 월소요량에 중복 합산하지 않습니다.</p><div className="mt-4 space-y-2">{templates.map((template) => { const line = template.lines.find((item) => item.materialId === materialId); return <div key={template._id} className="flex items-center justify-between rounded-xl bg-[#F8F6F4] px-4 py-3 text-xs"><span><b>{template.product}</b> · {template.processCode}</span><span>생산 1단위당 <b>{line?.qtyPerRun ?? 0} {material.unit}</b></span></div> })}{!templates.length && <div className="py-8 text-center text-sm text-[#999]">연결된 BOM 템플릿이 없습니다.</div>}</div></section>
    </div>

    <section className="rounded-2xl border border-blue-100 bg-blue-50/30 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-extrabold">현재 조달 적용 기준</h2><p className="mt-1 text-xs text-[#888]">이 값은 SCM과 운영 What-If가 동일하게 사용합니다.</p></div>{procurement ? <div className="text-right text-xs"><b>{procurement.supplierName}</b><div className="mt-1 text-[#666]">일반 {procurement.normalDays ?? "—"}일 ({procurement.normalSource}) · 안전 {procurement.safeDays ?? "—"}일 · 대체 {procurement.alternatives.length}곳</div></div> : <span className="text-xs font-bold text-amber-700">적용 가능한 승인 공급사 없음</span>}</div></section>

    <ProcurementMasterClient initialMaterials={[material]} initialSuppliers={supplierDocs} initialLinks={serializedLinks} />
  </div>;
}
