# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.ts >> 대시보드 >> 재고 현황 페이지 로드
- Location: tests/e2e/dashboard.spec.ts:17:7

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation to "https://fab-system-phi.vercel.app/" until "load"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - img "SK hynix" [ref=e6]
        - generic [ref=e8]: FAB 자재관리
      - generic [ref=e9]:
        - heading "로그인" [level=1] [ref=e10]
        - paragraph [ref=e11]: 이천 M14/M16 자재관리 시스템
      - generic [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e14]: 이메일
          - textbox "email@fab.skh" [ref=e15]: admin@fab.skh
        - generic [ref=e16]:
          - generic [ref=e17]: 비밀번호
          - textbox "비밀번호 입력" [ref=e18]: fab1234!
        - generic [ref=e19]: 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.
        - button "로그인" [ref=e20]
    - generic [ref=e21]:
      - paragraph [ref=e22]: "데모 계정 (비밀번호: fab1234!)"
      - generic [ref=e23]:
        - button "ADMIN 황지훈 구매본부 자재관리팀" [active] [ref=e24]:
          - generic [ref=e26]: ADMIN
          - generic [ref=e27]: 황지훈
          - generic [ref=e28]: 구매본부 자재관리팀
        - button "자재관리팀 김재현 구매본부 자재관리팀" [ref=e29]:
          - generic [ref=e31]: 자재관리팀
          - generic [ref=e32]: 김재현
          - generic [ref=e33]: 구매본부 자재관리팀
        - button "생산관리팀 이수진 생산관리팀" [ref=e34]:
          - generic [ref=e36]: 생산관리팀
          - generic [ref=e37]: 이수진
          - generic [ref=e38]: 생산관리팀
        - button "물류/인프라팀 박민준 물류/인프라팀" [ref=e39]:
          - generic [ref=e41]: 물류/인프라팀
          - generic [ref=e42]: 박민준
          - generic [ref=e43]: 물류/인프라팀
  - alert [ref=e44]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | const BASE = "https://fab-system-phi.vercel.app";
  4  | 
  5  | async function loginAsAdmin(page: import("@playwright/test").Page) {
  6  |   await page.goto(`${BASE}/login`);
  7  |   await page.getByText("황지훈").click();
> 8  |   await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
     |              ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
  9  | }
  10 | 
  11 | test.describe("대시보드", () => {
  12 |   test("대시보드 메인 페이지 로드", async ({ page }) => {
  13 |     await loginAsAdmin(page);
  14 |     await expect(page.getByText("FAB 자재관리")).toBeVisible({ timeout: 10_000 });
  15 |   });
  16 | 
  17 |   test("재고 현황 페이지 로드", async ({ page }) => {
  18 |     await loginAsAdmin(page);
  19 |     await page.goto(`${BASE}/inventory`);
  20 |     await expect(page).toHaveURL(`${BASE}/inventory`);
  21 |     await expect(page.getByText("재고")).toBeVisible({ timeout: 10_000 });
  22 |   });
  23 | 
  24 |   test("공정별 사용량 페이지 로드", async ({ page }) => {
  25 |     await loginAsAdmin(page);
  26 |     await page.goto(`${BASE}/usage`);
  27 |     await expect(page).toHaveURL(`${BASE}/usage`);
  28 |     await expect(page.getByText("사용량")).toBeVisible({ timeout: 10_000 });
  29 |   });
  30 | 
  31 |   test("업무 일지 페이지 로드", async ({ page }) => {
  32 |     await loginAsAdmin(page);
  33 |     await page.goto(`${BASE}/wiki`);
  34 |     await expect(page).toHaveURL(`${BASE}/wiki`);
  35 |     await expect(page.getByText("업무 일지").or(page.getByText("Wiki")).or(page.getByText("일지"))).toBeVisible({ timeout: 10_000 });
  36 |   });
  37 | 
  38 |   test("리스크 페이지 로드", async ({ page }) => {
  39 |     await loginAsAdmin(page);
  40 |     await page.goto(`${BASE}/risk`);
  41 |     await expect(page).toHaveURL(`${BASE}/risk`);
  42 |     await expect(page.getByText("리스크").or(page.getByText("Risk"))).toBeVisible({ timeout: 10_000 });
  43 |   });
  44 | });
  45 | 
```