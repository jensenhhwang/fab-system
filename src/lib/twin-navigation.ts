import type { FabScope } from "@/components/ControlContext";

export type TwinMode = "LIVE" | "PLAN" | "WHAT_IF";
export type CameraPreset = "CAMPUS_OVERVIEW" | "WMS_OVERVIEW" | "M20_OVERVIEW" | "M21_OVERVIEW" | "M22_OVERVIEW";

export type TwinNavigationState = {
  fabScope: FabScope;
  materialId?: string | null;
  facilityId?: string | null;
  lotId?: string | null;
  handlingUnitId?: string | null;
  alertId?: string | null;
  flowStep?: string | null;
  processCode?: string | null;
  mode?: TwinMode;
  referenceTime?: string | null;
  cameraPreset?: CameraPreset;
};

export function buildTwinHref(pathname: string, state: TwinNavigationState): string {
  const params = new URLSearchParams();
  if (state.fabScope !== "CAMPUS") params.set("fab", state.fabScope);
  if (state.materialId) params.set("material", state.materialId);
  if (state.facilityId) params.set("facility", state.facilityId);
  if (state.lotId) params.set("lot", state.lotId);
  if (state.handlingUnitId) params.set("hu", state.handlingUnitId);
  if (state.alertId) params.set("alert", state.alertId);
  if (state.flowStep) params.set("step", state.flowStep);
  if (state.processCode) params.set("process", state.processCode);
  if (state.mode && state.mode !== "LIVE") params.set("mode", state.mode);
  if (state.referenceTime) params.set("time", state.referenceTime);
  if (state.cameraPreset && state.cameraPreset !== "CAMPUS_OVERVIEW") params.set("camera", state.cameraPreset);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
