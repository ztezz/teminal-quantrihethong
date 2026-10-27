import { expect, test } from "@playwright/test";

test("Share is installable and its shell opens offline", async ({ page, context }) => {
  await page.goto("/share");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/share/manifest.webmanifest");

  const manifest = await page.request.get("/share/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ start_url: "/share", scope: "/share", display: "standalone" });

  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/share");
    return registration?.active?.scriptURL.endsWith("/share-sw.js") ?? false;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/share-sw.js") ?? false)).toBe(true);

  await context.setOffline(true);
  await expect(page.getByText("Đang mất mạng.", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Chia sẻ file/ })).toBeVisible();
  await context.setOffline(false);

  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
});
