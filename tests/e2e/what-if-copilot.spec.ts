import { expect, test } from "@playwright/test";

test("운영 What-if가 지금 할 일을 실시간 행동 카드로 보여준다", async ({ page }) => {
  await page.goto("/login");
  await page.getByText("김구매").click();
  await page.waitForURL("/", { timeout: 15_000 });

  await page.goto("/simulation");
  const copilot = page.getByTestId("what-if-action-copilot");
  await expect(copilot).toBeVisible({ timeout: 15_000 });
  await expect(copilot.getByText("지금 할 일", { exact: true })).toBeVisible();
  await expect(copilot).toContainText(/AI 새 판단|AI 판단 재사용|안전 규칙 판단|AI 판단 갱신 중/, {
    timeout: 30_000,
  });

  const cards = page.getByTestId("what-if-action-card");
  if (await cards.count()) {
    await expect(cards.first()).toContainText("지금 할 일");
    await expect(cards.first().getByRole("button", { name: /근거/ })).toBeVisible();
    await expect(cards.first().getByRole("button", { name: "확인", exact: true })).toBeVisible();
  } else {
    await expect(copilot).toContainText(/지금 즉시 처리할 자재 행동이 없습니다|현재 제안은 모두 확인하거나 보류했습니다/);
  }
});
