"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useControlContext } from "@/components/ControlContext";
import { FAB_IDS, PRODUCT_TO_FAB, type FabId } from "@/lib/fab-domain";
import type { CampusMaterialFlowSnapshot, MaterialFlowStep } from "@/lib/material-flow";
import { buildTwinHref, type CameraPreset, type TwinMode } from "@/lib/twin-navigation";
import type { UsageTwinData } from "@/lib/usage-twin-data";
import { positionForTransfer, POSITION_MODE_LABEL, TRANSFER_STATUS_LABEL, type LiveTransfer } from "@/lib/live-transfer";
import { calculateServerOffset, sceneReferenceTime, type SceneClockMode } from "@/lib/scene-clock";

const CampusScene3D = dynamic(() => import("@/components/CampusScene3D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-[#ECE9E4] text-xs font-bold text-[#77716A]">Campus 3D 로딩 중…</div>,
});

function format(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value);
}

const CONSISTENCY = {
  MATCHED: { label: "원장 일치", color: "#087A55", bg: "#E9F8F2" },
  MISMATCH: { label: "원장 불일치", color: "#C51636", bg: "#FFECEF" },
  NOT_AVAILABLE: { label: "상세 원장 미연결", color: "#8A5A00", bg: "#FFF4D8" },
} as const;

export default function CampusClient({ snapshot, usageTwin, initialTransfers, initialServerTime, equipmentCounts }: { snapshot: CampusMaterialFlowSnapshot; usageTwin: UsageTwinData; initialTransfers: LiveTransfer[]; initialServerTime: string; equipmentCounts: Partial<Record<FabId, Record<string, number>>> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [transfers, setTransfers] = useState(initialTransfers);
  const [transferSyncAt, setTransferSyncAt] = useState(initialServerTime);
  const [clockMode, setClockMode] = useState<SceneClockMode>("LIVE");
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [pausedAtMs, setPausedAtMs] = useState<number | null>(null);
  const [clockTickMs, setClockTickMs] = useState(() => Date.parse(initialServerTime));
  const {
    fabScope, setFabScope, selectedMaterialId, setSelectedMaterialId,
    selectedFacilityId, selectedLotId, selectedHandlingUnitId, selectedAlertId,
    selectedFlowStep, twinMode, referenceTime, cameraPreset, updateTwinSelection,
  } = useControlContext();
  const [selectedProcessCode, setSelectedProcessCode] = useState(() => searchParams.get("process"));
  const requestedView = searchParams.get("view");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fab = params.get("fab");
    if (fab && FAB_IDS.includes(fab as FabId)) setFabScope(fab as FabId);
    const materialId = params.get("material");
    setSelectedMaterialId(materialId || null);
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
  const refreshTransfers = useCallback(async () => {
    try {
      const response = await fetch("/api/twin/transfers", { cache: "no-store" });
      if (!response.ok) return;
      const receivedAt = Date.now();
      const payload = await response.json() as { transfers?: LiveTransfer[]; serverTime?: string };
      if (!Array.isArray(payload.transfers)) return;
      const serverTime = payload.serverTime ?? new Date(receivedAt).toISOString();
      setTransfers(payload.transfers);
      setTransferSyncAt(serverTime);
      setServerOffsetMs(calculateServerOffset(serverTime, receivedAt));
      setClockTickMs(receivedAt);
    } catch {
      // Keep the last verified snapshot when the feed is temporarily unavailable.
    }
  }, []);
  useEffect(() => {
    if (clockMode !== "LIVE") return;
    const tick = window.setInterval(() => setClockTickMs(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, [clockMode]);
  useEffect(() => {
    if (clockMode !== "LIVE") return;
    let disposed = false;
    const refresh = async () => {
      if (disposed || document.hidden) return;
      await refreshTransfers();
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
  }, [clockMode, refreshTransfers]);
  const scopedMaterials = useMemo(() => {
    if (fabScope === "CAMPUS") return snapshot.materials;
    return snapshot.materials.filter((material) => (
      material.fabs.find((fab) => fab.fabId === fabScope)?.dailyUsage ?? 0
    ) > 0);
  }, [fabScope, snapshot.materials]);
  const allMaterialsMode = selectedMaterialId === null;
  const material = scopedMaterials.find((item) => item.materialId === selectedMaterialId)
    ?? scopedMaterials[0];
  const m20Flow = material?.fabs.find((fab) => fab.fabId === "M20");
  const selectedStep = m20Flow?.steps.find((step) => step.id === selectedFlowStep) ?? m20Flow?.steps[0];

  if (!material) {
    return <div className="border border-[#D8D3CD] bg-white p-8 text-sm text-[#6F6963]">Campus에 표시할 자재가 없습니다.</div>;
  }
  const consistency = CONSISTENCY[material.consistency.status];
  const materialHasLiveOperation = allMaterialsMode
    ? scopedMaterials.some((item) => item.fabs.some((fab) => fab.steps.some((step) => step.stage !== "WMS_STOCK" && step.mode === "LIVE_LEDGER")))
    : material.fabs.some((fab) => fab.steps.some((step) => step.stage !== "WMS_STOCK" && step.mode === "LIVE_LEDGER"));
  const materialModeReason = materialHasLiveOperation
    ? "선택 자재의 MES Allocation·피킹·이송·도착·소비 이벤트를 실제 운영 원장에서 읽고, 아직 발생하지 않은 단계만 계획값으로 표시합니다."
    : "선택 자재의 Fab별 Allocation·TransferOrder 운영 원장이 아직 없어 현재 공정계획 사용비중으로 배분한 계획 장면입니다.";
  const visibleTransfers = allMaterialsMode ? transfers : transfers.filter((transfer) => transfer.materialId === material.materialId);
  const inTransitCount = visibleTransfers.filter((transfer) => transfer.status === "IN_TRANSIT").length;
  const transferPositionAt = sceneReferenceTime({ mode: clockMode, clientNowMs: clockTickMs, serverOffsetMs, pausedAtMs });
  const activeMaterialCount = new Set(visibleTransfers.map((transfer) => transfer.materialId)).size;
  const activeWarehouseCount = new Set(visibleTransfers.map((transfer) => transfer.fromFacilityId)).size;
  const replaceCampusUrl = (href: string) => {
    History.prototype.replaceState.call(window.history, window.history.state, "", href);
  };

  const selectMaterial = (materialId: string) => {
    const nextMaterialId = materialId === "__ALL__" ? null : materialId;
    setSelectedMaterialId(nextMaterialId);
    if (!nextMaterialId) {
      updateTwinSelection({ selectedFlowStep: null, selectedLotId: null, selectedHandlingUnitId: null });
      replaceCampusUrl(buildTwinHref("/campus", {
        fabScope, materialId: null, facilityId: selectedFacilityId, alertId: selectedAlertId,
        mode: twinMode, referenceTime, cameraPreset,
      }));
      return;
    }
    const next = snapshot.materials.find((item) => item.materialId === nextMaterialId)?.fabs.find((fab) => fab.fabId === "M20");
    const step = next?.steps[0]?.id ?? null;
    updateTwinSelection({ selectedFlowStep: step });
    replaceCampusUrl(buildTwinHref("/campus", {
      fabScope, materialId: nextMaterialId, facilityId: selectedFacilityId, lotId: selectedLotId,
      handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId, flowStep: step,
      mode: twinMode, referenceTime, cameraPreset,
    }));
  };

  const pauseScene = () => {
    const pausedAt = sceneReferenceTime({ mode: "LIVE", clientNowMs: Date.now(), serverOffsetMs, pausedAtMs: null });
    setPausedAtMs(pausedAt);
    setClockMode("PAUSED");
    setClockTickMs(Date.now());
  };

  const returnToLive = async () => {
    setClockMode("LIVE");
    setPausedAtMs(null);
    setClockTickMs(Date.now());
    await refreshTransfers();
  };

  const selectFab = (fabId: FabId) => {
    if (clockMode === "PAUSED") return;
    const nextScope = fabScope === fabId ? "CAMPUS" : fabId;
    setFabScope(nextScope);
    replaceCampusUrl(buildTwinHref("/campus", {
      fabScope: nextScope, materialId: allMaterialsMode ? null : material.materialId, facilityId: selectedFacilityId,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: selectedStep?.id, mode: twinMode, referenceTime, cameraPreset,
    }));
  };

  const selectStep = (stepId: string) => {
    if (clockMode === "PAUSED") return;
    updateTwinSelection({ selectedFlowStep: stepId });
    replaceCampusUrl(buildTwinHref("/campus", {
      fabScope, materialId: allMaterialsMode ? null : material.materialId, facilityId: selectedFacilityId,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: stepId, mode: twinMode, referenceTime, cameraPreset,
    }));
  };

  const openFacility = (facilityId: string) => {
    if (clockMode === "PAUSED") return;
    const facility = snapshot.facilities.find((item) => item.id === facilityId);
    const nextFabScope = facility?.fabId ?? fabScope;
    const nextCamera = (facility?.role === "CENTRAL_WMS" ? "WMS_OVERVIEW" : `${facility?.fabId ?? "M20"}_OVERVIEW`) as CameraPreset;
    updateTwinSelection({ selectedFacilityId: facilityId, cameraPreset: nextCamera });
    if (facility?.fabId) setFabScope(facility.fabId);
    if (facility?.role !== "CENTRAL_WMS") {
      replaceCampusUrl(buildTwinHref("/campus", {
        fabScope: nextFabScope, materialId: allMaterialsMode ? null : material.materialId, facilityId,
        lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
        flowStep: selectedStep?.id, mode: twinMode,
        referenceTime, cameraPreset: nextCamera,
      }));
      return;
    }
    const target = `/warehouse/${allMaterialsMode ? "MWH-01" : material.sourceLocations[0]?.facilityId ?? "MWH-01"}`;
    router.push(buildTwinHref(target, {
      fabScope: nextFabScope, materialId: allMaterialsMode ? null : material.materialId, facilityId,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: selectedStep?.id, mode: twinMode, referenceTime, cameraPreset: nextCamera,
    }));
  };

  const openProcess = (fabId: FabId, processCode: string) => {
    if (clockMode === "PAUSED") return;
    setSelectedProcessCode(processCode);
    setFabScope(fabId);
    updateTwinSelection({ selectedFacilityId: `FAB-${fabId}`, cameraPreset: `${fabId}_OVERVIEW` as CameraPreset });
    replaceCampusUrl(buildTwinHref("/campus", {
      fabScope: fabId, materialId: allMaterialsMode ? null : material.materialId, facilityId: `FAB-${fabId}`,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: selectedStep?.id, processCode, mode: twinMode, referenceTime,
      cameraPreset: `${fabId}_OVERVIEW` as CameraPreset,
    }));
  };

  const openWarehouse = (warehouseCode: string) => {
    if (clockMode === "PAUSED") return;
    const source = material.sourceLocations.find((location) => location.facilityId === warehouseCode);
    updateTwinSelection({ selectedFacilityId: warehouseCode, cameraPreset: "WMS_OVERVIEW" });
    router.push(buildTwinHref(`/warehouse/${warehouseCode}`, {
      fabScope, materialId: !allMaterialsMode && source ? material.materialId : null, facilityId: warehouseCode,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: selectedStep?.id, processCode: selectedProcessCode, mode: twinMode,
      referenceTime, cameraPreset: "WMS_OVERVIEW",
    }));
  };

  const focusFab = (fabId: FabId) => {
    if (clockMode === "PAUSED") return;
    setFabScope(fabId);
    updateTwinSelection({ selectedFacilityId: `FAB-${fabId}`, cameraPreset: `${fabId}_OVERVIEW` as CameraPreset });
    replaceCampusUrl(buildTwinHref("/campus", {
      fabScope: fabId, materialId: allMaterialsMode ? null : material.materialId, facilityId: `FAB-${fabId}`,
      lotId: selectedLotId, handlingUnitId: selectedHandlingUnitId, alertId: selectedAlertId,
      flowStep: selectedStep?.id, mode: twinMode, referenceTime,
      cameraPreset: `${fabId}_OVERVIEW` as CameraPreset,
    }));
  };

  const clearProcess = () => {
    setSelectedProcessCode(null);
    focusFab(focusedFabId);
  };

  const focusedFabId: FabId = fabScope === "CAMPUS" ? "M20" : fabScope;
  const usageMaterial = usageTwin.materials.find((item) => item.id === material.materialId);
  const focusedUsages = usageMaterial?.usages.filter((usage) => PRODUCT_TO_FAB[usage.product as keyof typeof PRODUCT_TO_FAB] === focusedFabId) ?? [];

  return (
    <div className="mx-auto max-w-[1540px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.15em] text-[#716C66]">{snapshot.layoutVersion} / 1WMS · 3FAB</div>
          <h1 className="text-[30px] font-black tracking-[-0.045em] text-[#181715]">Campus Material Twin</h1>
          <p className="mt-1 text-xs text-[#6F6A64]">중앙 WMS의 적치·이송과 M20·M21·M22 내부 P01~P10·FOUP/Die Tray를 하나의 운영 장면으로 연결</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`border px-3 py-2 text-[10px] font-black ${materialHasLiveOperation ? "border-[#8FD2BB] bg-[#E9F8F2] text-[#087A55]" : "border-[#E5B65C] bg-[#FFF4D8] text-[#8A5A00]"}`}>
            {materialHasLiveOperation ? "LEDGER + PLAN" : "DERIVED PLAN"}
          </span>
          <span className={`border px-3 py-2 text-[10px] font-black ${visibleTransfers.length ? "border-[#8DB8F5] bg-[#EAF2FF] text-[#1D5FBF]" : "border-[#D8D3CD] bg-[#F7F5F2] text-[#77716A]"}`}>
            TRANSFER FEED · {visibleTransfers.length ? `${visibleTransfers.length}건 / 이송 ${inTransitCount}건` : "활성 이송 없음"}
          </span>
          <Link href="/" className="border border-[#D2CCC5] bg-white px-3 py-2 text-[10px] font-black text-[#3D3935] hover:bg-[#F6F3EF]">← CONTROL TOWER</Link>
        </div>
      </div>

      <div className="mb-4 border border-[#E5B65C] bg-[#FFF9EA] px-4 py-3 text-[11px] leading-5 text-[#74521A]">
        <span className="font-black">{allMaterialsMode ? "전체 자재:" : materialHasLiveOperation ? "운영 원장:" : "계획 장면:"}</span> {allMaterialsMode ? "서로 다른 단위의 수량은 합산하지 않고 모든 실제 활성 TransferOrder와 창고·Fab별 자재 종류를 함께 표시합니다." : materialModeReason}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <section className="overflow-hidden border border-[#D8D3CD] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DEDAD5] px-4 py-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.1em] text-[#272522]">LIVE CAMPUS MATERIAL SCENE</div>
              <div className="mt-1 text-[10px] text-[#817B74]">전체 창고·전체 활성 이송 = 항상 표시 · 선택 SKU = 강조만 적용 · TransferOrder가 없으면 물류 캐리어 정지</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center border border-[#CFCAC4] bg-[#FAF8F5] p-0.5" aria-label="Campus 자재 범위">
                <button type="button" onClick={() => selectMaterial("__ALL__")} className={`px-3 py-1.5 text-[10px] font-black ${allMaterialsMode ? "bg-[#20262D] text-white" : "text-[#6C6862]"}`}>전체 자재</button>
                <select
                  aria-label="Campus 추적 자재"
                  value={allMaterialsMode ? "" : material.materialId}
                  onChange={(event) => event.target.value && selectMaterial(event.target.value)}
                  className={`min-w-[230px] border-0 bg-transparent px-2 py-1 text-xs font-bold outline-none ${allMaterialsMode ? "text-[#8A847D]" : "text-[#24221F]"}`}
                >
                  <option value="">개별 자재 선택</option>
                  {scopedMaterials.map((item) => <option key={item.materialId} value={item.materialId}>{item.code} · {item.name}</option>)}
                </select>
              </div>
              <div className={`flex items-center gap-2 border px-2 py-1.5 ${clockMode === "LIVE" ? "border-[#8FD2BB] bg-[#E9F8F2]" : "border-[#E5B65C] bg-[#FFF4D8]"}`}>
                <span className={`text-[9px] font-black ${clockMode === "LIVE" ? "text-[#087A55]" : "text-[#8A5A00]"}`}>{clockMode}</span>
                <span className="font-mono text-[10px] font-bold text-[#3F4A52]" data-testid="scene-reference-time">{new Date(transferPositionAt).toLocaleString("ko-KR", { hour12: false })}</span>
                {clockMode === "LIVE"
                  ? <button type="button" onClick={pauseScene} className="border-l border-[#AED8C8] pl-2 text-[9px] font-black text-[#087A55]">일시정지</button>
                  : <button type="button" onClick={() => void returnToLive()} className="border-l border-[#E5C77F] pl-2 text-[9px] font-black text-[#8A5A00]">현재로 복귀</button>}
              </div>
            </div>
          </div>
          <div className="h-[650px]">
            <CampusScene3D
              material={allMaterialsMode ? null : material}
              materials={scopedMaterials}
              fabScope={fabScope}
              facilities={snapshot.facilities}
              warehouses={usageTwin.warehouses}
              transfers={visibleTransfers}
              clockMode={clockMode}
              serverOffsetMs={serverOffsetMs}
              pausedAtMs={pausedAtMs}
              equipmentCounts={equipmentCounts}
              onFacilitySelect={openFacility}
              onWarehouseSelect={openWarehouse}
              onProcessSelect={openProcess}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[#DEDAD5] bg-white px-4 py-3">
            <span className="mr-1 text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">ALL WAREHOUSES</span>
            {usageTwin.warehouses.map((warehouse) => {
              const source = !allMaterialsMode ? material.sourceLocations.find((location) => location.facilityId === warehouse.code) : null;
              const warehouseMaterialCount = new Set(scopedMaterials.filter((item) => item.sourceLocations.some((location) => location.facilityId === warehouse.code)).map((item) => item.materialId)).size;
              return <button key={warehouse.code} type="button" disabled={clockMode === "PAUSED"} onClick={() => openWarehouse(warehouse.code)} className={`border px-2 py-1 text-[9px] font-black disabled:cursor-not-allowed ${allMaterialsMode && warehouseMaterialCount ? "border-[#8DB8F5] bg-[#EAF2FF] text-[#1D5FBF]" : source ? "border-[#2F7D63] bg-[#E9F8F2] text-[#087A55]" : "border-[#D8DDE2] bg-[#F5F7F9] text-[#6F7881]"}`} title={warehouse.name}>
                {warehouse.code} · {warehouse.name}{allMaterialsMode ? ` · ${warehouseMaterialCount}종` : source ? ` · ${format(source.quantity)} ${material.unit}` : ""}
              </button>;
            })}
            <span className="ml-auto text-[9px] text-[#8A847D]">{allMaterialsMode ? "파랑 = 보관 자재 있음 · 정지 중 드릴다운 잠금" : "초록 = 선택 SKU 보관 창고 · 회색 = 다른 자재 창고"}</span>
          </div>
          <div className="grid border-t border-[#DEDAD5] bg-[#F8F6F3] md:grid-cols-4">
            {FAB_IDS.map((fabId) => {
              const fab = material.fabs.find((item) => item.fabId === fabId)!;
              const materialCount = scopedMaterials.filter((item) => (item.fabs.find((candidate) => candidate.fabId === fabId)?.dailyUsage ?? 0) > 0).length;
              const processCount = new Set(scopedMaterials.flatMap((item) => item.fabs.find((candidate) => candidate.fabId === fabId)?.processCodes ?? [])).size;
              const transferCount = visibleTransfers.filter((transfer) => transfer.fabId === fabId).length;
              return (
              <button
                key={fabId}
                type="button"
                disabled={clockMode === "PAUSED"}
                onClick={() => selectFab(fabId)}
                className="border-r border-[#DEDAD5] px-4 py-3 text-left hover:bg-white"
              >
                <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">{fabId} {allMaterialsMode ? "전체 흐름" : "계획배분"}</div>
                <div className="mt-1 font-mono text-sm font-black text-[#262420]">{allMaterialsMode ? `${materialCount}종 · 이송 ${transferCount}건` : `${format(fab.plannedAllocation)} ${material.unit}`}</div>
                <div className="mt-1 text-[9px] text-[#817B74]">{allMaterialsMode ? `연결 공정 ${processCount}개 · 단위 합산 안 함` : `${format(fab.dailyUsage)} ${material.unit}/일 · ${fab.processCodes.join(", ") || "공정 미연결"}`}</div>
              </button>
              );
            })}
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
              <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${visibleTransfers.length && clockMode === "LIVE" ? "bg-[#00A86B]" : "bg-[#A9A39C]"}`} />
            </div>
            {visibleTransfers.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <div className="text-xs font-black text-[#625D57]">활성 이송 없음 · 캐리어 정지</div>
                <div className="mt-2 text-[9px] leading-4 text-[#918A83]">MES 자재 요청과 피킹이 발생하면 해당 자재만 이곳과 3D 경로에 나타납니다.</div>
              </div>
            ) : (
              <div className="max-h-[330px] divide-y divide-[#E8E4DF] overflow-y-auto">
                {visibleTransfers.slice(0, 12).map((transfer) => {
                  const position = positionForTransfer(transfer, transferPositionAt);
                  const selected = allMaterialsMode || transfer.materialId === material.materialId;
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
                {visibleTransfers.length > 12 && <div className="px-4 py-2 text-center text-[9px] font-bold text-[#77716A]">외 {visibleTransfers.length - 12}건 동시 렌더링 중</div>}
              </div>
            )}
            <div className="border-t border-[#E8E4DF] px-4 py-2 text-[8px] text-[#918A83]">{clockMode === "LIVE" ? "5초 동기화" : "스냅샷 고정 · 폴링 정지"} · 최근 서버 동기화 {transferSyncAt.slice(11, 19)} UTC</div>
          </section>

          {allMaterialsMode ? <section className="border border-[#D8D3CD] bg-white">
            <div className="border-b border-[#DEDAD5] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#77716A]">ALL MATERIALS SUMMARY</div>
              <div className="mt-1 text-base font-black text-[#24221F]">전체 자재 운영 범위</div>
              <div className="text-[10px] text-[#77716A]">수량 단위 혼합 없이 건수와 종류로 집계</div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-[#DEDAD5]">
              <div className="bg-white p-3"><div className="text-[9px] font-bold text-[#8A847D]">표시 자재</div><div className="mt-1 font-mono text-sm font-black">{scopedMaterials.length}종</div></div>
              <div className="bg-white p-3"><div className="text-[9px] font-bold text-[#8A847D]">활성 Transfer</div><div className="mt-1 font-mono text-sm font-black">{visibleTransfers.length}건</div></div>
              <div className="bg-white p-3"><div className="text-[9px] font-bold text-[#8A847D]">이동 중 HU</div><div className="mt-1 font-mono text-sm font-black">{inTransitCount}건</div></div>
              <div className="bg-white p-3"><div className="text-[9px] font-bold text-[#8A847D]">활성 출발 창고</div><div className="mt-1 font-mono text-sm font-black">{activeWarehouseCount}곳</div></div>
            </div>
            <div className="px-4 py-3 text-[9px] leading-4 text-[#77716A]">현재 Transfer에 포함된 자재 {activeMaterialCount}종 · 개별 수량은 각 Transfer 카드에서 원 단위로 확인</div>
          </section> : <section className="border border-[#D8D3CD] bg-white">
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
          </section>}

          {!allMaterialsMode && <section className="border border-[#D8D3CD] bg-white">
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
          </section>}

          {!allMaterialsMode && <section className="border border-[#D8D3CD] bg-white p-4">
            <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">물리 보관 위치</div>
            <div className="mt-2 space-y-2">
              {material.sourceLocations.map((location) => (
                <div key={location.facilityId} className="flex items-center justify-between text-[10px]"><span className="font-bold text-[#4B4742]">{location.facilityId} · {location.name}</span><span className="font-mono text-[#77716A]">{format(location.quantity)} {material.unit}</span></div>
              ))}
            </div>
          </section>}
        </aside>
      </div>

      {!allMaterialsMode && <section id="fab-detail" className="mt-4 scroll-mt-4 overflow-hidden border border-[#D8D3CD] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DEDAD5] px-4 py-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.1em] text-[#272522]">{focusedFabId} PROCESS + MATERIAL DATA</div>
            <div className="mt-1 text-[10px] text-[#817B74]">아래 사용량은 상단 Campus 3D의 같은 자재·Fab·공정 설비와 직접 연동</div>
          </div>
          <div className="flex items-center gap-1">
            {FAB_IDS.map((fabId) => (
              <button key={fabId} type="button" onClick={() => focusFab(fabId)} className={`px-3 py-1.5 text-[10px] font-black ${focusedFabId === fabId ? "bg-[#20262D] text-white" : "bg-[#EEF1F4] text-[#66717C]"}`}>{fabId}</button>
            ))}
            {selectedProcessCode && <button type="button" onClick={clearProcess} className="ml-2 px-3 py-1.5 text-[10px] font-black text-[#C51636]">공정 필터 해제</button>}
          </div>
        </div>
        <div className="grid gap-px border-t border-[#DEDAD5] bg-[#DEDAD5] sm:grid-cols-2 lg:grid-cols-5">
          {(focusedUsages.length ? focusedUsages : [{ proc: "—", product: focusedFabId, qty: 0 }]).map((usage, index) => (
            <button key={`${usage.proc}-${index}`} type="button" onClick={() => usage.proc !== "—" && openProcess(focusedFabId, usage.proc)} className="bg-white px-4 py-3 text-left hover:bg-[#F8FAFC]">
              <div className="text-[9px] font-black text-[#8A847D]">{usage.proc} · {usage.product}</div>
              <div className="mt-1 font-mono text-sm font-black text-[#252A30]">{usage.qty.toLocaleString()} <span className="text-[9px] font-bold text-[#8A847D]">{material.unit}/월</span></div>
            </button>
          ))}
        </div>
      </section>}
    </div>
  );
}
