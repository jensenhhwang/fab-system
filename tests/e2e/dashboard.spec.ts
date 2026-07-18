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

  test("1WMS 재고를 3FAB 일사용량 기준으로 표시한다", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole("heading", { name: "Campus Control Tower" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("1WMS → 3FAB MATERIAL FLOW")).toBeVisible();
    await expect(page.getByText("3FAB 일사용량")).toBeVisible();
    await expect(page.getByText("통합 잔여", { exact: true })).toBeVisible();
    await expect(page.getByText("M20", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("M21", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("M22", { exact: true }).last()).toBeVisible();
    await page.getByRole("button", { name: "M20", exact: true }).click();
    await expect(page.getByText("1WMS → M20 MATERIAL FLOW")).toBeVisible();
    await expect(page.getByText("M20 배분재고")).toBeVisible();
    await expect(page.getByText("M20 일사용량")).toBeVisible();
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

  test("공정별 사용량에서 3FAB 전체 비교와 Fab별 3D를 전환한다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/usage`);
    await expect(page).toHaveURL(`${BASE}/usage`);
    await expect(page.getByRole("main").getByText("공정별 사용량", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("3FAB USAGE COMPARISON", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "전체 3FAB", exact: true })).toBeVisible();
    await expect(page.getByLabel("공정별 사용량 Fab 범위").getByRole("button")).toHaveText(["M20 · HBM", "M21 · DRAM", "M22 · NAND", "전체 3FAB"]);
    await expect(page.getByText("P01–P10 PROCESS DICTIONARY", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /P01 산화막 Oxidation/ }).click();
    await expect(page.getByText(/실리콘 표면에 균일한 절연막/)).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.getByRole("button", { name: "M21 · DRAM", exact: true }).click();
    await expect(page.getByTestId("material-table")).toContainText("M21 · DRAM");
    await expect(page.getByTestId("material-table")).toContainText("월 소요량");
    await expect(page.locator("canvas")).toHaveCount(1);
    await expect(page.getByText("M21 · DRAM 공정 3D", { exact: true })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("학습");
    await page.goto(`${BASE}/usage?fab=M22`);
    await expect(page.getByText("M22 · NAND 공정 3D", { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test("M20 규칙형 에이전트가 발주·WMS·MES·공정을 조율하고 물리 확인으로 완주한다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/mes`);
    await page.getByRole("button", { name: "작업지시 목록", exact: true }).click();
    const createPilot = page.getByRole("button", { name: "+ M20 에이전트 흐름", exact: true });
    const pilotCard = page.getByText(/M20 VERTICAL SLICE/);
    if (!(await pilotCard.isVisible().catch(() => false)) && await createPilot.isVisible().catch(() => false)) {
      await createPilot.click();
      await expect(createPilot).not.toBeVisible({ timeout: 15_000 });
    }
    await expect(pilotCard).toBeVisible({ timeout: 15_000 });
    const completed = page.getByText("M20 대표 흐름 완주 · 수직 원장 연결 완료", { exact: true });
    await expect(page.getByText("발주 담당", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("WMS 담당", { exact: true })).toBeVisible();
    const pendingApproval = page.getByRole("button", { name: "발주 승인 · Outbox 적재", exact: true });
    const outboxPending = page.getByText(/Outbox PENDING/);
    if (!(await outboxPending.isVisible().catch(() => false))) {
      await expect(pendingApproval).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Outbox 미생성/)).toBeVisible();
      await pendingApproval.click();
      await expect(outboxPending).toBeVisible({ timeout: 15_000 });
    }
    if (!(await completed.isVisible().catch(() => false))) {
      let pickDebug = "not requested";
      const pickConfirm = page.getByRole("button", { name: "현장 피킹 완료 확인", exact: true });
      await expect(pickConfirm).toBeVisible({ timeout: 15_000 });
      if (await pickConfirm.isVisible()) {
        await pickConfirm.click();
        await expect(page.getByText(/WMS 에이전트가 FEFO Lot/)).toBeVisible();
        const pickResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/mes/workorders/`) && response.url().endsWith("/pick") && response.request().method() === "POST");
        await page.getByRole("button", { name: "현장 피킹 완료 확정", exact: true }).click();
        const pickResponse = await pickResponsePromise;
        const pickBody = await pickResponse.text();
        pickDebug = pickBody;
        expect(pickResponse.status(), pickBody).toBe(200);
      }
      for (const label of ["출고장 STAGED 확인", "운송 출발 확인", "M20 PRS 도착 확인", "P10 Line-side 인계 확인", "P10 공정 투입·소비 확인"]) {
        const action = page.getByRole("button", { name: label, exact: true });
        await expect(action, label === "출고장 STAGED 확인" ? `pick response: ${pickDebug}` : undefined).toBeVisible({ timeout: 15_000 });
        await action.click();
      }
    }
    await expect(completed).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/M20 장비 452대 · P10 36대/)).toBeVisible();
    await expect(page.getByText("공정 담당", { exact: true })).toBeVisible();
    await page.goto(`${BASE}/usage?fab=M20&material=PKG-001`);
    const pkgRow = page.locator("tbody tr").filter({ hasText: "PKG-001" });
    await expect(pkgRow).toContainText("98", { timeout: 15_000 });
    await page.goto(`${BASE}/campus?fab=M20&material=PKG-001`);
    await expect(page.getByText("LEDGER + PLAN", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Fab별 Allocation·TransferOrder 운영 원장이 아직 없어/)).toHaveCount(0);
  });

  test("Campus Twin에서 전체 창고와 실제 TransferOrder 피드를 표시한다", async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    await loginAsAdmin(page);
    await page.goto(`${BASE}/campus`);
    await expect(page.getByRole("heading", { name: "Campus Material Twin" })).toBeVisible({ timeout: 15_000 });
    const campusCanvas = page.locator("canvas").first();
    await expect(campusCanvas).toBeVisible();
    const campusFallback = page.getByTestId("campus-scene-fallback");
    const isCampusContextLost = () => campusCanvas.evaluate((canvas) => {
      const campusWebGlCanvas = canvas as HTMLCanvasElement;
      const gl = campusWebGlCanvas.getContext("webgl2") ?? campusWebGlCanvas.getContext("webgl");
      return gl?.isContextLost() ?? true;
    });
    const hasUsableCampusScene = async () => !(await isCampusContextLost()) || await campusFallback.isVisible().catch(() => false);
    await page.waitForTimeout(3_000);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
    await expect.poll(hasUsableCampusScene).toBe(true);
    await expect(page.getByText("ALL WAREHOUSES", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /MWH-01 · 자동화 자재창고/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /MWH-02 · 항온 자재창고/ })).toBeVisible();
    await expect(page.getByText(/TRANSFER FEED ·/)).toBeVisible();
    await expect(page.getByText("모든 자재 동시 표시 · 완료 후 재순환 없음", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "전체 자재", exact: true })).toHaveClass(/bg-\[#20262D\]/);
    await expect(page.getByLabel("Campus 추적 자재")).toHaveValue("");
    await expect(page).not.toHaveURL(/material=/);
    await expect(page.getByText("ALL MATERIALS SUMMARY", { exact: true })).toBeVisible();
    await expect(page.getByText("수량 단위 혼합 없이 건수와 종류로 집계", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "일시정지", exact: true }).click();
    await expect(page.getByText("PAUSED", { exact: true })).toBeVisible();
    const sceneTime = page.getByTestId("scene-reference-time");
    const pausedTime = await sceneTime.textContent();
    await page.waitForTimeout(1_200);
    await expect(sceneTime).toHaveText(pausedTime ?? "");
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
    await expect.poll(hasUsableCampusScene).toBe(true);
    await page.getByRole("button", { name: "현재로 복귀", exact: true }).click();
    await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
    await expect.poll(hasUsableCampusScene).toBe(true);

    const materialSelect = page.getByLabel("Campus 추적 자재");
    await materialSelect.selectOption({ index: 1 });
    await expect(materialSelect).not.toHaveValue("");
    await expect(page.getByText("SELECTED MATERIAL", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/material=/);
    await expect(campusCanvas).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
    await expect.poll(hasUsableCampusScene).toBe(true);
  });

  test("창고 Capacity와 표준 시설 순서가 표시된다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/warehouse`);
    await expect(page.getByRole("main").getByText("창고 Capacity", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("main").getByText("운영 보관·공급시설", { exact: true })).toBeVisible();
    await expect(page.locator('a[href^="/warehouse/"]').first()).toBeVisible();
  });

  test("창고 상세에서 DB 위치·로트 UI가 표시된다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/warehouse/MWH-01`);
    await expect(page.getByText("위치·자재 찾기")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("선택 위치 상세")).toBeVisible();
  });

  test("Twin에서 다른 SKU와 창고를 선택해도 전체 Capacity를 숨기지 않는다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/warehouse/MWH-01?material=GAS-001&facility=MWH-01`);
    await expect(page.getByPlaceholder("자재명, 코드, 위치 검색")).toHaveValue("");
    await expect(page.getByText("사용 위치", { exact: true }).locator("..")).toContainText(/[1-9]\d* slot/);
    await expect(page.getByText("← Campus 전체뷰", { exact: true })).toBeVisible();
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
    await expect(page.getByText("1WMS / 3FAB Control Tower 재설계", { exact: true })).toBeVisible();
    await expect(page.getByText("Day 7", { exact: true })).toBeVisible();
    await expect(page.getByText("WMS–3FAB Campus Material Twin 1차", { exact: true })).toBeVisible();
    await expect(page.getByText("Day 8", { exact: true })).toBeVisible();
    await expect(page.getByText("M20 규칙형 운영 에이전트 1차", { exact: true })).toBeVisible();
    await expect(page.getByText("Day 9", { exact: true })).toBeVisible();
    await expect(page.getByText("Campus 전체 자재·Scene Clock", { exact: true })).toBeVisible();
    await expect(page.getByText("Day 10", { exact: true })).toBeVisible();
    await expect(page.getByText("M20=HBM, M21=DRAM, M22=NAND를 운영 매핑으로 명시하고 제품은 Fab의 하위 속성으로 정리", { exact: true })).toBeVisible();
    await expect(page.getByText("운영 데이터 통합과 자재 허브", { exact: true })).toBeVisible();
    await expect(page.getByText("Day 6", { exact: true })).toBeVisible();
  });
});
