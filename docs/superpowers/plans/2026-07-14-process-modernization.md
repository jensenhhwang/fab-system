# 공정 현실화 (Process Modernization) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공정코드(P01~P10)에 한국어 이름을 붙이고, 사이트(이천/청주) 태깅과 MES↔Usage 양방향 링크를 구현한다.

**Architecture:** PROCESSES 배열을 `src/lib/processes.ts`로 분리해 단일 진실 원천으로 만들고, `processMetadata` MongoDB 컬렉션에 공정 메타데이터를 저장한다. `ProcessUsageDoc`에 `site` 필드를 추가해 이천/청주 생산을 구분하며, URL 쿼리 파라미터(`?process=P01`)로 /usage ↔ /mes 페이지 간 양방향 이동을 구현한다.

**Tech Stack:** Next.js App Router, MongoDB native driver, TypeScript, Tailwind CSS, `next/navigation` (useSearchParams/useRouter)

## Global Constraints

- `npx dotenv-cli -e .env -- npx tsx scripts/seed-xxx.ts` 패턴으로만 DB 접근 스크립트를 실행 (DATABASE_URL을 CLI에 직접 노출 금지)
- TypeScript strict — `npx tsc --noEmit` 에러 0개 유지
- 기존 문서(ProcessUsageDoc)는 site 필드 없이도 동작해야 함 (`site?: "이천" | "청주"`)
- 서버 컴포넌트에서 useSearchParams 불가 — 반드시 Client 컴포넌트에서 사용
- NAND 공정 processUsage 레코드는 기존 그대로 유지 (site 필드 없음도 허용)

---

### Task 1: PROCESSES 배열을 공유 lib으로 분리

**Files:**
- Create: `src/lib/processes.ts`
- Modify: `src/components/ProcessFlow3D.tsx` (import 교체)
- Modify: `src/app/(dashboard)/usage/UsageClient.tsx` (import 교체)

**Interfaces:**
- Produces: `PROCESSES: ProcessDef[]` exported from `src/lib/processes.ts`

- [ ] **Step 1: `src/lib/processes.ts` 생성**

```typescript
export interface ProcessDef {
  code: string;
  name: string;
  nameEn: string;
  color: string;
  activities: string[];
  nMachines: number;
  yellowBay?: boolean;
}

export const PROCESSES: ProcessDef[] = [
  { code: "P01", name: "산화막",       nameEn: "Oxidation",     color: "#3B82F6", activities: ["열산화 성장", "SiO₂ 게이트막", "절연층 형성"],    nMachines: 8  },
  { code: "P02", name: "CVD",          nameEn: "CVD",           color: "#8B5CF6", activities: ["박막 증착", "PECVD/LPCVD", "유전체 형성"],          nMachines: 12 },
  { code: "P03", name: "포토",         nameEn: "Photo",         color: "#EC4899", activities: ["PR 도포", "EUV/ArF 노광", "현상·검사"],             nMachines: 12, yellowBay: true },
  { code: "P04", name: "식각",         nameEn: "Etching",       color: "#F97316", activities: ["건식/습식 식각", "패턴 전사", "선택비 제어"],         nMachines: 16 },
  { code: "P05", name: "이온주입",     nameEn: "Ion Implant",   color: "#EAB308", activities: ["불순물 주입", "도즈량 제어", "열처리 활성화"],        nMachines: 8  },
  { code: "P06", name: "금속배선1",    nameEn: "Metallization", color: "#10B981", activities: ["Al/Cu 스퍼터링", "배선 패터닝", "비아 형성"],         nMachines: 10 },
  { code: "P07", name: "CMP",          nameEn: "CMP",           color: "#06B6D4", activities: ["전면 평탄화", "연마 속도 제어", "슬러리 관리"],       nMachines: 10 },
  { code: "P08", name: "TSV/배선2",    nameEn: "TSV/Metal2",    color: "#EF4444", activities: ["관통 전극 형성", "Cu 도금", "3D 적층 배선"],          nMachines: 8  },
  { code: "P09", name: "웨이퍼테스트", nameEn: "Wafer Test",    color: "#84CC16", activities: ["전기 특성 검사", "수율 분석", "불량 맵핑"],            nMachines: 12 },
  { code: "P10", name: "패키징",       nameEn: "Packaging",     color: "#D946EF", activities: ["다이 절단", "HBM 적층 본딩", "최종 검사"],            nMachines: 10 },
];
```

- [ ] **Step 2: `ProcessFlow3D.tsx` import 교체**

`ProcessFlow3D.tsx` 상단의 `export const PROCESSES = [...]` 블록 전체(line 9~20)를 아래로 교체:

```typescript
import { PROCESSES } from "@/lib/processes";
export type { ProcessDef } from "@/lib/processes";
export { PROCESSES };
```

(파일 나머지는 그대로. PROCESSES를 re-export 하는 이유: 기존에 `ProcessFlow3D`에서 import하던 코드가 있으면 호환 유지.)

- [ ] **Step 3: `UsageClient.tsx` import 교체**

`UsageClient.tsx` line 6을:
```typescript
import { PROCESSES } from "@/components/ProcessFlow3D";
```
→
```typescript
import { PROCESSES } from "@/lib/processes";
```

- [ ] **Step 4: TypeScript 확인**

```bash
npx tsc --noEmit
```
Expected: 에러 0개

- [ ] **Step 5: Commit**

```bash
git add src/lib/processes.ts src/components/ProcessFlow3D.tsx "src/app/(dashboard)/usage/UsageClient.tsx"
git commit -m "refactor: extract PROCESSES to src/lib/processes.ts as single source of truth"
```

---

### Task 2: ProcessUsageDoc에 site 추가 + ProcessMetadataDoc 타입 정의

**Files:**
- Modify: `src/lib/db.ts`

**Interfaces:**
- Produces: `ProcessUsageDoc.site?: "이천" | "청주"`, `ProcessMetadataDoc` type, `processMetadata` collection

- [ ] **Step 1: `db.ts`의 ProcessUsageDoc에 site 필드 추가**

`src/lib/db.ts` line 89-91:
```typescript
export interface ProcessUsageDoc {
  _id: string; materialId: string; processCode: string; product: Product; monthlyQty: number;
}
```
→
```typescript
export interface ProcessUsageDoc {
  _id: string; materialId: string; processCode: string; product: Product; monthlyQty: number;
  site?: "이천" | "청주";
}
```

- [ ] **Step 2: ProcessMetadataDoc 타입 추가**

`src/lib/db.ts`의 `WorkOrderDoc` 타입 아래(line 204 이후)에 추가:

```typescript
export type BottleneckRisk = "HIGH" | "MEDIUM" | "LOW";

export interface ProcessMetadataDoc {
  _id: string;        // processCode (예: "P01")
  name: string;       // 한국어 이름 (예: "산화막")
  nameEn: string;     // 영문 이름 (예: "Oxidation")
  site: ("이천" | "청주")[];  // 해당 공정이 있는 사이트
  sequence: number;   // 공정 순서 (P01=1, P10=10)
  bottleneckRisk: BottleneckRisk;
}
```

- [ ] **Step 3: collections()에 processMetadata 추가**

`collections()` 반환 타입과 구현체에 아래 라인 추가:

반환 타입 (workOrders 아래):
```typescript
processMetadata: Collection<ProcessMetadataDoc>;
```

구현체 (workOrders 아래):
```typescript
processMetadata: db.collection<ProcessMetadataDoc>("processMetadata"),
```

- [ ] **Step 4: TypeScript 확인**

```bash
npx tsc --noEmit
```
Expected: 에러 0개

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(db): add site field to ProcessUsageDoc, add ProcessMetadataDoc type"
```

---

### Task 3: processMetadata 컬렉션 시드 스크립트

**Files:**
- Create: `scripts/seed-process-metadata.ts`

**Interfaces:**
- Consumes: `ProcessMetadataDoc` from `src/lib/db.ts`
- Produces: MongoDB `processMetadata` 컬렉션에 10개 문서 upsert

- [ ] **Step 1: 시드 스크립트 생성**

```typescript
// scripts/seed-process-metadata.ts
import { getDb } from "../src/lib/db";
import type { ProcessMetadataDoc } from "../src/lib/db";

const METADATA: ProcessMetadataDoc[] = [
  { _id: "P01", name: "산화막",       nameEn: "Oxidation",     site: ["이천"],        sequence: 1,  bottleneckRisk: "LOW"    },
  { _id: "P02", name: "CVD",          nameEn: "CVD",           site: ["이천"],        sequence: 2,  bottleneckRisk: "MEDIUM" },
  { _id: "P03", name: "포토",         nameEn: "Photo",         site: ["이천"],        sequence: 3,  bottleneckRisk: "HIGH"   },
  { _id: "P04", name: "식각",         nameEn: "Etching",       site: ["이천"],        sequence: 4,  bottleneckRisk: "HIGH"   },
  { _id: "P05", name: "이온주입",     nameEn: "Ion Implant",   site: ["이천"],        sequence: 5,  bottleneckRisk: "MEDIUM" },
  { _id: "P06", name: "금속배선1",    nameEn: "Metallization", site: ["이천"],        sequence: 6,  bottleneckRisk: "MEDIUM" },
  { _id: "P07", name: "CMP",          nameEn: "CMP",           site: ["이천"],        sequence: 7,  bottleneckRisk: "LOW"    },
  { _id: "P08", name: "TSV/배선2",    nameEn: "TSV/Metal2",    site: ["이천"],        sequence: 8,  bottleneckRisk: "HIGH"   },
  { _id: "P09", name: "웨이퍼테스트", nameEn: "Wafer Test",    site: ["이천", "청주"], sequence: 9,  bottleneckRisk: "LOW"    },
  { _id: "P10", name: "패키징",       nameEn: "Packaging",     site: ["이천", "청주"], sequence: 10, bottleneckRisk: "LOW"    },
];

async function main() {
  const db = await getDb();
  const col = db.collection<ProcessMetadataDoc>("processMetadata");
  let count = 0;
  for (const doc of METADATA) {
    await col.replaceOne({ _id: doc._id }, doc, { upsert: true });
    count++;
  }
  console.log(`Upserted ${count} processMetadata documents`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 스크립트 실행**

```bash
npx dotenv-cli -e .env -- npx tsx scripts/seed-process-metadata.ts
```
Expected: `Upserted 10 processMetadata documents`

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-process-metadata.ts
git commit -m "feat: add seed script for processMetadata collection"
```

---

### Task 4: process-readiness API에 processName + site 포함

**Files:**
- Modify: `src/app/api/mes/process-readiness/route.ts`

**Interfaces:**
- Consumes: `processMetadata` collection from db
- Produces: `ProcessReadinessRow.processName: string`, `ProcessReadinessRow.site: string[]` 추가

- [ ] **Step 1: route.ts 전체 교체**

```typescript
import { NextResponse } from "next/server";
import { collections } from "@/lib/db";
import type { Product } from "@/lib/db";

export const dynamic = "force-dynamic";

type ProcessReadinessCell = {
  materialId: string;
  materialName: string;
  dailyUsage: number;
  availableQty: number;
  doh: number;
  ropDays: number;
};

type ProcessReadinessRow = {
  processCode: string;
  processName: string;
  site: string[];
  product: Product;
  cells: ProcessReadinessCell[];
};

export async function GET() {
  const { processUsage, inventoryLots, materials, processMetadata } = await collections();

  const [usages, lots, mats, metaDocs] = await Promise.all([
    processUsage.find({}).toArray(),
    inventoryLots.find({ qualityStatus: "AVAILABLE" }).toArray(),
    materials.find({}).toArray(),
    processMetadata.find({}).toArray(),
  ]);

  const matMap = new Map(mats.map(m => [m._id, m]));
  const metaMap = new Map(metaDocs.map(m => [m._id, m]));

  const availMap = new Map<string, number>();
  for (const lot of lots) {
    availMap.set(lot.materialId, (availMap.get(lot.materialId) ?? 0) + lot.availableQuantity);
  }

  const rowMap = new Map<string, ProcessReadinessRow>();
  for (const u of usages) {
    const key = `${u.processCode}-${u.product}`;
    if (!rowMap.has(key)) {
      const meta = metaMap.get(u.processCode);
      rowMap.set(key, {
        processCode: u.processCode,
        processName: meta?.name ?? u.processCode,
        site: meta?.site ?? [],
        product: u.product as Product,
        cells: [],
      });
    }
    const mat = matMap.get(u.materialId);
    const dailyUsage = u.monthlyQty / 30;
    const availableQty = availMap.get(u.materialId) ?? 0;
    const doh = dailyUsage > 0 ? Math.round(availableQty / dailyUsage) : 0;
    rowMap.get(key)!.cells.push({
      materialId: u.materialId,
      materialName: mat?.name ?? u.materialId,
      dailyUsage,
      availableQty,
      doh,
      ropDays: mat?.ropDays ?? 7,
    });
  }

  const rows = Array.from(rowMap.values()).sort((a, b) =>
    a.processCode.localeCompare(b.processCode)
  );

  return NextResponse.json(rows);
}
```

- [ ] **Step 2: TypeScript 확인**

```bash
npx tsc --noEmit
```
Expected: 에러 0개

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/mes/process-readiness/route.ts"
git commit -m "feat(api): include processName and site in process-readiness response"
```

---

### Task 5: ProcessReadinessMatrix — 공정명 표시 + 사이트 배지 + Usage 링크

**Files:**
- Modify: `src/app/(dashboard)/mes/ProcessReadinessMatrix.tsx`

**Interfaces:**
- Consumes: API가 이제 `processName: string`, `site: string[]` 반환
- Produces: `onProcessCodeClick?: (code: string) => void` prop (Usage 이동용)

- [ ] **Step 1: ProcessReadinessMatrix.tsx 전체 교체**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ReadinessCell = {
  materialId: string;
  materialName: string;
  dailyUsage: number;
  availableQty: number;
  doh: number;
  ropDays: number;
};

type ReadinessRow = {
  processCode: string;
  processName: string;
  site: string[];
  product: string;
  cells: ReadinessCell[];
};

function getDohStyle(doh: number, ropDays: number): string {
  if (doh < 5) return "bg-red-100 text-red-700 font-semibold";
  if (doh < ropDays) return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

const SITE_BADGE: Record<string, string> = {
  "이천": "bg-blue-100 text-blue-700",
  "청주": "bg-green-100 text-green-700",
};

export default function ProcessReadinessMatrix({
  onCellClick,
  highlightProcess,
}: {
  onCellClick: (processCode: string, product: string, materialId: string) => void;
  highlightProcess?: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ReadinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteFilter, setSiteFilter] = useState<"ALL" | "이천" | "청주">("ALL");
  const [hoveredProcess, setHoveredProcess] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/mes/process-readiness")
      .then(r => r.json())
      .then(data => { setRows(data); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-sm" style={{ color: "var(--text-3)" }}>
        로딩 중...
      </div>
    );
  }

  const filteredRows = siteFilter === "ALL"
    ? rows
    : rows.filter(r => r.site.includes(siteFilter));

  const allMaterials = Array.from(
    new Map(
      filteredRows.flatMap(r => r.cells.map(c => [c.materialId, c.materialName]))
    ).entries()
  ).map(([id, name]) => ({ id, name }));

  const allCells = filteredRows.flatMap(r => r.cells);
  const criticalCount = allCells.filter(c => c.doh < 5).length;
  const warningCount = allCells.filter(c => c.doh >= 5 && c.doh < c.ropDays).length;
  const okCount = allCells.filter(c => c.doh >= c.ropDays).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "위험 (5일↓)", count: criticalCount, border: "border-red-400", bg: "bg-red-50", text: "text-red-700" },
          { label: "경고 (ROP 미달)", count: warningCount, border: "border-amber-400", bg: "bg-amber-50", text: "text-amber-700" },
          { label: "정상", count: okCount, border: "border-green-400", bg: "bg-green-50", text: "text-green-700" },
        ].map(({ label, count, border, bg, text }) => (
          <div key={label} className={`rounded-2xl shadow-sm p-4 border-t-4 ${border} ${bg}`}>
            <div className={`text-2xl font-bold ${text}`}>{count}</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-3)" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* 사이트 필터 */}
      <div className="flex gap-2 items-center">
        <span className="text-xs font-semibold" style={{ color: "var(--text-3)" }}>사이트</span>
        {(["ALL", "이천", "청주"] as const).map(s => (
          <button
            key={s}
            onClick={() => setSiteFilter(s)}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              siteFilter === s
                ? "bg-[#0078D4] text-white border-[#0078D4]"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-auto">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-gray-50 px-3 py-2 text-left font-semibold border-b border-r" style={{ color: "var(--text-2)", minWidth: 160 }}>
                공정 / 자재
              </th>
              {allMaterials.map(m => (
                <th key={m.id} className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-center font-medium border-b border-r whitespace-nowrap" style={{ color: "var(--text-2)", minWidth: 90 }}>
                  {m.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => {
              const cellMap = new Map(row.cells.map(c => [c.materialId, c]));
              const isHighlighted = highlightProcess === row.processCode;
              const isHovered = hoveredProcess === row.processCode;
              return (
                <tr
                  key={`${row.processCode}-${row.product}`}
                  className={`hover:bg-gray-50 ${isHighlighted ? "ring-2 ring-[#0078D4] ring-inset" : ""}`}
                  onMouseEnter={() => setHoveredProcess(row.processCode)}
                  onMouseLeave={() => setHoveredProcess(null)}
                >
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-r whitespace-nowrap" style={{ color: "var(--text-1)" }}>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[11px]">{row.processName}</span>
                        <span className="font-mono text-[10px] text-gray-400">{row.processCode}</span>
                        {isHovered && (
                          <button
                            onClick={() => router.push(`/usage?process=${row.processCode}`)}
                            className="text-[9px] text-[#0078D4] hover:underline ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ opacity: 1 }}
                          >
                            → 사용량
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {row.site.map(s => (
                          <span key={s} className={`text-[9px] font-bold px-1 py-0.5 rounded ${SITE_BADGE[s] ?? "bg-gray-100 text-gray-600"}`}>
                            {s}
                          </span>
                        ))}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100" style={{ color: "var(--text-3)" }}>
                          {row.product}
                        </span>
                      </div>
                    </div>
                  </td>
                  {allMaterials.map(m => {
                    const cell = cellMap.get(m.id);
                    if (!cell) {
                      return <td key={m.id} className="px-3 py-2 text-center border-b border-r text-gray-300">—</td>;
                    }
                    return (
                      <td
                        key={m.id}
                        className={`px-3 py-2 text-center border-b border-r cursor-pointer hover:opacity-75 transition-opacity ${getDohStyle(cell.doh, cell.ropDays)}`}
                        onClick={() => onCellClick(row.processCode, row.product, m.id)}
                        title={`가용: ${cell.availableQty.toFixed(1)} / 일소비: ${cell.dailyUsage.toFixed(1)}`}
                      >
                        {cell.doh}일
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: MesClient.tsx에서 highlightProcess prop 전달**

`MesClient.tsx`의 `<ProcessReadinessMatrix ... />` 부분을 아래로 교체:

```typescript
<ProcessReadinessMatrix
  onCellClick={(processCode, product, _materialId) => {
    const existingWo = workOrders.find(
      w => w.processCode === processCode && w.product === product && w.status === "MATERIAL_WAIT"
    );
    if (existingWo) {
      setPickingWo(existingWo);
    } else {
      setTab("workorders");
    }
  }}
  highlightProcess={highlightProcess}
/>
```

그리고 MesClient.tsx 상단에 state 추가:
```typescript
const [highlightProcess, setHighlightProcess] = useState<string | null>(null);
```

- [ ] **Step 3: TypeScript 확인**

```bash
npx tsc --noEmit
```
Expected: 에러 0개

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/mes/ProcessReadinessMatrix.tsx" "src/app/(dashboard)/mes/MesClient.tsx"
git commit -m "feat(mes): show process name + site badge in readiness matrix, add usage link"
```

---

### Task 6: WorkOrderTable + WorkOrderCreateModal 공정명 표시

**Files:**
- Modify: `src/app/(dashboard)/mes/WorkOrderTable.tsx`
- Modify: `src/app/(dashboard)/mes/WorkOrderCreateModal.tsx`

**Interfaces:**
- Consumes: `PROCESSES` from `src/lib/processes`

- [ ] **Step 1: WorkOrderTable.tsx — 공정 컬럼 2줄 표시**

`WorkOrderTable.tsx` 상단에 import 추가:
```typescript
import { PROCESSES } from "@/lib/processes";
```

공정 td 교체 (기존 `{wo.processCode}` 줄):
```typescript
<td className="px-4 py-3" style={{ color: "var(--text-1)" }}>
  <div className="font-medium text-xs leading-tight">
    {PROCESSES.find(p => p.code === wo.processCode)?.name ?? wo.processCode}
  </div>
  <div className="font-mono text-[10px] text-gray-400">{wo.processCode}</div>
</td>
```

- [ ] **Step 2: WorkOrderCreateModal.tsx — 공정 옵션 "산화막 (P01)" 형식**

`WorkOrderCreateModal.tsx` 상단에 import 추가:
```typescript
import { PROCESSES } from "@/lib/processes";
```

공정 select 옵션 교체:
```typescript
{processCodes.map(p => {
  const proc = PROCESSES.find(pr => pr.code === p);
  return (
    <option key={p} value={p}>
      {proc ? `${proc.name} (${p})` : p}
    </option>
  );
})}
```

- [ ] **Step 3: TypeScript 확인**

```bash
npx tsc --noEmit
```
Expected: 에러 0개

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/mes/WorkOrderTable.tsx" "src/app/(dashboard)/mes/WorkOrderCreateModal.tsx"
git commit -m "feat(mes): show process name alongside code in WO table and create modal"
```

---

### Task 7: UsageClient — URL 쿼리 파라미터 + site 필터 + MES 링크

**Files:**
- Modify: `src/app/(dashboard)/usage/UsageClient.tsx`
- Modify: `src/app/(dashboard)/usage/page.tsx` (Suspense 래핑 확인)

**Interfaces:**
- Consumes: URL `?process=P01` → `selectedProc` 자동 설정
- Produces: `selectedProc` 선택 시 "MES 공정 준비 보기 →" 버튼 표시

- [ ] **Step 1: usage/page.tsx 확인 — Suspense 래핑**

`src/app/(dashboard)/usage/page.tsx`를 읽어 UsageClient가 `<Suspense>`로 감싸져 있는지 확인. `useSearchParams`는 반드시 Suspense boundary 안에 있어야 함.

만약 page.tsx가 아래처럼 직접 렌더링하고 있다면:
```tsx
return <UsageClient materials={...} />;
```
→ 아래로 교체:
```tsx
import { Suspense } from "react";
// ...
return (
  <Suspense fallback={<div>로딩 중...</div>}>
    <UsageClient materials={materials} warehouseLinks={warehouseLinks} warehouses={warehouses} />
  </Suspense>
);
```

- [ ] **Step 2: UsageClient.tsx에 useSearchParams + router 업데이트 + site 필터 추가**

`UsageClient.tsx` 상단 import에 추가:
```typescript
import { useSearchParams } from "next/navigation";
```

`UsageClient` 함수 내부 상단에 추가:
```typescript
const searchParams = useSearchParams();
const [filterSite, setFilterSite] = useState<"ALL" | "이천" | "청주">("ALL");
```

useEffect 추가 (searchParams → selectedProc 동기화):
```typescript
useEffect(() => {
  const proc = searchParams.get("process");
  if (proc) setSelectedProc(proc);
}, [searchParams]);
```

- [ ] **Step 3: 선택된 공정 배너에 "MES 공정 준비 보기 →" 버튼 추가**

`UsageClient.tsx`의 선택된 공정 배너 부분:
```tsx
{selectedProc && (
  <div className="px-5 py-3 bg-[#FFF0F2] border-b border-[#FFD6DA] flex items-center gap-3">
    <span className="text-xs font-black text-[#EA002C]">{selectedProc}</span>
    <span className="text-xs text-[#EA002C] font-semibold">
      {PROCESSES.find((p) => p.code === selectedProc)?.name} — {filteredMaterials.length}종 자재 사용
    </span>
    <button
      onClick={() => setSelectedProc(null)}
      className="ml-auto text-[10px] text-[#EA002C] hover:underline"
    >
      선택 해제
    </button>
  </div>
)}
```
→ 아래로 교체 (MES 링크 버튼 추가):
```tsx
{selectedProc && (
  <div className="px-5 py-3 bg-[#FFF0F2] border-b border-[#FFD6DA] flex items-center gap-3">
    <span className="text-xs font-black text-[#EA002C]">{selectedProc}</span>
    <span className="text-xs text-[#EA002C] font-semibold">
      {PROCESSES.find((p) => p.code === selectedProc)?.name} — {filteredMaterials.length}종 자재 사용
    </span>
    <button
      onClick={() => router.push(`/mes?process=${selectedProc}`)}
      className="px-3 py-1 text-[10px] font-bold bg-[#EA002C] text-white rounded-full hover:bg-red-700 transition-colors"
    >
      MES 공정 준비 보기 →
    </button>
    <button
      onClick={() => setSelectedProc(null)}
      className="ml-auto text-[10px] text-[#EA002C] hover:underline"
    >
      선택 해제
    </button>
  </div>
)}
```

- [ ] **Step 4: TypeScript 확인**

```bash
npx tsc --noEmit
```
Expected: 에러 0개

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/usage/UsageClient.tsx" "src/app/(dashboard)/usage/page.tsx"
git commit -m "feat(usage): add URL process filter, MES link button, and useSearchParams sync"
```

---

### Task 8: MesClient — URL 쿼리 파라미터로 공정 자동 포커스

**Files:**
- Modify: `src/app/(dashboard)/mes/MesClient.tsx`
- Modify: `src/app/(dashboard)/mes/page.tsx` (Suspense 래핑 확인)

**Interfaces:**
- Consumes: URL `?process=P01` → `highlightProcess` 상태 설정, readiness 탭 자동 활성
- Produces: ProcessReadinessMatrix에 `highlightProcess` prop 전달

- [ ] **Step 1: mes/page.tsx — Suspense 래핑 확인**

`src/app/(dashboard)/mes/page.tsx`를 읽어 MesClient가 Suspense로 감싸져 있는지 확인.

없으면:
```tsx
import { Suspense } from "react";
// ...
return (
  <Suspense fallback={<div>로딩 중...</div>}>
    <MesClient initialWorkOrders={workOrders} />
  </Suspense>
);
```

- [ ] **Step 2: MesClient.tsx에 useSearchParams 추가**

`MesClient.tsx` import에 추가:
```typescript
import { useSearchParams } from "next/navigation";
```

함수 내부 상단에 추가:
```typescript
const searchParams = useSearchParams();
```

기존 `useState` 블록 아래에 useEffect 추가:
```typescript
useEffect(() => {
  const proc = searchParams.get("process");
  if (proc) {
    setHighlightProcess(proc);
    setTab("readiness");
  }
}, [searchParams]);
```

- [ ] **Step 3: TypeScript 확인**

```bash
npx tsc --noEmit
```
Expected: 에러 0개

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/mes/MesClient.tsx" "src/app/(dashboard)/mes/page.tsx"
git commit -m "feat(mes): auto-focus process row via URL ?process= query param"
```

---

## 검증 체크리스트

모든 태스크 완료 후:

- [ ] `/usage` 접속 → 공정 클릭 → "MES 공정 준비 보기 →" 버튼 클릭 → `/mes?process=P04`로 이동, P04 행 하이라이트 확인
- [ ] `/mes` 접속 → P03 행 헤더 hover → "→ 사용량" 버튼 클릭 → `/usage?process=P03`로 이동, P03 필터 자동 적용 확인
- [ ] `/mes` 공정 준비 현황 매트릭스: "식각 P04 [이천]" 형식으로 표시 확인
- [ ] `/mes` 작업지시 생성 모달: 공정 드롭다운에 "산화막 (P01)" 형식 확인
- [ ] `/mes` 사이트 필터: "청주" 선택 시 P09, P10만 표시 확인
- [ ] `npx tsc --noEmit` 에러 0개
