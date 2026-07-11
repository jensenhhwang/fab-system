# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> 데모 계정 로그인 >> 물류/인프라팀 (박민준) 로그인 → 대시보드 이동
- Location: tests/e2e/auth.spec.ts:48:9

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected: "https://fab-system-phi.vercel.app/"
Received: "https://fab-system-phi.vercel.app/login"
Timeout:  15000ms

Call log:
  - Expect "toHaveURL" with timeout 15000ms
    34 × unexpected value "https://fab-system-phi.vercel.app/login"

```

```yaml
- img "SK hynix"
- text: FAB 자재관리
- heading "로그인" [level=1]
- paragraph: 이천 M14/M16 자재관리 시스템
- text: 이메일
- textbox "email@fab.skh": logistics@fab.skh
- text: 비밀번호
- textbox "비밀번호 입력": fab1234!
- text: 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.
- button "로그인"
- paragraph: "데모 계정 (비밀번호: fab1234!)"
- button "ADMIN 황지훈 구매본부 자재관리팀"
- button "자재관리팀 김재현 구매본부 자재관리팀"
- button "생산관리팀 이수진 생산관리팀"
- button "물류/인프라팀 박민준 물류/인프라팀"
- alert
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | const BASE = "https://fab-system-phi.vercel.app";
  4  | 
  5  | const DEMO_ACCOUNTS = [
  6  |   { label: "ADMIN", email: "admin@fab.skh", name: "황지훈" },
  7  |   { label: "자재관리팀", email: "materials@fab.skh", name: "김재현" },
  8  |   { label: "생산관리팀", email: "production@fab.skh", name: "이수진" },
  9  |   { label: "물류/인프라팀", email: "logistics@fab.skh", name: "박민준" },
  10 | ];
  11 | 
  12 | test.describe("로그인 페이지", () => {
  13 |   test("로그인 페이지가 정상 렌더링된다", async ({ page }) => {
  14 |     await page.goto(`${BASE}/login`);
  15 |     await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  16 |     await expect(page.getByText("이천 M14/M16 자재관리 시스템")).toBeVisible();
  17 |     await expect(page.getByPlaceholder("email@fab.skh")).toBeVisible();
  18 |     await expect(page.getByText("데모 계정")).toBeVisible();
  19 |   });
  20 | 
  21 |   test("데모 계정 버튼 4개가 모두 보인다", async ({ page }) => {
  22 |     await page.goto(`${BASE}/login`);
  23 |     await expect(page.getByText("황지훈")).toBeVisible();
  24 |     await expect(page.getByText("김재현")).toBeVisible();
  25 |     await expect(page.getByText("이수진")).toBeVisible();
  26 |     await expect(page.getByText("박민준")).toBeVisible();
  27 |   });
  28 | 
  29 |   test("잘못된 비밀번호로 로그인 시 에러 메시지", async ({ page }) => {
  30 |     await page.goto(`${BASE}/login`);
  31 |     await page.getByPlaceholder("email@fab.skh").fill("admin@fab.skh");
  32 |     await page.getByPlaceholder("비밀번호 입력").fill("wrongpassword");
  33 |     await page.getByRole("button", { name: "로그인" }).click();
  34 |     await expect(page.getByText("이메일 또는 비밀번호가 올바르지 않습니다")).toBeVisible({ timeout: 10_000 });
  35 |   });
  36 | 
  37 |   test("이메일/비밀번호 직접 입력으로 ADMIN 로그인", async ({ page }) => {
  38 |     await page.goto(`${BASE}/login`);
  39 |     await page.getByPlaceholder("email@fab.skh").fill("admin@fab.skh");
  40 |     await page.getByPlaceholder("비밀번호 입력").fill("fab1234!");
  41 |     await page.getByRole("button", { name: "로그인" }).click();
  42 |     await expect(page).toHaveURL(`${BASE}/`, { timeout: 15_000 });
  43 |   });
  44 | });
  45 | 
  46 | test.describe("데모 계정 로그인", () => {
  47 |   for (const acc of DEMO_ACCOUNTS) {
  48 |     test(`${acc.label} (${acc.name}) 로그인 → 대시보드 이동`, async ({ page }) => {
  49 |       await page.goto(`${BASE}/login`);
  50 |       await page.getByText(acc.name).click();
> 51 |       await expect(page).toHaveURL(`${BASE}/`, { timeout: 15_000 });
     |                          ^ Error: expect(page).toHaveURL(expected) failed
  52 |     });
  53 |   }
  54 | });
  55 | 
  56 | test.describe("인증 리다이렉트", () => {
  57 |   test("미로그인 상태에서 대시보드 접근 시 로그인 페이지로 이동", async ({ page }) => {
  58 |     await page.goto(`${BASE}/`);
  59 |     await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  60 |   });
  61 | 
  62 |   test("로그인 상태에서 /login 접근 시 대시보드로 리다이렉트", async ({ page }) => {
  63 |     await page.goto(`${BASE}/login`);
  64 |     await page.getByText("황지훈").click();
  65 |     await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
  66 | 
  67 |     await page.goto(`${BASE}/login`);
  68 |     await expect(page).toHaveURL(`${BASE}/`, { timeout: 10_000 });
  69 |   });
  70 | });
  71 | 
```