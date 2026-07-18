export default function FoupBadge({ foupCode }: { foupCode?: string }) {
  if (!foupCode) return null;
  return (
    <span className="rounded bg-[#183B56] px-1.5 py-0.5 font-mono text-[9px] font-black text-white">
      {foupCode}
    </span>
  );
}
