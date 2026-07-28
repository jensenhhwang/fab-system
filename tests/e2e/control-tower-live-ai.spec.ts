import { expect, test } from "@playwright/test";

test("관제탑 라이브가 네 에이전트의 자동 판단 상태를 보여준다", async ({ page }) => {
  await page.goto("/login");
  await page.getByText("김구매", { exact: true }).click();
  await page.waitForURL("/");

  await page.getByRole("link", { name: "관제탑 라이브" }).click();
  await expect(page).toHaveURL(/\/control-tower-live$/);
  await expect(page.getByRole("heading", { name: /관제탑 라이브/ })).toBeVisible();
  await expect(page.getByText(/OpenAI 연결/)).toBeVisible();
  await expect(page.getByText("에이전트 공개 판단 · 대화")).toBeVisible();
  await expect(page.getByText("RULE + LLM")).toBeVisible();
  await expect(page.getByText("LLM 판단", { exact: true })).toHaveCount(3);
});
