import FinishedGoodsClient from "./FinishedGoodsClient";

export const dynamic = "force-dynamic";

export default function FinishedGoodsPage() {
  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">완제품 재고</div>
      <div className="text-sm text-[#999] mb-6">
        투입된 자재가 어떻게 완제품으로 바뀌는지 — 소모와 산출을 tick 단위로 대조합니다 · HBM(STACK)·DRAM(CHIP)·NAND(DIE)가 각 route를 완료하면 제품별 환산(docs/foup-wip-master.md)으로 적립됩니다
      </div>
      <FinishedGoodsClient />
    </>
  );
}
