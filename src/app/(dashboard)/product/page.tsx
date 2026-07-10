export default function Page() {
  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">제품별 사용량</div>
      <div className="text-sm text-[#999] mb-8">제품(HBM/DRAM/NAND) 기준 자재 소요량 비교</div>
      <div className="flex flex-col items-center justify-center gap-4 py-24 bg-white rounded-2xl border border-dashed border-[#E8E8E8]">
        <div className="text-4xl">🚧</div>
        <div className="text-base font-bold text-[#555]">개발 중</div>
        <div className="text-sm text-[#999] text-center leading-relaxed">
          제품(HBM/DRAM/NAND) 기준 자재 소요량 비교<br/>
          곧 완성될 예정이에요.
        </div>
      </div>
    </>
  );
}
