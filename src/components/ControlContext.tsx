"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { FabId } from "@/lib/control-tower";
import type { CameraPreset, TwinMode } from "@/lib/twin-navigation";

export type FabScope = "CAMPUS" | FabId;

type ControlContextValue = {
  fabScope: FabScope;
  setFabScope: (scope: FabScope) => void;
  selectedMaterialId: string | null;
  setSelectedMaterialId: (materialId: string | null) => void;
  selectedFacilityId: string | null;
  selectedLotId: string | null;
  selectedHandlingUnitId: string | null;
  selectedAlertId: string | null;
  selectedFlowStep: string | null;
  twinMode: TwinMode;
  referenceTime: string | null;
  cameraPreset: CameraPreset;
  updateTwinSelection: (selection: Partial<{
    selectedFacilityId: string | null;
    selectedLotId: string | null;
    selectedHandlingUnitId: string | null;
    selectedAlertId: string | null;
    selectedFlowStep: string | null;
    twinMode: TwinMode;
    referenceTime: string | null;
    cameraPreset: CameraPreset;
  }>) => void;
};

const ControlContext = createContext<ControlContextValue | null>(null);

export function ControlContextProvider({ children }: { children: React.ReactNode }) {
  const [fabScope, setFabScope] = useState<FabScope>("CAMPUS");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [twinSelection, setTwinSelection] = useState({
    selectedFacilityId: null as string | null,
    selectedLotId: null as string | null,
    selectedHandlingUnitId: null as string | null,
    selectedAlertId: null as string | null,
    selectedFlowStep: null as string | null,
    twinMode: "LIVE" as TwinMode,
    referenceTime: null as string | null,
    cameraPreset: "CAMPUS_OVERVIEW" as CameraPreset,
  });
  const updateTwinSelection: ControlContextValue["updateTwinSelection"] = useCallback((selection) => {
    setTwinSelection((current) => ({ ...current, ...selection }));
  }, []);
  const value = useMemo(
    () => ({ fabScope, setFabScope, selectedMaterialId, setSelectedMaterialId, ...twinSelection, updateTwinSelection }),
    [fabScope, selectedMaterialId, twinSelection, updateTwinSelection],
  );
  return <ControlContext.Provider value={value}>{children}</ControlContext.Provider>;
}

export function useControlContext() {
  const context = useContext(ControlContext);
  if (!context) throw new Error("useControlContext must be used inside ControlContextProvider");
  return context;
}

export function FabScopeControl() {
  const { fabScope, setFabScope } = useControlContext();
  const scopes: FabScope[] = ["CAMPUS", "M20", "M21", "M22"];
  return (
    <div className="flex items-center rounded-md border border-[#D9D5D0] bg-white p-0.5" aria-label="Fab 범위 선택">
      {scopes.map((scope) => (
        <button
          key={scope}
          type="button"
          onClick={() => setFabScope(scope)}
          className={`rounded px-2.5 py-1 text-[10px] font-bold tracking-[0.04em] transition-colors ${
            fabScope === scope ? "bg-[#191918] text-white" : "text-[#6B6762] hover:bg-[#F3F0EE]"
          }`}
        >
          {scope}
        </button>
      ))}
    </div>
  );
}
