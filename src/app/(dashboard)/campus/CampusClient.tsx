"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useControlContext } from "@/components/ControlContext";
import { FAB_IDS, PRODUCT_TO_FAB, type FabId } from "@/lib/fab-domain";
import type { CampusMaterialFlowSnapshot, MaterialFlowStep } from "@/lib/material-flow";
import { buildTwinHref, type CameraPreset, type TwinMode } from "@/lib/twin-navigation";
import type { UsageTwinData } from "@/lib/usage-twin-data";
import { positionForTransfer, POSITION_MODE_LABEL, TRANSFER_STATUS_LABEL, type LiveTransfer } from "@/lib/live-transfer";

const CampusScene3D = dynamic(() => import("@/components/CampusScene3D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-[#ECE9E4] text-xs font-bold text-[#77716A]">Campus 3D 로딩 중…</div>,
});
const ProcessFlow3D = dynamic(() => import("@/components/ProcessFlow3D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-[#E8EDF2] text-xs font-bold text-[#66717C]">선택 Fab 공정 3D 로딩 중…</div>,
});

function format(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value);
}

const CONSISTENCY = {
  MATCHED: { label: "원장 일치", color: "#087A55", bg: "#E9F8F2" },
  MISMATCH: { label: "원장 불일치", color: "#C51636", bg: "#FFECEF" },
  NOT_AVAILABLE: { label: "상세 원장 미연결", color: "#8A5A00", bg: "#FFF4D8" },
} as const;

export default function CampusClient({ snapshot, usageTwin, initialTransfers, equipmentCounts }: { snapshot: CampusMaterialFlowSnapshot; usageTwin: UsageTwinData; initialTransfers: LiveTransfer[]; equipmentCounts: Partial<Record<FabId, Record<string, number>>> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [transfers, setTransfers] = useState(initialTransfers);
  const [transferSyncAt, setTransferSyncAt] = useState<string | null>(null);
  const {
    fabScope, setFabScope, selectedMaterialId, setSelectedMaterialId,
    selectedFacilityId, selectedLotId, selectedHandlingUnitId, selectedAlertId,
    selectedFlowStep, twinMode, referenceTime, cameraPreset, updateTwinSelection,
  } = useControlContext();
  const selectedProcessCode = searchParams.get("process");
  const requestedView = searchParams.get("view");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fab = params.get("fab");
    if (fab && FAB_IDS.includes(fab as FabId)) setFabScope(fab as FabId);
    const materialId = params.get("material");
    if (materialId) setSelectedMaterialId(materialId);
    const mode = params.get("mode") as TwinMode | null;
    const camera = params.get("camera") as CameraPreset | null;
    updateTwinSelection({
      selectedFacilityId: params.get("facility"),
      selectedLotId: params.get("lot"),
      selectedHandlingUnitId: params.get("hu"),
      selectedAlertId: params.get("alert"),
      selectedFlowStep: params.get("step"),
      twinMode: mode === "PLAN" || mode === "WHAT_IF" ? mode : "LIVE",
      referenceTime: params.get("time"),
      cameraPreset: camera ?? "CAMPUS_OVERVIEW",
    });
  }, [setFabScope, setSelectedMaterialId, updateTwinSelection]);
  useEffect(() => {
    if (requestedView !== "fab") return;
    const frame = window.requestAnimationFrame(() => document.getElementById("fab-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [requestedView]);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/twin/transfers", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { transfers?: LiveTransfer[]; serverTime?: string };
        if (disposed || !Array.isArray(payload.transfers)) return;
        setTransfers(payload.transfers);
        setTransferSyncAt(payload.serverTime ?? new Date().toISOString());
      } catch {
        // Keep the last verified snapshot when the feed is temporarily unavailable.
      }
    };
    const interval = window.setInterval(() => void refresh(), 5_000);
    const onVisibilityChange = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  const scopedMaterials = useMemo(() => {
    if (fabScope === "CAMPUS") return snapshot.materials;
    return snapshot.materials.filter((material) => (
      material.fabs.find((fab) => fab.fabId === fabScope)?.dailyUsage ?? 0
    ) > 0);
  }, [fabScope, snapshot.materials]);
  const material = scopedMaterials.find((item) => item.materialId === selectedMaterialId)
    ?? scopedMaterials.find((item) => item.availableQuantity > 0 && item.fabs.some((fab) => fab.fabId === "M20" && fab.dailyUsage > 0))
    ?? scopedMaterials[0];
  const m20Flow = material?.fabs.find((fab) => fab.fabId === "M20");
  const selectedStep = m20Flow?.steps.find((step) => step.id === selectedFlowStep) ?? m20Flow?.steps[0];

  if (!material) {
    return <div className="border border-[#D8D3CD] bg-white p-8 text-sm text-[#6F6963]">Campus에 표시할 자재가 없습니다.</div>;
  }
  const consistency = CONSISTENCY[material.consistency.status];
  const materialHasLiveOperation = material.fabs.some((fab) => fab.steps.some((step) => step.stage !== "WMS_STOCK" && step.mode === "LIVE_LEDGER"));
  const materialModeReason = materialHasLiveOperation
    ? "선택 자재의 MES Allocation·피킹·이송·도착·소비 이벤트를 실제 운영 원장에서 읽고, 아직 발생하지 않은 단계만 계획값으로 표시합니다."
    : "선택 자재의 Fab별 Allocation·TransferOrder 운영 원장이 아직 없어 현재 공정계획 사용비중으로 배분한 계획 장면입니다.";
  const inTransitCount = transfers.filter((transfer) => transfer.status === "IN_TRANSIT").length;
  const transferPositionAt = Date.parse(transferSyncAt ?? transfers[0]?.updatedAt ?? "1970-01-01T00:00:00.000Z");

  const selectMaterial = (materialId: string) => {
    setSelectedMaterialId(materialId);
    const next = snapshot.materials.find((item) => item.materialId === materialId)?.fabs.find((fab) => fab.fabId === "M20");
    const step = next?.steps[0]?.id ?? null;
    updateTwinSelection({ selectedFlowStep: step });
    router.replace(buildTwinHref("/campus", {
      fabScope, materialId, facilityId: selectedFacilityId, lotId: selectedLotId,
      handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId, flowStep: step,
      mode: twinMode, referenceTime, cameraPreset,
    }), { scroll: false });
  };

  const selectFab = (fabId: FabId) => {
    const nextScope = fabScope === fabId ? "CAMPUS" : fabId;
    setFabScope(nextScope);
    router.replace(buildTwinHref("/campus", {
      fabScope: nextScope, materialId: material.materialId, facilityId: selectedFacilityId,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: selectedStep?.id, mode: twinMode, referenceTime, cameraPreset,
    }), { scroll: false });
  };

  const selectStep = (stepId: string) => {
    updateTwinSelection({ selectedFlowStep: stepId });
    router.replace(buildTwinHref("/campus", {
      fabScope, materialId: material.materialId, facilityId: selectedFacilityId,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: stepId, mode: twinMode, referenceTime, cameraPreset,
    }), { scroll: false });
  };

  const openFacility = (facilityId: string) => {
    const facility = snapshot.facilities.find((item) => item.id === facilityId);
    const nextFabScope = facility?.fabId ?? fabScope;
    const nextCamera = (facility?.role === "CENTRAL_WMS" ? "WMS_OVERVIEW" : `${facility?.fabId ?? "M20"}_OVERVIEW`) as CameraPreset;
    updateTwinSelection({ selectedFacilityId: facilityId, cameraPreset: nextCamera });
    if (facility?.fabId) setFabScope(facility.fabId);
    if (facility?.role !== "CENTRAL_WMS") {
      router.replace(buildTwinHref("/campus", {
        fabScope: nextFabScope, materialId: material.materialId, facilityId,
        lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
        flowStep: selectedStep?.id, mode: twinMode,
        referenceTime, cameraPreset: nextCamera,
      }), { scroll: false });
      return;
    }
    const target = `/warehouse/${material.sourceLocations[0]?.facilityId ?? "MWH-01"}`;
    router.push(buildTwinHref(target, {
      fabScope: nextFabScope, materialId: material.materialId, facilityId,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: selectedStep?.id, mode: twinMode, referenceTime, cameraPreset: nextCamera,
    }));
  };

  const openProcess = (fabId: FabId, processCode: string) => {
    setFabScope(fabId);
    updateTwinSelection({ selectedFacilityId: `FAB-${fabId}`, cameraPreset: `${fabId}_OVERVIEW` as CameraPreset });
    router.replace(buildTwinHref("/campus", {
      fabScope: fabId, materialId: material.materialId, facilityId: `FAB-${fabId}`,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: selectedStep?.id, processCode, mode: twinMode, referenceTime,
      cameraPreset: `${fabId}_OVERVIEW` as CameraPreset,
    }), { scroll: false });
  };

  const openWarehouse = (warehouseCode: string) => {
    const source = material.sourceLocations.find((location) => location.facilityId === warehouseCode);
    updateTwinSelection({ selectedFacilityId: warehouseCode, cameraPreset: "WMS_OVERVIEW" });
    router.push(buildTwinHref(`/warehouse/${warehouseCode}`, {
      fabScope, materialId: source ? material.materialId : null, facilityId: warehouseCode,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: selectedStep?.id, processCode: selectedProcessCode, mode: twinMode,
      referenceTime, cameraPreset: "WMS_OVERVIEW",
    }));
  };

  const focusFab = (fabId: FabId) => {
    setFabScope(fabId);
    updateTwinSelection({ selectedFacilityId: `FAB-${fabId}`, cameraPreset: `${fabId}_OVERVIEW` as CameraPreset });
    router.replace(buildTwinHref("/campus", {
      fabScope: fabId, materialId: material.materialId, facilityId: `FAB-${fabId}`,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: selectedStep?.id, mode: twinMode, referenceTime,
      cameraPreset: `${fabId}_OVERVIEW` as CameraPreset,
    }), { scroll: false });
  };

  const clearProcess = () => focusFab(focusedFabId);

  const focusedFabId: FabId = fabScope === "CAMPUS" ? "M20" : fabScope;
  const focusedFab = material.fabs.find((fab) => fab.fabId === focusedFabId)!;
  const usageMaterial = usageTwin.materials.find((item) => item.id === material.materialId);
  const detailedProcesses = selectedProcessCode ? [selectedProcessCode] : focusedFab.processCodes;
  const focusedUsages = usageMaterial?.usages.filter((usage) => PRODUCT_TO_FAB[usage.product as keyof typeof PRODUCT_TO_FAB] === focusedFabId) ?? [];

  return (
    <div className="mx-auto max-w-[1540px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.15em] text-[#716C66]">{snapshot.layoutVersion} / 1WMS · 3FAB</div>
          <h1 className="text-[30px] font-black tracking-[-0.045em] text-[#181715]">Campus Material Twin</h1>
          <p className="mt-1 text-xs text-[#6F6A64]">중앙 WMS의 적치·이송과 M20·M21·M22 내부 P01~P10·FOUP을 하나의 운영 장면으로 연결</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`border px-3 py-2 text-[10px] font-black ${materialHasLiveOperation ? "border-[#8FD2BB] bg-[#E9F8F2] text-[#087A55]" : "border-[#E5B65C] bg-[#FFF4D8] text-[#8A5A00]"}`}>
            {materialHasLiveOperation ? "LEDGER + PLAN" : "DERIVED PLAN"}
          </span>
          <span className={`border px-3 py-2 text-[10px] font-black ${transfers.length ? "border-[#8DB8F5] bg-[#EAF2FF] text-[#1D5FBF]" : "border-[#D8D3CD] bg-[#F7F5F2] text-[#77716A]"}`}>
            TRANSFER FEED · {transfers.length ? `${transfers.length}건 / 이송 ${inTransitCount}건` : "활성 이송 없음"}
          </span>
          <Link href="/" className="border border-[#D2CCC5] bg-white px-3 py-2 text-[10px] font-black text-[#3D3935] hover:bg-[#F6F3EF]">← CONTROL TOWER</Link>
        </div>
      </div>

      <div className="mb-4 border border-[#E5B65C] bg-[#FFF9EA] px-4 py-3 text-[11px] leading-5 text-[#74521A]">
        <span className="font-black">{materialHasLiveOperation ? "운영 원장:" : "계획 장면:"}</span> {materialModeReason}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <section className="overflow-hidden border border-[#D8D3CD] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DEDAD5] px-4 py-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.1em] text-[#272522]">LIVE CAMPUS MATERIAL SCENE</div>
              <div className="mt-1 text-[10px] text-[#817B74]">전체 창고·전체 활성 이송 = 항상 표시 · 선택 SKU = 강조만 적용 · TransferOrder가 없으면 물류 캐리어 정지</div>
            </div>
            <select
              aria-label="Campus 추적 자재"
              value={material.materialId}
              onChange={(event) => selectMaterial(event.target.value)}
              className="min-w-[260px] border border-[#CFCAC4] bg-[#FAF8F5] px-3 py-2 text-xs font-bold text-[#24221F] outline-none"
            >
              {scopedMaterials.map((item) => <option key={item.materialId} value={item.materialId}>{item.code} · {item.name}</option>)}
            </select>
          </div>
          <div className="h-[650px]">
            <CampusScene3D
              material={material}
              fabScope={fabScope}
              facilities={snapshot.facilities}
              warehouses={usageTwin.warehouses}
              transfers={transfers}
              equipmentCounts={equipmentCounts}
              onFacilitySelect={openFacility}
              onWarehouseSelect={openWarehouse}
              onProcessSelect={openProcess}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[#DEDAD5] bg-white px-4 py-3">
            <span className="mr-1 text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">ALL WAREHOUSES</span>
            {usageTwin.warehouses.map((warehouse) => {
              const source = material.sourceLocations.find((location) => location.facilityId === warehouse.code);
              return <button key={warehouse.code} type="button" onClick={() => openWarehouse(warehouse.code)} className={`border px-2 py-1 text-[9px] font-black ${source ? "border-[#2F7D63] bg-[#E9F8F2] text-[#087A55]" : "border-[#D8DDE2] bg-[#F5F7F9] text-[#6F7881]"}`} title={warehouse.name}>
                {warehouse.code} · {warehouse.name}{source ? ` · ${format(source.quantity)} ${material.unit}` : ""}
              </button>;
            })}
            <span className="ml-auto text-[9px] text-[#8A847D]">초록 = 선택 SKU 보관 창고 · 회색 = 다른 자재 창고</span>
          </div>
          <div className="grid border-t border-[#DEDAD5] bg-[#F8F6F3] md:grid-cols-4">
            {material.fabs.map((fab) => (
              <button
                key={fab.fabId}
                type="button"
                onClick={() => selectFab(fab.fabId)}
                className="border-r border-[#DEDAD5] px-4 py-3 text-left hover:bg-white"
              >
                <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">{fab.fabId} 계획배분</div>
                <div className="mt-1 font-mono text-sm font-black text-[#262420]">{format(fab.plannedAllocation)} {material.unit}</div>
                <div className="mt-1 text-[9px] text-[#817B74]">{format(fab.dailyUsage)} {material.unit}/일 · {fab.processCodes.join(", ") || "공정 미연결"}</div>
              </button>
            ))}
            <div className="px-4 py-3">
              <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">현재 범위</div>
              <div className="mt-1 font-mono text-sm font-black text-[#262420]">{fabScope}</div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="border border-[#D8D3CD] bg-white">
            <div className="flex items-start justify-between gap-3 border-b border-[#DEDAD5] px-4 py-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#77716A]">ACTIVE TRANSFER ORDERS</div>
                <div className="mt-1 text-[10px] text-[#8A847D]">모든 자재 동시 표시 · 완료 후 재순환 없음</div>
              </div>
              <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${transfers.length ? "bg-[#00A86B]" : "bg-[#A9A39C]"}`} />
            </div>
            {transfers.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <div className="text-xs font-black text-[#625D57]">활성 이송 없음 · 캐리어 정지</div>
                <div className="mt-2 text-[9px] leading-4 text-[#918A83]">MES 자재 요청과 피킹이 발생하면 해당 자재만 이곳과 3D 경로에 나타납니다.</div>
              </div>
            ) : (
              <div className="max-h-[330px] divide-y divide-[#E8E4DF] overflow-y-auto">
                {transfers.slice(0, 12).map((transfer) => {
                  const position = positionForTransfer(transfer, transferPositionAt);
                  const selected = transfer.materialId === material.materialId;
                  return <div key={transfer.id} className={`px-4 py-3 ${selected ? "bg-[#F1F6FF]" : "bg-white"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-black text-[#292622]">{transfer.materialCode}</span>
                      <span className="shrink-0 text-[9px] font-black text-[#1D5FBF]">{TRANSFER_STATUS_LABEL[transfer.status]}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-[#77716A]">
                      <span className="truncate">{transfer.fromFacilityId} → {transfer.fabId}</span>
                      <span className="shrink-0 font-mono">{format(transfer.quantity)} {transfer.unit}</span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden bg-[#E5E8EB]"><div className="h-full bg-[#2878E4]" style={{ width: `${position.progress * 100}%` }} /></div>
                    <div className="mt-1 text-[8px] font-bold text-[#8A847D]">{POSITION_MODE_LABEL[position.mode]}{transfer.handlingUnitId ? ` · ${transfer.handlingUnitId}` : ""}</div>
                  </div>;
                })}
                {transfers.length > 12 && <div className="px-4 py-2 text-center text-[9px] font-bold text-[#77716A]">외 {transfers.length - 12}건 동시 렌더링 중</div>}
              </div>
            )}
            <div className="border-t border-[#E8E4DF] px-4 py-2 text-[8px] text-[#918A83]">5초 동기화 · {transferSyncAt ? `최근 갱신 ${transferSyncAt.slice(11, 19)} UTC` : "초기 서버 스냅샷"}</div>
          </section>

          <section className="border border-[#D8D3CD] bg-white">
            <div className="border-b border-[#DEDAD5] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#77716A]">SELECTED MATERIAL</div>
              <div className="mt-1 text-base font-black text-[#24221F]">{material.code}</div>
              <div className="text-xs text-[#77716A]">{material.name}</div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-[#DEDAD5]">
              <div className="bg-white p-3"><div className="text-[9px] font-bold text-[#8A847D]">WMS 가용재고</div><div className="mt-1 font-mono text-sm font-black">{format(material.availableQuantity)} {material.unit}</div></div>
              <div className="bg-white p-3"><div className="text-[9px] font-bold text-[#8A847D]">통합 잔여</div><div className="mt-1 font-mono text-sm font-black">{material.coverageDays?.toFixed(1) ?? "—"}일</div></div>
            </div>
            <div className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">원장 정합성</span>
                <span className="px-2 py-1 text-[9px] font-black" style={{ color: consistency.color, backgroundColor: consistency.bg }}>{consistency.label}</span>
              </div>
              <div className="space-y-1 font-mono text-[10px] text-[#6F6963]">
                <div className="flex justify-between"><span>집계재고</span><span>{format(material.consistency.aggregateInventory)}</span></div>
                <div className="flex justify-between"><span>Available Lot</span><span>{material.consistency.availableLots === null ? "미연결" : format(material.consistency.availableLots)}</span></div>
                <div className="flex justify-between"><span>Handling Unit</span><span>{material.consistency.handlingUnits === null ? "미연결" : format(material.consistency.handlingUnits)}</span></div>
              </div>
            </div>
          </section>

          <section className="border border-[#D8D3CD] bg-white">
            <div className="border-b border-[#DEDAD5] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#77716A]">WMS → M20 VERTICAL TRACE</div>
              <div className="mt-1 text-[10px] text-[#8A847D]">첫 스프린트 대표 경로</div>
            </div>
            <div className="max-h-[350px] divide-y divide-[#E8E4DF] overflow-y-auto">
              {m20Flow?.steps.map((step: MaterialFlowStep, index) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => selectStep(step.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#FAF8F5]"
                  style={{ backgroundColor: selectedStep?.id === step.id ? "#F3F0EC" : undefined }}
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${step.mode === "LIVE_LEDGER" ? "bg-[#059669]" : step.status === "BLOCKED" ? "bg-[#DC2626]" : "bg-[#F59E0B]"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-black text-[#2A2825]">{step.label}</span><span className="font-mono text-[9px] text-[#8A847D]">{String(index + 1).padStart(2, "0")}</span></div>
                    <div className="mt-1 flex justify-between text-[9px] text-[#817B74]"><span>{step.stage}</span><span>{format(step.quantity)} {material.unit}</span></div>
                    <div className="mt-1 text-[9px] font-bold text-[#9A6A10]">{step.mode === "LIVE_LEDGER" ? "LIVE WMS LEDGER" : step.status === "NOT_CONNECTED" ? "NOT CONNECTED" : "DERIVED PLAN"}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="border border-[#D8D3CD] bg-white p-4">
            <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">물리 보관 위치</div>
            <div className="mt-2 space-y-2">
              {material.sourceLocations.map((location) => (
                <div key={location.facilityId} className="flex items-center justify-between text-[10px]"><span className="font-bold text-[#4B4742]">{location.facilityId} · {location.name}</span><span className="font-mono text-[#77716A]">{format(location.quantity)} {material.unit}</span></div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section id="fab-detail" className="mt-4 scroll-mt-4 overflow-hidden border border-[#D8D3CD] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DEDAD5] px-4 py-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.1em] text-[#272522]">{focusedFabId} PROCESS + MATERIAL DETAIL</div>
            <div className="mt-1 text-[10px] text-[#817B74]">Campus에서 선택한 같은 자재·Fab을 기준으로 P01~P10 장비, FOUP, 창고 공급 배관을 한 화면에 표시</div>
          </div>
          <div className="flex items-center gap-1">
            {FAB_IDS.map((fabId) => (
              <button key={fabId} type="button" onClick={() => focusFab(fabId)} className={`px-3 py-1.5 text-[10px] font-black ${focusedFabId === fabId ? "bg-[#20262D] text-white" : "bg-[#EEF1F4] text-[#66717C]"}`}>{fabId}</button>
            ))}
            {selectedProcessCode && <button type="button" onClick={clearProcess} className="ml-2 px-3 py-1.5 text-[10px] font-black text-[#C51636]">공정 필터 해제</button>}
          </div>
        </div>
        <div className="h-[680px] bg-[#E8EDF2]">
          <ProcessFlow3D
            fabId={focusedFabId}
            highlightedProcesses={detailedProcesses}
            activeProcesses={focusedFab.processCodes}
            onProcessClick={(processCode) => openProcess(focusedFabId, processCode)}
            onWarehouseClick={(warehouseCode) => router.push(buildTwinHref(`/warehouse/${warehouseCode}`, {
              fabScope: focusedFabId, materialId: material.materialId, facilityId: warehouseCode,
              lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
              flowStep: selectedStep?.id, processCode: selectedProcessCode, mode: twinMode,
              referenceTime, cameraPreset: "WMS_OVERVIEW",
            }))}
            warehouses={usageTwin.warehouses}
            warehouseLinks={usageTwin.links}
            equipmentCounts={equipmentCounts[focusedFabId]}
          />
        </div>
        <div className="grid gap-px border-t border-[#DEDAD5] bg-[#DEDAD5] sm:grid-cols-2 lg:grid-cols-5">
          {(focusedUsages.length ? focusedUsages : [{ proc: "—", product: focusedFabId, qty: 0 }]).map((usage, index) => (
            <button key={`${usage.proc}-${index}`} type="button" onClick={() => usage.proc !== "—" && openProcess(focusedFabId, usage.proc)} className="bg-white px-4 py-3 text-left hover:bg-[#F8FAFC]">
              <div className="text-[9px] font-black text-[#8A847D]">{usage.proc} · {usage.product}</div>
              <div className="mt-1 font-mono text-sm font-black text-[#252A30]">{usage.qty.toLocaleString()} <span className="text-[9px] font-bold text-[#8A847D]">{material.unit}/월</span></div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
