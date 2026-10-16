import { expect, test } from "@playwright/test";

test("only the uploader can remove a listed file, and its link can be copied", async ({ page, context }) => {
  const expiresAt = Date.now() + 60_000;
  const item = { code: "1234", name: "example.txt", size: 10, createdAt: new Date().toISOString(), expiresAt };
  await page.addInitScript(({ expiresAt }) => {
    localStorage.setItem("nodeshell_public_share_owned", JSON.stringify({ "1234": { token: "uploader-secret", expiresAt } }));
  }, { expiresAt });
  await page.route("**/api/quick-share/public", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ files: [item] }) }));
  let deleted = false;
  await page.route("**/api/quick-share/public/1234", route => {
    if (route.request().method() !== "DELETE") return route.continue();
    expect(route.request().headers()["x-quick-share-token"]).toBe("uploader-secret");
    deleted = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true }) });
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const visitor = await context.newPage();
  await visitor.route("**/api/quick-share/public", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ files: [item] }) }));
  const visitorLoaded = visitor.waitForResponse(response => response.url().endsWith("/api/quick-share/public"));
  await visitor.goto("/share");
  await visitorLoaded;
  await expect(visitor.getByRole("button", { name: "Gỡ example.txt" })).toHaveCount(0);
  await visitor.close();
  const loaded = page.waitForResponse(response => response.url().endsWith("/api/quick-share/public"));
  await page.goto("/share");
  await loaded;
  await page.getByRole("button", { name: "Sao chép liên kết example.txt" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("/api/quick-share/public/1234");
  await page.getByRole("button", { name: "Gỡ example.txt" }).click();
  await expect(page.getByText("Đã gỡ example.txt")).toBeVisible();
  expect(deleted).toBe(true);
});

test("resumes an interrupted public upload using the server offset", async ({ page }) => {
  const expiresAt = Date.now() + 60_000;
  await page.addInitScript(({ expiresAt }) => {
    localStorage.setItem("nodeshell_public_share_upload", JSON.stringify({ code: "2222", uploadToken: "upload-secret", name: "part.txt", size: 10, lastModified: 1000, expiresAt }));
  }, { expiresAt });
  let ready = false;
  await page.route("**/api/quick-share/public", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ files: ready ? [{ code: "2222", name: "part.txt", size: 10, createdAt: new Date().toISOString(), expiresAt }] : [] }) }));
  await page.route("**/api/quick-share/2222/upload", route => {
    expect(route.request().headers()["x-quick-share-token"]).toBe("upload-secret");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ offset: 4, ready: false, expiresAt }) });
  });
  let resumed = false;
  await page.route("**/api/quick-share/2222", route => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["x-upload-offset"]).toBe("4");
    expect(route.request().postDataBuffer()?.toString()).toBe("456789");
    resumed = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ offset: 10 }) });
  });
  await page.route("**/api/quick-share/2222/complete", route => {
    ready = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ expiresAt }) });
  });
  const loaded = page.waitForResponse(response => response.url().endsWith("/api/quick-share/public"));
  await page.goto("/share");
  await loaded;
  await expect(page.getByText("Phiên upload chưa hoàn tất: part.txt")).toBeVisible();
  await page.locator(".quick-share-interrupted input[type=file]").evaluate((input: HTMLInputElement) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["0123456789"], "part.txt", { type: "text/plain", lastModified: 1000 }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(page.getByText("Đã tải lên 1 file.", { exact: false })).toBeVisible();
  expect(resumed).toBe(true);
  await expect(page.getByRole("button", { name: "Gỡ part.txt" })).toBeVisible();
});
