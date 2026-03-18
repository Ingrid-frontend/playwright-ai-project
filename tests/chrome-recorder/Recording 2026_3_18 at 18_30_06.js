test.describe("Recording 2026/3/18 at 18:30:06", () => {
  test("tests Recording 2026/3/18 at 18:30:06", async ({ page }) => {
    await page.setViewportSize({
          width: 1344,
          height: 928
        })
    await page.goto("https://stage.huilianyi.com/main/home");
    await page.locator("li.ant-menu-item-active span").click()
    await page.locator("div.advanced-search-filter-tags-list svg").click()
  });
});
