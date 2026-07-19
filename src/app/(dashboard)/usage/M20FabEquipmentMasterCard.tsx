import type { M20FabEquipmentMaster } from "@/lib/m20-equipment-capacity-plan";

function loadStyle(load: number) {
  if (load <= 0.85) return { label: "계획 범위", text: "text-[#087A55]", bar: "bg-[#10B981]", bg: "bg-[#F3FBF7]" };
  if (load <= 0.95) return { label: "여유 축소", text: "text-[#9A6700]", bar: "bg-[#F59E0B]", bg: "bg-[#FFFAEB]" };
  if (load <= 1) return { label: "스트레스", text: "text-[#B45309]", bar: "bg-[#F97316]", bg: "bg-[#FFF5ED]" };
  return { label: "CAPA 초과", text: "text-[#C51636]", bar: "bg-[#E11D48]", bg: "bg-[#FFF1F3]" };
}

export default function M20FabEquipmentMasterCard({
  master,
  ledgerCounts,
  selectedProcess,
  onProcessSelect,
}: {
  master: M20FabEquipmentMaster;
  ledgerCounts: Record<string, number>;
  selectedProcess: string | null;
  onProcessSelect: (processCode: string) => void;
}) {
  const ledgerTotal = Object.values(ledgerCounts).reduce((sum, count) => sum + count, 0);
  const assessed = master.processes.filter((process) => process.normalPlannedLoad !== null);
  const peak = assessed.reduce((highest, process) =>
    (process.normalPlannedLoad ?? 0) > (highest.normalPlannedLoad ?? 0) ? process : highest
  );

  return (
    <section className="rounded-xl border border-[#CADAE8] bg-white p-4" data-testid="m20-fab-equipment-master">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black tracking-[0.08em] text-[#1D5F91]">M20 PROCESS EQUIPMENT · PLAN LOAD</div>
          <div className="mt-1 text-sm font-black text-[#243746]">공정별 설비 대수와 NORMAL 117K 생산계획 대비 부하</div>
          <div className="mt-1 text-[9px] text-[#71808B]">실시간 가동률이 아닌 MODELED Capacity 계획 부하입니다.</div>
        </div>
        <div className="flex flex-wrap gap-2 text-[9px] font-black">
          <span className={`rounded-full px-2.5 py-1 ${ledgerTotal === master.totalEquipment ? "bg-[#E9F8F2] text-[#087A55]" : "bg-[#FFECEF] text-[#C51636]"}`}>
            원장 {ledgerTotal} / 정의 {master.totalEquipment}대
          </span>
          <span className="rounded-full bg-[#EAF2FF] px-2.5 py-1 text-[#1D5FBF]">
            최대 평가 부하 {peak.processCode} {((peak.normalPlannedLoad ?? 0) * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {master.processes.map((process) => {
          const load = process.normalPlannedLoad;
          const ledgerCount = ledgerCounts[process.processCode];
          const ledgerMatches = ledgerCount === process.definedCount;
          const selected = selectedProcess === process.processCode;
          const pendingReason = process.processCode === "P05" ? "Capacity visit 미정" : "Die/Stack native unit 필요";
          const style = load === null ? null : loadStyle(load);
          const bottleneckStage = process.capacityStages.find((stage) => stage.stageCode === process.bottleneckCapacityStage);
          return (
            <button
              key={process.processCode}
              type="button"
              aria-pressed={selected}
              onClick={() => onProcessSelect(process.processCode)}
              className={`rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${selected ? "border-[#1D5FBF] ring-2 ring-[#BFD5FF]" : "border-[#DDE5EB]"} ${style?.bg ?? "bg-[#F5F7F9]"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-[11px] font-black text-[#283A48]">{process.processCode}</div>
                  <div className="mt-0.5 text-[10px] font-bold text-[#596975]">{process.name}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg font-black text-[#1D5FBF]">{process.definedCount}대</div>
                  <div className={`text-[8px] font-bold ${ledgerMatches ? "text-[#087A55]" : "text-[#C51636]"}`}>
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
                  {process.processCode === "P10" && (
                    <div className="mt-1 text-right text-[8px] font-bold text-[#9A6700]">Base Die Attach CAPA · 검증 대기</div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E1E7EC] pt-2 text-[8px] text-[#78858F]">
        <span>계획 부하율 = 117,000 WSPM ÷ 공정별 모델 지원 WSPM · 잔여율 = 1 − 계획 부하율</span>
        <span>기준선 85% · INDUSTRY_RANGE_INFORMED_MODELED_BASELINE</span>
      </div>
    </section>
  );
}
