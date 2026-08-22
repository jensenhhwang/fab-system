import type { FabEquipmentMasterView } from "@/lib/fab-equipment-master-view";
import type { BayLoad } from "@/lib/process-bay-load";

// 계획 부하만 보여주면 "모든 공정이 계획 범위에서 고르게 돈다"로 읽히는데, 실제 WIP은 한두
// 공정에 몰려 있을 수 있다(실측 2026-08-12 M20: 계획은 전 공정 70~85%인데 실제 WIP은 P03
// 45.6%·P07 36.6%에 몰리고 P02·P04는 0%). 같은 축(processCode)에 실측을 같이 얹어 그 간극과
// 원인을 카드에서 바로 읽게 한다(§lib/process-bay-load).
const REASON_LABEL: Record<BayLoad["reason"], { text: string; cls: string }> = {
  MATERIAL_BLOCKED: { text: "자재 대기", cls: "bg-[#FFF1F3] text-[#C51636]" },
  CAPACITY_TIGHT:   { text: "설비 빠듯", cls: "bg-[#FFF5ED] text-[#B45309]" },
  CONGESTED:        { text: "적체",     cls: "bg-[#FFFAEB] text-[#9A6700]" },
  STARVED:          { text: "굶는 중",  cls: "bg-[#F2F4F6] text-[#52616C]" },
  NORMAL:           { text: "",        cls: "" },
};

function loadStyle(load: number) {
  if (load <= 0.85) return { label: "계획 범위", text: "text-[#087A55]", bar: "bg-[#10B981]", bg: "bg-[#F3FBF7]" };
  if (load <= 0.95) return { label: "여유 축소", text: "text-[#9A6700]", bar: "bg-[#F59E0B]", bg: "bg-[#FFFAEB]" };
  if (load <= 1) return { label: "스트레스", text: "text-[#B45309]", bar: "bg-[#F97316]", bg: "bg-[#FFF5ED]" };
  return { label: "CAPA 초과", text: "text-[#C51636]", bar: "bg-[#E11D48]", bg: "bg-[#FFF1F3]" };
}

export default function FabEquipmentMasterCard({
  master,
  ledgerCounts,
  selectedProcess,
  onProcessSelect,
  bayLoads = [],
}: {
  master: FabEquipmentMasterView;
  ledgerCounts: Record<string, number>;
  selectedProcess: string | null;
  onProcessSelect: (processCode: string) => void;
  bayLoads?: BayLoad[];
}) {
  const bayLoadByProcess = new Map(bayLoads.map((load) => [load.processCode, load]));
  const ledgerTotal = Object.values(ledgerCounts).reduce((sum, count) => sum + count, 0);
  const assessed = master.processes.filter((process) => process.normalPlannedLoad !== null);
  const peak = assessed.length
    ? assessed.reduce((highest, process) => (process.normalPlannedLoad ?? 0) > (highest.normalPlannedLoad ?? 0) ? process : highest)
    : null;

  return (
    <section className="rounded-xl border border-[#CADAE8] bg-white p-4" data-testid={`${master.fabId.toLowerCase()}-fab-equipment-master`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black tracking-[0.08em] text-[#1D5F91]">{master.fabId} PROCESS EQUIPMENT · PLAN LOAD</div>
          <div className="mt-1 text-sm font-black text-[#243746]">공정별 설비 대수와 생산계획 대비 부하</div>
          <div className="mt-1 text-[9px] text-[#71808B]">실시간 가동률이 아닌 MODELED Capacity 계획 부하입니다.</div>
        </div>
        <div className="flex flex-wrap gap-2 text-[9px] font-black">
          <span className="rounded-full bg-[#F2F4F6] px-2.5 py-1 text-[#52616C]">
            생산 계획 {master.normalWspm.toLocaleString()} WSPM
          </span>
          <span className={`rounded-full px-2.5 py-1 ${ledgerTotal === master.totalEquipment ? "bg-[#E9F8F2] text-[#087A55]" : "bg-[#FFECEF] text-[#C51636]"}`}>
            원장 {ledgerTotal} / 정의 {master.totalEquipment}대
          </span>
          {peak && (
            <span className="rounded-full bg-[#EAF2FF] px-2.5 py-1 text-[#1D5FBF]">
              최대 평가 부하 {peak.processCode} {((peak.normalPlannedLoad ?? 0) * 100).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {master.processes.map((process) => {
          const load = process.normalPlannedLoad;
          const ledgerCount = ledgerCounts[process.processCode];
          const ledgerMatches = ledgerCount === process.definedCount;
          const selected = selectedProcess === process.processCode;
          const pendingReason = process.pendingReason
            ?? (process.processCode === "P05" ? "Capacity visit 미정" : "Die/Stack native unit 필요");
          const style = load === null ? null : loadStyle(load);
          const bottleneckStage = process.capacityStages.find((stage) => stage.stageCode === process.bottleneckCapacityStage);
          const bayLoad = bayLoadByProcess.get(process.processCode);
          return (
            <button
              key={process.processCode}
              type="button"
              aria-pressed={selected}
              onClick={() => onProcessSelect(process.processCode)}
              className={`rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${selected ? "border-[#1D5FBF] ring-2 ring-[#BFD5FF]" : "border-[#DDE5EB]"} ${style?.bg ?? "bg-[#F5F7F9]"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-black text-[#283A48]">{process.processCode}</div>
                  <div className="mt-0.5 text-[10px] font-bold text-[#596975]">{process.name}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="whitespace-nowrap font-mono text-lg font-black text-[#1D5FBF]">{process.definedCount}대</div>
                  <div className={`whitespace-nowrap text-[8px] font-bold ${ledgerMatches ? "text-[#087A55]" : "text-[#C51636]"}`}>
                    {ledgerCount === undefined ? "원장 미연결" : ledgerMatches ? "원장 일치" : `원장 ${ledgerCount}대`}
                  </div>
                </div>
              </div>

              {load === null ? (
                <div className="mt-4 rounded bg-white/70 px-2 py-3 text-center">
                  <div className="text-[10px] font-black text-[#687783]">계획 부하 N/A</div>
                  <div className="mt-1 text-[8px] text-[#89959E]">평가 보류 · {pendingReason}</div>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="flex items-end justify-between gap-2">
                    <div className={`text-[9px] font-black ${style?.text}`}>{style?.label}</div>
                    <div className="text-right font-mono">
                      <span className={`text-base font-black ${style?.text}`}>{(load * 100).toFixed(1)}%</span>
                      <span className="ml-1 text-[8px] text-[#7D8992]">부하</span>
                    </div>
                  </div>
                  <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white">
                    <div className={`h-full rounded-full ${style?.bar}`} style={{ width: `${Math.min(100, load * 100)}%` }} />
                    <div className="absolute inset-y-0 left-[85%] w-px bg-[#64748B]/60" title="계획 상한 85%" />
                  </div>
                  <div className="mt-1.5 text-right font-mono text-[9px] font-bold text-[#52616C]">
                    Capacity 잔여 {((1 - load) * 100).toFixed(1)}%
                  </div>
                  {bottleneckStage && (
                    <div className="mt-1 text-right text-[8px] font-bold text-[#7E22CE]">병목 · {bottleneckStage.name}</div>
                  )}
                  {bayLoad && (
                    <div className="mt-2 border-t border-white/70 pt-1.5">
                      <div className="flex items-center justify-between text-[8px]">
                        <span className="text-[#7D8992]">실제 WIP</span>
                        <span className="font-mono font-black text-[#283A48]">{Math.round(bayLoad.wipCount).toLocaleString()}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[8px]">
                        <span className="text-[#7D8992]">흐름 기대 대비</span>
                        <span className={`font-mono font-black ${bayLoad.deviationPp > 0 ? "text-[#C51636]" : bayLoad.deviationPp < 0 ? "text-[#1D5FBF]" : "text-[#52616C]"}`}>
                          {bayLoad.deviationPp >= 0 ? "+" : ""}{bayLoad.deviationPp.toFixed(1)}%p
                        </span>
                      </div>
                      {bayLoad.reason !== "NORMAL" && (
                        <div className={`mt-1 rounded px-1.5 py-0.5 text-center text-[8px] font-black ${REASON_LABEL[bayLoad.reason].cls}`}>
                          {REASON_LABEL[bayLoad.reason].text}
                          {bayLoad.blockingMaterialIds.length > 0 && ` · ${bayLoad.blockingMaterialIds.join(", ")}`}
                        </div>
                      )}
                    </div>
                  )}
                  {master.fabId === "M20" && process.processCode === "P10" && (
                    <div className="mt-1 text-right text-[8px] font-bold text-[#9A6700]">Base Die Attach CAPA · 검증 대기</div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E1E7EC] pt-2 text-[8px] text-[#78858F]">
        <span>계획 부하율 = {master.normalWspm.toLocaleString()} WSPM ÷ 공정별 모델 지원 WSPM · 잔여율 = 1 − 계획 부하율</span>
        <span>기준선 85% · INDUSTRY_RANGE_INFORMED_MODELED_BASELINE</span>
      </div>
    </section>
  );
}
