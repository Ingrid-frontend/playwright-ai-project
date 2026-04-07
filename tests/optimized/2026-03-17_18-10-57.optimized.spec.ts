import { test, expect } from "@playwright/test";
import fs from "fs";
import { screenshotWhenStable } from "../../utils/screenshot";

test.use({
  storageState: "storage/loginState/stage.json",
});

test("test", async ({ page }) => {
  const tracingStarted = await page
    .context()
    .tracing.start({ screenshots: true, snapshots: true })
    .catch(() => false);

  const screenshotRoot = "screenshots/2026-03-17_18-10-57";
  const now = new Date();
  const runTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
  const testId = Math.random().toString(36).substring(2, 9);
  let browserInfo = "unknown";
  let runDir = "";
  const getScreenshotPath = (step: number, label: string) =>
    `${runDir}/step-${step}-${label}.png`;

  test.setTimeout(60000);
  await page.goto("https://stage.huilianyi.com/main/home");
  await expect(page).toHaveURL(/.*huilianyi.*/);
  browserInfo =
    (await page.context().browser()?.browserType().name()) || "unknown";
  runDir = `${screenshotRoot}/${runTimestamp}-${browserInfo}-${testId}`;
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }
  await test.step("step-1-报销单", async () => {
    const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(1, "before-报销单"),
    );
    console.log("📍 当前路由:", beforeRoute);
    try {
      const _locator = page
        .getByText("报销单")
        .filter({ visible: true })
        .first();
      await _locator.click({ force: true, delay: 100 });
    } catch (error) {
      console.log(
        `❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    const { path: afterPath, route: afterRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(1, "after-报销单"),
    );
    console.log("📍 当前路由:", afterRoute);
  });
  await test.step("step-2-action", async () => {
    const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(2, "before-action"),
    );
    console.log("📍 当前路由:", beforeRoute);
    try {
      const _locator = page
        .locator(".anticon.anticon-close > svg")
        .filter({ visible: true });
      await _locator.click({ force: true, delay: 100 });
    } catch (error) {
      console.log(
        `❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    const { path: afterPath, route: afterRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(2, "after-action"),
    );
    console.log("📍 当前路由:", afterRoute);
  });
  await test.step("step-3-1", async () => {
    const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(3, "before-1"),
    );
    console.log("📍 当前路由:", beforeRoute);
    try {
      await page
        .getByRole("cell", { name: "1", exact: true })
        .filter({ visible: true })
        .scrollIntoViewIfNeeded();
      await page
        .getByRole("cell", { name: "1", exact: true })
        .filter({ visible: true })
        .click({ force: true });
    } catch (error) {
      console.log(
        `❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    const { path: afterPath, route: afterRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(3, "after-1"),
    );
    console.log("📍 当前路由:", afterRoute);
  });
  await test.step("step-4-办公用品类", async () => {
    const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(4, "before-办公用品类"),
    );
    console.log("📍 当前路由:", beforeRoute);
    try {
      const _locator = page
        .getByText("办公用品类")
        .filter({ visible: true })
        .first();
      await _locator.click({ force: true, delay: 100 });
    } catch (error) {
      console.log(
        `❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    const { path: afterPath, route: afterRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(4, "after-办公用品类"),
    );
    console.log("📍 当前路由:", afterRoute);
  });
  await test.step("step-5-取-消", async () => {
    const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(5, "before-取-消"),
    );
    console.log("📍 当前路由:", beforeRoute);
    try {
      const _locator = page
        .getByRole("button", { name: "取 消" })
        .filter({ visible: true })
        .first();
      await _locator.click({ force: true, delay: 100 });
    } catch (error) {
      console.log(
        `❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    const { path: afterPath, route: afterRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(5, "after-取-消"),
    );
    console.log("📍 当前路由:", afterRoute);
  });
  await test.step("step-6-冲借款", async () => {
    const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(6, "before-冲借款"),
    );
    console.log("📍 当前路由:", beforeRoute);
    try {
      const _locator = page
        .getByText("冲借款")
        .nth(2)
        .filter({ visible: true });
      await _locator.click({ force: true, delay: 100 });
    } catch (error) {
      console.log(
        `❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    const { path: afterPath, route: afterRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(6, "after-冲借款"),
    );
    console.log("📍 当前路由:", afterRoute);
  });
  await test.step("step-7-取-消", async () => {
    const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(7, "before-取-消"),
    );
    console.log("📍 当前路由:", beforeRoute);
    try {
      const _locator = page
        .getByRole("button", { name: "取 消" })
        .filter({ visible: true })
        .first();
      await _locator.click({ force: true, delay: 100 });
    } catch (error) {
      console.log(
        `❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    const { path: afterPath, route: afterRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(7, "after-取-消"),
    );
    console.log("📍 当前路由:", afterRoute);
  });
  await test.step("step-8-返-回", async () => {
    const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(8, "before-返-回"),
    );
    console.log("📍 当前路由:", beforeRoute);
    try {
      const _locator = page
        .getByRole("button", { name: "返 回" })
        .filter({ visible: true })
        .first();
      await _locator.click({ force: true, delay: 100 });
    } catch (error) {
      console.log(
        `❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    const { path: afterPath, route: afterRoute } = await screenshotWhenStable(
      page,
      getScreenshotPath(8, "after-返-回"),
    );
    console.log("📍 当前路由:", afterRoute);
  });

  if (tracingStarted) {
    await page.context().tracing.stop({ path: `${runDir}/trace.zip` });
  }
});
