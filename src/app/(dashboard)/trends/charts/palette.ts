import type { Product } from "@/lib/db";

// 제품 계열 색 — dataviz 6검사 전항목 PASS (light, surface #fcfcfb):
// 최악 인접쌍 deutan ΔE 9.8 · tritan 28.9 · 정상시야 26.9 · 대비 전부 >= 3:1.
// 색은 **엔티티에 고정**한다. 필터가 계열 수를 바꿔도 살아남은 계열의 색은 바뀌지 않는다.
export const PRODUCT_COLOR: Record<Product, string> = {
  HBM: "#0078D4",
  DRAM: "#B5179E",
  NAND: "#0E9B8A",
};

// 상태색은 예약이다 — 계열 색으로 재사용하지 않는다.
export const STATUS_COLOR = {
  critical: "#EA002C",
  warning: "#F7A600",
  ok: "#00B96B",
} as const;

/** 단일 계열 라인용 잉크. 제품 색과 겹치지 않게 브랜드 블루를 쓴다. */
export const SINGLE_SERIES_COLOR = "#0078D4";

/** 정책 변경 마커 — 데이터가 아니라 사건이므로 계열 팔레트 밖의 색을 쓴다. */
export const MARKER_COLOR = "#7C3AED";

export const AXIS_INK = "#999999";
export const GRID_INK = "#E8E8E8";
