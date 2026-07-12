"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { runMaterialScenario, type ProductDemand, type ScenarioMaterial, type ScenarioResult } from "@/lib/scenario-engine";

type View = "summary" | "material" | "warehouse" | "process" | "value";
type ProcessUsage = { materialId: string; materialName: string; processCode: string; product: keyof ProductDemand; monthlyQty: number };
type Warehouse = { code: string; name: string; occupancy: number; totalCapacity: number; utilization: number };
type ScenarioSet = { material: ScenarioMaterial; results: [ScenarioResult, ScenarioResult, ScenarioResult] };

const COLORS = ["#777", "#3B82F6", "#EA002C"];
const TABS: { id: View; label: string }[] = [
  { id: "summary", label: "종합" }, { id: "material", label: "자재 재고" }, { id: "warehouse", label: "창고" },
  { id: "process", label: "공정 영향" }, { id: "value", label: "예상 성과" },
];
const PLAN_NAMES = ["현재 계획", "대응안 A", "대응안 B"];
const PRODUCT_STYLE: Record<keyof ProductDemand, { color: string; soft: string }> = {
  HBM: { color: "#EA002C", soft: "#FFF0F2" },
  DRAM: { color: "#3B82F6", soft: "#EFF6FF" },
  NAND: { color: "#8B5CF6", soft: "#F5F3FF" },
};

function dayLabel(day: number | null) { return day === null ? "기간 내 없음" : day === 0 ? "이미 하회" : `${day}일 후`; }
function num(value: number) { return Math.round(value).toLocaleString(); }
function percent(value: number) { return `${Math.max(0, Math.round(value))}%`; }

function ScenarioChart({ results }: { results: ScenarioResult[] }) {
  const W=760,H=250,P={l:56,r:20,t:20,b:34}; const max=Math.max(...results.flatMap(r=>r.points.map(p=>p.closing)),1);
  const x=(d:number)=>P.l+d/90*(W-P.l-P.r); const y=(q:number)=>P.t+(1-q/max)*(H-P.t-P.b);
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[250px]">
    {[0,.25,.5,.75,1].map(f=><g key={f}><line x1={P.l} y1={y(max*f)} x2={W-P.r} y2={y(max*f)} stroke="#EAE6E2"/><text x={P.l-7} y={y(max*f)+4} textAnchor="end" fontSize="10" fill="#888">{num(max*f)}</text></g>)}
    {[0,30,60,90].map(d=><text key={d} x={x(d)} y={H-10} textAnchor="middle" fontSize="10" fill="#888">D+{d}</text>)}
    {results.map((r,i)=><polyline key={r.name} fill="none" stroke={COLORS[i]} strokeWidth={i===0?2:3} points={r.points.map(p=>`${x(p.day)},${y(p.closing)}`).join(" ")} />)}
  </svg>;
}

function QualityBadge({ quality = "ESTIMATED" }: { quality?: "CALCULATED" | "ESTIMATED" | "UNAVAILABLE" }) {
  const styles = quality === "CALCULATED" ? "bg-emerald-50 text-emerald-700" : quality === "ESTIMATED" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500";
  const label = quality === "CALCULATED" ? "계산값" : quality === "ESTIMATED" ? "추정값" : "계산 불가";
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${styles}`}>{label}</span>;
}

function DemandControl({ product, value, onChange }: { product: keyof ProductDemand; value: number; onChange: (value: number) => void }) {
  const style = PRODUCT_STYLE[product];
  const setValue = (raw: string | number) => {
    const parsed = typeof raw === "number" ? raw : Number(raw);
    onChange(Number.isFinite(parsed) ? Math.max(-50, Math.min(50, Math.round(parsed))) : 0);
  };
  return <div className="mb-6 last:mb-0">
    <div className="flex items-center justify-between mb-3">
      <span className="font-extrabold" style={{ color: style.color }}>{product}</span>
      <div className="relative">
        <input type="number" min="-50" max="50" step="1" value={value} onChange={(event) => setValue(event.target.value)}
          className="w-[86px] rounded-xl px-3 py-2 pr-7 text-right text-sm font-extrabold outline-none border-2 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          style={{ color: style.color, backgroundColor: style.soft, borderColor: style.color }} aria-label={`${product} 수요 변화율 직접 입력`} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold pointer-events-none" style={{ color: style.color }}>%</span>
      </div>
    </div>
    <input type="range" min="-50" max="50" step="1" value={value} onChange={(event) => setValue(event.target.value)} className="w-full" style={{ accentColor: style.color }} aria-label={`${product} 수요 변화율 슬라이더`} />
    <div className="flex justify-between text-[10px] text-[#AAA] mt-1"><span>-50%</span><span>0</span><span>+50%</span></div>
    <div className="flex gap-1.5 mt-2">
      {[-30,-10,0,10,30].map((preset) => <button type="button" key={preset} onClick={() => setValue(preset)}
        className="flex-1 rounded-lg border py-1 text-[10px] font-bold transition-colors"
        style={{ borderColor: value === preset ? style.color : "var(--border)", color: value === preset ? style.color : "#888", backgroundColor: value === preset ? style.soft : "white" }}>
        {preset > 0 ? `+${preset}` : preset}%
      </button>)}
    </div>
  </div>;
}

export default function OperationalScenarioClient({ materials, processUsages, warehouses, snapshotAt }: { materials: ScenarioMaterial[]; processUsages: ProcessUsage[]; warehouses: Warehouse[]; snapshotAt: string }) {
  const [view,setView]=useState<View>("summary");
  const [materialId,setMaterialId]=useState(materials[0]?.id ?? "");
  const [warehouseCode,setWarehouseCode]=useState(warehouses[0]?.code ?? "");
  const [processCode,setProcessCode]=useState(processUsages[0]?.processCode ?? "");
  const [demand,setDemand]=useState<ProductDemand>({HBM:30,DRAM:0,NAND:0});
  const [a,setA]=useState({qty:"0",day:"7"}); const [b,setB]=useState({qty:"0",day:"14"});
  const material=materials.find(m=>m.id===materialId) ?? materials[0];

  const scenarioSets = useMemo<ScenarioSet[]>(() => materials.map((item) => ({ material: item, results: [
    runMaterialScenario(item,{name:"현재 계획",inboundQuantity:0,inboundDay:-1,demand:{HBM:0,DRAM:0,NAND:0}}),
    runMaterialScenario(item,{name:"대응안 A",inboundQuantity:item.id===materialId?Number(a.qty)||0:0,inboundDay:Number(a.day)||0,demand}),
    runMaterialScenario(item,{name:"대응안 B",inboundQuantity:item.id===materialId?Number(b.qty)||0:0,inboundDay:Number(b.day)||0,demand}),
  ] })),[materials,materialId,a,b,demand]);
  const selectedSet=scenarioSets.find(s=>s.material.id===materialId) ?? scenarioSets[0];

  const summary = useMemo(() => PLAN_NAMES.map((name,index) => {
    const risky=scenarioSets.filter(set=>set.results[index].firstStockoutDay!==null);
    const first=risky.reduce<number|null>((min,set)=>{const day=set.results[index].firstStockoutDay; return day===null?min:min===null?day:Math.min(min,day)},null);
    return {name,shortages:risky.length,first};
  }),[scenarioSets]);

  const processImpact=useMemo(()=>{
    const map=new Map<string,{base:number;adjusted:number;materials:Set<string>}>();
    for(const usage of processUsages){const item=map.get(usage.processCode)??{base:0,adjusted:0,materials:new Set<string>()}; item.base+=usage.monthlyQty; item.adjusted+=usage.monthlyQty*(1+demand[usage.product]/100); item.materials.add(usage.materialName); map.set(usage.processCode,item);}
    return [...map.entries()].map(([code,v])=>({code,...v,delta:v.adjusted-v.base,pct:v.base?((v.adjusted-v.base)/v.base)*100:0})).sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta));
  },[processUsages,demand]);

  const warehouseImpact=useMemo(()=>warehouses.map(warehouse=>{
    const related=scenarioSets.filter(set=>set.material.warehouseCode===warehouse.code);
    const projected=PLAN_NAMES.map((_,index)=>{
      const delta=related.reduce((sum,set)=>sum+(set.results[index].endingQuantity-set.results[0].endingQuantity)*set.material.occupancyFactor,0);
      return warehouse.totalCapacity>0?((warehouse.occupancy+delta)/warehouse.totalCapacity)*100:warehouse.utilization;
    });
    return {...warehouse,projected,affected:related.filter(set=>Math.abs(set.results[1].endingQuantity-set.results[0].endingQuantity)>0.01||Math.abs(set.results[2].endingQuantity-set.results[0].endingQuantity)>0.01).map(set=>set.material.name)};
  }),[warehouses,scenarioSets]);

  if(!material||!selectedSet) return <div className="bg-white rounded-2xl p-10 text-center">시뮬레이션할 재고 데이터가 없습니다.</div>;
  function openMaterial(id:string){setMaterialId(id);setView("material")}
  function openWarehouse(code:string){setWarehouseCode(code);setView("warehouse")}
  function openProcess(code:string){setProcessCode(code);setView("process")}

  return <div>
    <div className="flex items-end justify-between mb-7"><div><div className="text-2xl font-extrabold tracking-tight">통합 운영 시나리오</div><div className="text-sm text-[#777] mt-1">하나의 조건을 자재·창고·공정 관점에서 함께 분석합니다.</div></div><div className="text-right text-xs text-[#777]"><div className="font-bold text-[#00875A]">실제 운영 데이터 기준</div><div>{new Date(snapshotAt).toLocaleString("ko-KR")} · 90일</div></div></div>
    <div className="grid grid-cols-5 gap-5">
      <div className="col-span-2 space-y-4">
        <section className="bg-white rounded-2xl border border-[var(--border)] p-5"><div className="text-[11px] uppercase tracking-[.08em] font-bold text-[#777] mb-3">1. 추가 입고 대상</div><select value={materialId} onChange={e=>setMaterialId(e.target.value)} className="w-full border rounded-xl px-3 py-2.5 text-sm">{materials.map(m=><option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select><div className="grid grid-cols-2 gap-3 mt-4 text-xs"><div className="bg-[#F8F6F4] rounded-xl p-3"><div className="text-[#888]">현재 재고</div><div className="font-bold mt-1">{num(material.currentQuantity)} {material.unit}</div></div><div className="bg-[#F8F6F4] rounded-xl p-3"><div className="text-[#888]">기준 일사용량</div><div className="font-bold mt-1">{material.baseDailyUsage.toFixed(1)} {material.unit}</div></div></div></section>
        <section className="bg-white rounded-2xl border border-[var(--border)] p-5"><div className="flex items-center justify-between mb-5"><div className="text-[11px] uppercase tracking-[.08em] font-bold text-[#777]">2. 상황 조건 · 제품 수요</div><button type="button" onClick={() => setDemand({ HBM: 0, DRAM: 0, NAND: 0 })} className="text-[11px] text-[#888] underline">초기화</button></div>{(["HBM","DRAM","NAND"] as const).map(product=><DemandControl key={product} product={product} value={demand[product]} onChange={(value)=>setDemand((current)=>({...current,[product]:value}))}/>)}</section>
        <section className="bg-white rounded-2xl border border-[var(--border)] p-5"><div className="text-[11px] uppercase tracking-[.08em] font-bold text-[#777] mb-4">3. 대응안</div>{[["A",a,setA],["B",b,setB]].map(([name,value,setter])=>{const v=value as typeof a;const set=setter as typeof setA;return <div key={name as string} className="grid grid-cols-[60px_1fr_1fr] gap-2 items-end mb-3"><div className="font-bold text-sm pb-2">대응안 {name as string}</div><label className="text-[10px] text-[#777]">추가 입고량<input type="number" min="0" value={v.qty} onChange={e=>set({...v,qty:e.target.value})} className="mt-1 w-full border rounded-lg px-2 py-2 text-sm text-[#222]"/></label><label className="text-[10px] text-[#777]">입고일(D+)<input type="number" min="0" max="90" value={v.day} onChange={e=>set({...v,day:e.target.value})} className="mt-1 w-full border rounded-lg px-2 py-2 text-sm text-[#222]"/></label></div>})}</section>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><div className="font-bold mb-1">MVP 계산 기준</div>월사용량의 일 균등 환산과 현재 Capacity 환산표를 사용합니다. 확정 입고·로트 FEFO 연결 전 수치는 예측 초안입니다.</div>
      </div>
      <div className="col-span-3">
        <div className="bg-white rounded-2xl border border-[var(--border)] overflow-hidden min-h-[680px]">
          <div className="flex border-b border-[var(--border)] px-3 pt-2">{TABS.map(tab=><button key={tab.id} onClick={()=>setView(tab.id)} className={`px-4 py-3 text-sm font-bold border-b-2 ${view===tab.id?"border-[#EA002C] text-[#EA002C]":"border-transparent text-[#777]"}`}>{tab.label}</button>)}</div>
          <div className="p-5">
            {view==="summary"&&<SummaryView summary={summary} sets={scenarioSets} warehouseImpact={warehouseImpact} processImpact={processImpact} openMaterial={openMaterial} openWarehouse={openWarehouse} openProcess={openProcess}/>} 
            {view==="material"&&<MaterialView material={material} results={selectedSet.results} materials={materials} onSelect={setMaterialId}/>} 
            {view==="warehouse"&&<WarehouseView data={warehouseImpact} selected={warehouseCode} onSelect={setWarehouseCode}/>} 
            {view==="process"&&<ProcessView data={processImpact} selected={processCode} onSelect={setProcessCode}/>} 
            {view==="value"&&<ValueView summary={summary} aQty={Number(a.qty)||0} bQty={Number(b.qty)||0} unit={material.unit}/>} 
          </div>
        </div>
      </div>
    </div>
  </div>;
}

function SummaryView({summary,sets,warehouseImpact,processImpact,openMaterial,openWarehouse,openProcess}:{summary:{name:string;shortages:number;first:number|null}[];sets:ScenarioSet[];warehouseImpact:(Warehouse&{projected:number[];affected:string[]})[];processImpact:{code:string;delta:number;pct:number}[];openMaterial:(id:string)=>void;openWarehouse:(code:string)=>void;openProcess:(code:string)=>void}){
  const risks=sets.filter(set=>set.results[1].firstStockoutDay!==null||set.results[2].firstStockoutDay!==null).slice(0,5);
  const peak=[0,1,2].map(i=>Math.max(...warehouseImpact.map(w=>w.projected[i]),0));
  return <div><div className="text-lg font-extrabold">시나리오 결론</div><div className="text-xs text-[#888] mt-1">현재 계획과 두 대응안을 동일한 계산 기준으로 비교합니다.</div>
    <div className="grid grid-cols-3 gap-3 mt-5">{summary.map((item,i)=><div key={item.name} className="rounded-xl border p-4" style={{borderColor:COLORS[i]+"55"}}><div className="text-xs font-bold" style={{color:COLORS[i]}}>{item.name}</div><div className="text-2xl font-extrabold mt-3">{item.shortages}종</div><div className="text-xs text-[#777]">90일 내 결품 예상</div><div className="mt-3 text-xs">최초 결품 <b>{dayLabel(item.first)}</b></div><div className="mt-1 text-xs">최대 창고점유 <b>{percent(peak[i])}</b> <QualityBadge/></div></div>)}</div>
    <div className="grid grid-cols-2 gap-4 mt-5"><div className="border rounded-xl p-4"><div className="font-bold text-sm">우선 확인 자재</div><div className="mt-3 space-y-2">{risks.length?risks.map(set=><button key={set.material.id} onClick={()=>openMaterial(set.material.id)} className="w-full flex justify-between text-xs hover:text-[#EA002C]"><span>{set.material.name}</span><span>{dayLabel(set.results[1].firstStockoutDay)}</span></button>):<div className="text-xs text-[#999]">선택한 대응안에서 결품 위험이 없습니다.</div>}</div></div>
      <div className="border rounded-xl p-4"><div className="font-bold text-sm">영향 지점</div><div className="mt-3 space-y-2">{warehouseImpact.slice().sort((a,b)=>Math.max(...b.projected)-Math.max(...a.projected)).slice(0,2).map(w=><button key={w.code} onClick={()=>openWarehouse(w.code)} className="w-full flex justify-between text-xs"><span>{w.code} · {w.name}</span><span>{percent(Math.max(...w.projected))}</span></button>)}{processImpact.slice(0,2).map(p=><button key={p.code} onClick={()=>openProcess(p.code)} className="w-full flex justify-between text-xs"><span>{p.code} 공정</span><span>{p.pct>=0?"+":""}{p.pct.toFixed(1)}%</span></button>)}</div></div></div>
  </div>
}

function MaterialView({material,results,materials,onSelect}:{material:ScenarioMaterial;results:ScenarioResult[];materials:ScenarioMaterial[];onSelect:(id:string)=>void}){
  return <div><div className="flex justify-between items-start"><div><div className="text-lg font-extrabold">자재별 재고 전망</div><div className="text-xs text-[#888] mt-1">수요 변화와 추가 입고가 DOH·결품일에 미치는 영향</div></div><select value={material.id} onChange={e=>onSelect(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">{materials.map(m=><option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select></div>
    <div className="flex justify-end gap-3 text-[11px] mt-4">{PLAN_NAMES.map((n,i)=><span key={n} style={{color:COLORS[i]}}>● {n}</span>)}</div><ScenarioChart results={results}/>
    <div className="border rounded-xl overflow-hidden mt-2"><div className="grid grid-cols-4 bg-[#F8F6F4] text-[11px] font-bold text-[#777] px-4 py-3"><div>비교 지표</div>{results.map(r=><div key={r.name} className="text-right">{r.name}</div>)}</div>{[["적용 일사용량",...results.map(r=>`${r.effectiveDailyUsage.toFixed(1)} ${material.unit}`)],["안전재고 하회",...results.map(r=>dayLabel(r.firstSafetyStockDay))],["최초 결품",...results.map(r=>dayLabel(r.firstStockoutDay))],["90일 후 재고",...results.map(r=>`${num(r.endingQuantity)} ${material.unit}`)]].map(row=><div key={row[0]} className="grid grid-cols-4 px-4 py-3 border-t text-sm"><div className="text-[#777]">{row[0]}</div>{row.slice(1).map((v,i)=><div key={i} className="text-right font-bold">{v}</div>)}</div>)}</div>
  </div>
}

function WarehouseView({data,selected,onSelect}:{data:(Warehouse&{projected:number[];affected:string[]})[];selected:string;onSelect:(code:string)=>void}){
  const warehouse=data.find(w=>w.code===selected)??data[0];
  return <div><div className="flex justify-between"><div><div className="text-lg font-extrabold">창고 영향</div><div className="text-xs text-[#888] mt-1">90일 말 재고 변화 기준 점유율 추정</div></div><QualityBadge/></div><div className="grid grid-cols-2 gap-3 mt-5">{data.map(w=><button key={w.code} onClick={()=>onSelect(w.code)} className={`text-left border rounded-xl p-4 ${warehouse?.code===w.code?"border-[#EA002C] bg-[#FFF8F8]":""}`}><div className="flex justify-between"><b className="text-sm">{w.code}</b><span className="text-xs text-[#888]">현재 {w.utilization}%</span></div><div className="text-xs text-[#777] mt-1">{w.name}</div><div className="grid grid-cols-3 gap-1 mt-3 text-center">{w.projected.map((v,i)=><div key={i}><div className="text-[10px] text-[#999]">{PLAN_NAMES[i]}</div><div className="font-bold mt-1" style={{color:COLORS[i]}}>{percent(v)}</div></div>)}</div></button>)}</div>{warehouse&&<div className="mt-5 border rounded-xl p-4"><div className="font-bold text-sm">{warehouse.code} 계산 근거</div><div className="text-xs text-[#777] mt-2">현재 점유 {num(warehouse.occupancy)} / 용량 {num(warehouse.totalCapacity)} · 자재별 Capacity 환산계수 적용</div><div className="text-xs mt-3">영향 자재: {warehouse.affected.length?warehouse.affected.join(", "):"추가 입고 영향 없음"}</div><div className="text-[11px] text-amber-700 mt-3">생산·소비로 비워지는 실제 저장 위치와 입고 배치는 아직 반영되지 않은 추정치입니다.</div><Link href={`/warehouse/${warehouse.code}`} className="inline-block mt-3 text-xs font-bold text-[#EA002C]">창고 상세 보기 →</Link></div>}</div>
}

function ProcessView({data,selected,onSelect}:{data:{code:string;base:number;adjusted:number;delta:number;pct:number;materials:Set<string>}[];selected:string;onSelect:(code:string)=>void}){
  const proc=data.find(p=>p.code===selected)??data[0];
  return <div><div className="flex justify-between"><div><div className="text-lg font-extrabold">공정 영향</div><div className="text-xs text-[#888] mt-1">제품 수요 변화가 ProcessUsage에 미치는 영향</div></div><QualityBadge quality="CALCULATED"/></div><div className="mt-5 space-y-2">{data.map(p=><button key={p.code} onClick={()=>onSelect(p.code)} className={`w-full grid grid-cols-[60px_1fr_90px] items-center gap-3 border rounded-xl px-4 py-3 ${proc?.code===p.code?"border-[#EA002C] bg-[#FFF8F8]":""}`}><b className="text-sm">{p.code}</b><div className="h-2 bg-[#EEE] rounded-full overflow-hidden"><div className="h-full bg-[#EA002C]" style={{width:`${Math.min(100,Math.abs(p.pct)*2)}%`}}/></div><span className="text-right text-xs font-bold">{p.pct>=0?"+":""}{p.pct.toFixed(1)}%</span></button>)}</div>{proc&&<div className="mt-5 border rounded-xl p-4 text-xs"><div className="font-bold text-sm">{proc.code} 상세</div><div className="grid grid-cols-2 gap-2 mt-3"><span className="text-[#777]">기준 월사용량</span><b className="text-right">{num(proc.base)}</b><span className="text-[#777]">변경 후 월사용량</span><b className="text-right">{num(proc.adjusted)}</b><span className="text-[#777]">관련 자재</span><b className="text-right">{[...proc.materials].slice(0,4).join(", ")}</b></div></div>}</div>
}

function ValueView({summary,aQty,bQty,unit}:{summary:{name:string;shortages:number}[];aQty:number;bQty:number;unit:string}){
  return <div><div className="flex justify-between"><div><div className="text-lg font-extrabold">시나리오 예상 성과</div><div className="text-xs text-[#888] mt-1">운영 실행 전의 예상치이며 확정 성과가 아닙니다.</div></div><QualityBadge quality="UNAVAILABLE"/></div><div className="grid grid-cols-2 gap-4 mt-5"><div className="border rounded-xl p-5"><div className="text-xs text-[#777]">대응안 A 위험 자재 감소</div><div className="text-2xl font-extrabold mt-2">{Math.max(0,summary[0].shortages-summary[1].shortages)}종</div><div className="text-xs text-[#888] mt-2">추가 입고 {num(aQty)} {unit}</div></div><div className="border rounded-xl p-5"><div className="text-xs text-[#777]">대응안 B 위험 자재 감소</div><div className="text-2xl font-extrabold mt-2">{Math.max(0,summary[0].shortages-summary[2].shortages)}종</div><div className="text-xs text-[#888] mt-2">추가 입고 {num(bQty)} {unit}</div></div></div><div className="mt-5 rounded-xl bg-[#F8F6F4] p-5 text-sm"><div className="font-bold">금액 효과는 아직 계산하지 않습니다.</div><div className="text-xs text-[#777] mt-2 leading-5">자재 단가, 확정 입고계획, 로트 유효기간, 실제 조치가 연결돼야 과잉재고·폐기 방지·운전자본 효과를 신뢰할 수 있습니다. 운영 실행 후 검증된 결과는 성과 관리 원장에 기록합니다.</div><Link href="/value" className="inline-block mt-4 text-xs font-bold text-[#EA002C]">성과 관리 보기 →</Link></div></div>
}
