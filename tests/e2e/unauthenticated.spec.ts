import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/verify", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ success: false }),
    }),
  );
});

test("shows the unauthenticated login screen", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("NodeShell Control Center");
  await expect(page.getByRole("heading", { name: "Chào mừng trở lại" })).toBeVisible();
  await expect(page.getByPlaceholder("operator")).toHaveValue("root");
  await expect(page.getByPlaceholder("Nhập mật khẩu bảo mật")).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng nhập hệ thống" })).toBeEnabled();
});

test("publishes installable app metadata", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0f172a");

  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "NodeShell Control Center",
    start_url: "/",
    display: "standalone",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([expect.objectContaining({ src: "/icon.svg" })]),
  );
});

test("keeps login controls usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");

  const form = page.locator("form");
  await expect(form).toBeVisible();
  const bounds = await form.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await expect(page.getByRole("button", { name: "Đăng nhập hệ thống" })).toBeInViewport();
});

test("shows an invalid share code inline without leaving the page", async ({ page }) => {
  await page.route("**/api/quick-share/public", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, files: [] }) }),
  );
  await page.route("**/api/quick-share/1234/status", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: "Mã không đúng" }) }),
  );
  const loaded = page.waitForResponse((response) => response.url().endsWith("/api/quick-share/public"));
  await page.goto("/share");
  await loaded;
  await page.getByLabel("MÃ NHẬN FILE").fill("1234");
  await page.getByRole("button", { name: "Nhận và tải file" }).click();

  await expect(page.locator("#receive-error")).toContainText("Mã không đúng");
  await expect(page).toHaveURL(/\/share\/?$/);
});
