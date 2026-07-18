import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const DEMO_ACCOUNTS = [
  { label: "ADMIN", email: "admin@fab.skh", name: "황지훈" },
  { label: "자재관리팀", email: "materials@fab.skh", name: "김재현" },
  { label: "생산관리팀", email: "production@fab.skh", name: "이수진" },
  { label: "물류/인프라팀", email: "logistics@fab.skh", name: "박민준" },
];

test.describe("로그인 페이지", () => {
  test("로그인 페이지가 정상 렌더링된다", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
    await expect(page.getByText("이천 3FAB Campus · M20/M21/M22 자재관리 시스템")).toBeVisible();
    await expect(page.getByPlaceholder("email@fab.skh")).toBeVisible();
    await expect(page.getByText("데모 계정")).toBeVisible();
  });

  test("데모 계정 버튼 4개가 모두 보인다", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.getByText("황지훈")).toBeVisible();
    await expect(page.getByText("김재현")).toBeVisible();
    await expect(page.getByText("이수진")).toBeVisible();
    await expect(page.getByText("박민준")).toBeVisible();
  });

  test("잘못된 비밀번호로 로그인 시 에러 메시지", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByPlaceholder("email@fab.skh").fill("admin@fab.skh");
    await page.getByPlaceholder("비밀번호 입력").fill("wrongpassword");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page.getByText("이메일 또는 비밀번호가 올바르지 않습니다")).toBeVisible({ timeout: 10_000 });
  });

  test("이메일/비밀번호 직접 입력으로 ADMIN 로그인", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByPlaceholder("email@fab.skh").fill("admin@fab.skh");
    await page.getByPlaceholder("비밀번호 입력").fill("fab1234!");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(`${BASE}/`, { timeout: 15_000 });
  });
});

test.describe("데모 계정 로그인", () => {
  for (const acc of DEMO_ACCOUNTS) {
    test(`${acc.label} (${acc.name}) 로그인 → 대시보드 이동`, async ({ page }) => {
      await page.goto(`${BASE}/login`);
      await page.getByText(acc.name).click();
      await expect(page).toHaveURL(`${BASE}/`, { timeout: 15_000 });
    });
  }
});

test.describe("인증 리다이렉트", () => {
  test("미로그인 상태에서 대시보드 접근 시 로그인 페이지로 이동", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("로그인 상태에서 /login 접근 시 대시보드로 리다이렉트", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByText("황지훈").click();
    await page.waitForURL(`${BASE}/`, { timeout: 15_000 });

    await page.goto(`${BASE}/login`);
    await expect(page).toHaveURL(`${BASE}/`, { timeout: 10_000 });
  });
});
