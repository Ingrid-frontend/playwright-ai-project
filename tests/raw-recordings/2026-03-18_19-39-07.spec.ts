import { test, expect } from "@playwright/test";

test.use({
  storageState: "storage/loginState/stage.json",
});

test("test", async ({ page }) => {
  await page.goto("https://stage.huilianyi.com/main/home");
  await page.getByText("账本").click();
  await page.getByRole("cell", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "取 消" }).click();
});
