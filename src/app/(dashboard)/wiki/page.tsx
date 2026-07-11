export const dynamic = "force-dynamic";

import { getWikiEntries } from "@/lib/queries";
import WikiClient from "./WikiClient";

async function getEntries() {
  const entries = await getWikiEntries();
  return entries.map((e) => ({
    id: e.id,
    date: new Date(e.date).toISOString(),
    title: e.title,
    category: e.category,
    content: e.content,
    result: e.result ?? null,
    nextAction: e.nextAction ?? null,
    user: e.user,
  }));
}

export default async function WikiPage() {
  const entries = await getEntries();
  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">업무 일지</div>
      <div className="text-sm text-[#999] mb-6">
        일별 작업 기록 · {entries.length}건
      </div>
      <WikiClient entries={entries} />
    </>
  );
}
