test.describe("Recording 2026/3/18 at 18:24:03", () => {
  test("tests Recording 2026/3/18 at 18:24:03", async ({ page }) => {
    await page.setViewportSize({
          width: 1344,
          height: 928
        })
    await page.goto("https://stage.huilianyi.com/main/home");
    await page.locator("li.ant-menu-item-active span").click()
    await page.locator("div.advanced-search-filter-tags-list svg").click()
    await page.locator("tr.ant-table-row-hover > td.table-row-left-align").click()
    await page.locator("div.business-block > div > div:nth-of-type(1) > div > div:nth-of-type(1) > button").click()
    await page.locator("button.right-gap").click()
    await page.locator("#slide-content-id > div > div > div > div > div > div button:nth-of-type(2)").click()
  });
});
