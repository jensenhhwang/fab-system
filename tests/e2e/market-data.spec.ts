import { expect, test } from "@playwright/test";

test("시장 화면이 실제 소스 상태와 데모 가격을 구분한다", async ({ page }) => {
  await page.goto("/login");
  await page.getByText("황지훈").click();
  await page.waitForURL("/", { timeout: 15_000 });

  await page.goto("/market");
  await expect(page.getByText("LIVE DEMAND SIGNALS")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("TWSE 상장사 월매출")).toBeVisible();
  await expect(page.getByText("SEC EDGAR 공시")).toBeVisible();
  await expect(page.getByText("60초 자동 갱신")).toBeVisible();
  await expect(page.getByText("DEMO").first()).toBeVisible();
  await expect(page.getByText("대만 전자 공급망 월매출")).toBeVisible();
});
