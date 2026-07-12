import { test, expect } from "@playwright/test";

const BASE = "https://fab-system-phi.vercel.app";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`);
  await page.getByText("황지훈").click();
  await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
}

test.describe("대시보드", () => {
  test("대시보드 메인 페이지 로드", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText("FAB 자재관리")).toBeVisible({ timeout: 10_000 });
  });

  test("재고 현황 페이지 로드", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/inventory`);
    await expect(page).toHaveURL(`${BASE}/inventory`);
    await expect(page.getByText("재고")).toBeVisible({ timeout: 10_000 });
  });

  test("공정별 사용량 페이지 로드", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/usage`);
    await expect(page).toHaveURL(`${BASE}/usage`);
    await expect(page.getByText("사용량")).toBeVisible({ timeout: 10_000 });
  });

  test("창고 Capacity와 표준 시설 순서가 표시된다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/warehouse`);
    await expect(page.getByText("창고 Capacity")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("A동 — 자동화 창고 (AS/RS)")).toBeVisible();
    await expect(page.getByText("벌크가스 야드")).toBeVisible();
    await expect(page.getByText("벌크 케미컬 야드")).toBeVisible();
  });

  test("창고 상세에서 DB 위치·로트 UI가 표시된다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/warehouse/WH-A`);
    await expect(page.getByText("위치·자재 찾기")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("선택 위치 상세")).toBeVisible();
  });

  test("업무 일지 페이지 로드", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/wiki`);
    await expect(page).toHaveURL(`${BASE}/wiki`);
    await expect(page.getByText("업무 일지").or(page.getByText("Wiki")).or(page.getByText("일지"))).toBeVisible({ timeout: 10_000 });
  });

  test("리스크 페이지 로드", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/risk`);
    await expect(page).toHaveURL(`${BASE}/risk`);
    await expect(page.getByText("리스크").or(page.getByText("Risk"))).toBeVisible({ timeout: 10_000 });
  });
});
