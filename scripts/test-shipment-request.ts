import assert from "node:assert/strict";
import { parseShipmentRequest } from "../src/lib/shipment-request";
import { finishedGoodsWarehouseFor, finishedGoodsUnit } from "../src/lib/finished-goods";

// 출하는 HBM 전용이었다 — 라우트가 fabId "M20" / product "HBM" / unit "STACK"을 하드코딩해서
// DRAM/NAND는 나갈 문이 아예 없었고, 만들수록 자기 완제품 창고를 CAPACITY_OVER로 막았다.
// 여기서 제품별 출하 요청 해석을 순수함수로 고정한다.

// ── 제품 미지정이면 HBM (기존 호출자 하위호환) ──
{
  const r = parseShipmentRequest({ customerId: "CUST-A", quantity: 100 });
  assert.ok(!("error" in r), "정상 요청이어야 한다");
  assert.equal(r.product, "HBM", "제품을 안 주면 HBM으로 본다");
  assert.equal(r.fabId, "M20");
  assert.equal(r.unit, "STACK");
  assert.equal(r.warehouseId, "WH-FG01");
  assert.equal(r.finishedGoodsId, "M20__HBM__WH-FG01");
}

// ── 3제품 각각이 자기 팹·창고·단위로 해석된다 ──
{
  const dram = parseShipmentRequest({ customerId: "CUST-A", quantity: 100, product: "DRAM" });
  assert.ok(!("error" in dram));
  assert.equal(dram.fabId, "M21");
  assert.equal(dram.unit, "CHIP");
  assert.equal(dram.warehouseId, finishedGoodsWarehouseFor("DRAM"));
  assert.equal(dram.finishedGoodsId, "M21__DRAM__WH-FG02");

  const nand = parseShipmentRequest({ customerId: "CUST-A", quantity: 100, product: "NAND" });
  assert.ok(!("error" in nand));
  assert.equal(nand.fabId, "M22");
  assert.equal(nand.unit, "DIE");
  assert.equal(nand.finishedGoodsId, "M22__NAND__WH-FG03");
}

// ── 단위는 제품 config와 단일 출처를 공유해야 한다 ──
{
  for (const p of ["HBM", "DRAM", "NAND"] as const) {
    const r = parseShipmentRequest({ customerId: "CUST-A", quantity: 1, product: p });
    assert.ok(!("error" in r));
    assert.equal(r.unit, finishedGoodsUnit(p), `${p} 단위가 finishedGoodsUnit과 같아야 한다`);
  }
}

// ── 잘못된 입력은 거절한다 ──
{
  assert.ok("error" in parseShipmentRequest({ quantity: 100 }), "고객사 없으면 거절");
  assert.ok("error" in parseShipmentRequest({ customerId: "CUST-A" }), "수량 없으면 거절");
  assert.ok("error" in parseShipmentRequest({ customerId: "CUST-A", quantity: 0 }), "0은 거절");
  assert.ok("error" in parseShipmentRequest({ customerId: "CUST-A", quantity: -5 }), "음수는 거절");
  assert.ok("error" in parseShipmentRequest({ customerId: "CUST-A", quantity: Number.NaN }), "NaN은 거절");
  assert.ok("error" in parseShipmentRequest({ customerId: "CUST-A", quantity: 10, product: "SSD" }), "모르는 제품은 거절");
}

console.log("✅ 출하 요청 해석 테스트 통과 — HBM/DRAM/NAND 3제품 개통");
