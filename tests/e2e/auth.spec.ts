import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const DEMO_ACCOUNTS = [
  { label: "ADMIN", name: "김구매", landingHref: "/" },
  { label: "자재관리팀", name: "이자재", landingHref: "/inventory" },
  { label: "생산관리팀", name: "최생산", landingHref: "/mes" },
  { label: "물류/인프라팀", name: "박물류", landingHref: "/warehouse" },
];

test.describe("로그인 페이지", () => {
  test("로그인 페이지가 정상 렌더링된다", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.getByRole("heading", { name: "역할을 선택하세요" })).toBeVisible();
    await expect(page.getByText("이천 3FAB Campus · M20/M21/M22 자재관리 시스템")).toBeVisible();
  });

  test("데모 계정 버튼 4개가 모두 보인다", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    for (const account of DEMO_ACCOUNTS) {
      await expect(page.getByRole("button", { name: new RegExp(account.name) })).toBeVisible();
    }
  });
});

test.describe("데모 계정 로그인", () => {
  for (const acc of DEMO_ACCOUNTS) {
    test(`${acc.label} (${acc.name}) 로그인 → 대시보드 이동`, async ({ page }) => {
      await page.goto(`${BASE}/login`);
      await page.getByText(acc.name, { exact: true }).click();
      await expect(page).toHaveURL(`${BASE}${acc.landingHref}`, { timeout: 15_000 });
      await expect(page.getByText(acc.name, { exact: true })).toBeVisible();
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
    await page.getByText("김구매", { exact: true }).click();
    await page.waitForURL(`${BASE}/`, { timeout: 15_000 });

    await page.goto(`${BASE}/login`);
    await expect(page).toHaveURL(`${BASE}/`, { timeout: 10_000 });
  });
});
