import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

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
    await expect(page.getByRole("main").getByText("재고 · 보관일수", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("재고 자재에서 종합 운영 허브로 연결된다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/inventory`);
    const materialLink = page.locator('a[href^="/inventory/materials/"]').first();
    await expect(materialLink).toBeVisible({ timeout: 10_000 });
    await materialLink.click();
    await expect(page).toHaveURL(/\/inventory\/materials\//, { timeout: 15_000 });
    await expect(page.getByText("창고별 재고", { exact: true })).toBeVisible();
    await expect(page.getByText("운영 구도", { exact: true })).toBeVisible();
    await expect(page.getByText("생산 · BOM 연결", { exact: true })).toBeVisible();
    await expect(page.getByText("현재 조달 적용 기준", { exact: true })).toBeVisible();
    await expect(page.getByText("조달 기준 관리", { exact: true })).toBeVisible();
  });

  test("공정별 사용량 페이지 로드", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/usage`);
    await expect(page).toHaveURL(`${BASE}/usage`);
    await expect(page.getByRole("main").getByText("공정별 사용량", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("창고 Capacity와 표준 시설 순서가 표시된다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/warehouse`);
    await expect(page.getByText("창고 Capacity")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("main").getByText("운영 보관·공급시설", { exact: true })).toBeVisible();
    await expect(page.locator('a[href^="/warehouse/"]').first()).toBeVisible();
  });

  test("창고 상세에서 DB 위치·로트 UI가 표시된다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/warehouse/MWH-01`);
    await expect(page.getByText("위치·자재 찾기")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("선택 위치 상세")).toBeVisible();
  });

  test("업무 일지 페이지 로드", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/wiki`);
    await expect(page).toHaveURL(`${BASE}/wiki`);
    await expect(page.getByRole("main").getByText("업무 일지", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("리스크 페이지 로드", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/risk`);
    await expect(page).toHaveURL(`${BASE}/risk`);
    await expect(page.getByRole("main").getByText("리스크 관리", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("운영 What-if에서 증산 입고 계획을 계산한다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/simulation`);
    await expect(page.getByText("운영 What-if 시나리오", { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("변경 1 생산량 변화").fill("50");
    await page.getByRole("button", { name: "+ 생산 변경 추가" }).click();
    await expect(page.getByText("3개", { exact: true })).toBeVisible();
    await expect(page.getByText("통합 자재 입고 액션", { exact: true })).toBeVisible();
    await expect(page.getByText("CALCULATED", { exact: true })).toBeVisible();
  });

  test("SCM 조달 기준 마스터를 조회한다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/scm`);
    await expect(page.getByText("조달 기준 관리", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("PROCUREMENT MASTER", { exact: true })).toBeVisible();
    await expect(page.getByText("리드타임 범위 완료", { exact: true })).toBeVisible();
  });

  test("개발 이력에 최신 통합 작업이 기록된다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/devlog`);
    await expect(page.getByRole("main").getByText("개발 이력", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("운영 데이터 통합과 자재 허브", { exact: true })).toBeVisible();
    await expect(page.getByText("Day 6", { exact: true })).toBeVisible();
  });
});
