import { formatAge, type PilotQueueItemView } from "./pilot-queue-types";

export default function WorkOrderStallBanner({ items, onShowStalled }: {
  items: PilotQueueItemView[];
  onShowStalled: () => void;
}) {
  const stalled = items.filter((item) => item.stallLevel !== "normal");
  if (stalled.length === 0) return null;

  const criticalCount = stalled.filter((item) => item.stallLevel === "critical").length;
  const warnCount = stalled.filter((item) => item.stallLevel === "warn").length;
  const maxAgeMs = Math.max(...stalled.map((item) => item.ageMs));

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E0525F] bg-[#FDEBEC] px-4 py-3">
      <span className="text-lg">⚠</span>
      <div className="text-[11px] font-black text-[#B4232E]">
        M20 파일럿 워크오더 {stalled.length}개가 정체 중 (최대 {formatAge(maxAgeMs)})
      </div>
      <div className="text-[10px] font-bold text-[#8A2A32]">
        {criticalCount > 0 && <>정체 {criticalCount}건</>}
        {criticalCount > 0 && warnCount > 0 && " · "}
        {warnCount > 0 && <>주의 {warnCount}건</>}
      </div>
      <button
        type="button"
        onClick={onShowStalled}
        className="ml-auto rounded bg-[#B4232E] px-3 py-1.5 text-[10px] font-black text-white"
      >
        정체 항목만 보기 →
      </button>
    </div>
  );
}
