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
  const copiedLink = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedLink).toContain("/share?file=1234");
  await page.goto("/share?file=1234");
  await expect(page.getByRole("heading", { name: "example.txt" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Tải file xuống/i })).toHaveAttribute("href", /\/api\/quick-share\/public\/1234$/);
  await page.getByRole("button", { name: "Quay lại danh sách chia sẻ" }).click();
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

test("shows a locked screen on /share when disabled and recovers live when re-enabled", async ({ page }) => {
  const expiresAt = Date.now() + 60_000;
  const item = { code: "1234", name: "example.txt", size: 10, createdAt: new Date().toISOString(), expiresAt };
  let locked = true;
  await page.route("**/api/quick-share/public", route => {
    if (locked) {
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          code: "QUICK_SHARE_DISABLED",
          enabled: false,
          error: "Tính năng truyền file nhanh hiện đang bị quản trị viên khóa tạm thời.",
        }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, enabled: true, files: [item] }),
    });
  });

  const initialLoaded = page.waitForResponse(response => response.url().endsWith("/api/quick-share/public"));
  await page.goto("/share");
  await initialLoaded;

  await expect(page.getByRole("heading", { name: /Chia sẻ file/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tính năng truyền file đang tạm khóa" })).toBeVisible();
  await expect(page.getByText("Tính năng truyền file nhanh hiện đang bị quản trị viên khóa tạm thời.")).toBeVisible();
  await expect(page.locator("#tab-public")).toHaveCount(0);
  await expect(page.locator("#tab-private")).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  locked = false;
  const recovered = page.waitForResponse(response => response.url().endsWith("/api/quick-share/public") && response.status() === 200);
  await page.getByRole("button", { name: "Kiểm tra lại trạng thái" }).click();
  await recovered;

  await expect(page.locator("#tab-public")).toBeVisible();
  await expect(page.getByText("example.txt")).toBeVisible();
});

test("shows a locked screen on /share?file=1234 without exposing download controls", async ({ page }) => {
  const lockedBody = JSON.stringify({
    success: false,
    code: "QUICK_SHARE_DISABLED",
    enabled: false,
    error: "Tính năng truyền file nhanh hiện đang bị quản trị viên khóa tạm thời.",
  });
  await page.route("**/api/quick-share/public/1234/info", route =>
    route.fulfill({ status: 403, contentType: "application/json", body: lockedBody }),
  );
  await page.route("**/api/quick-share/public", route =>
    route.fulfill({ status: 403, contentType: "application/json", body: lockedBody }),
  );

  const infoLoaded = page.waitForResponse(response => response.url().endsWith("/api/quick-share/public/1234/info"));
  await page.goto("/share?file=1234");
  await infoLoaded;

  await expect(page.getByRole("heading", { name: /Chia sẻ file/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tính năng truyền file đang tạm khóa" })).toBeVisible();
  await expect(page.getByText("Tính năng truyền file nhanh hiện đang bị quản trị viên khóa tạm thời.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Tải file xuống/i })).toHaveCount(0);
  await expect(page.locator("#tab-public")).toHaveCount(0);
});

test("allows an admin to lock and unlock Quick Share from settings without exposing root storage path", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vps_terminal_active_tab", "settings"));
  await page.route("**/api/auth/verify", route =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, user: { id: "admin-1", username: "opsadmin", role: "admin" } }),
    }),
  );
  await page.route("**/api/settings", route =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        route.request().method() === "POST"
          ? { success: true }
          : { success: true, settings: { fontSize: "14", theme: "dark-classic", defaultTerminalCwd: "" } },
      ),
    }),
  );
  await page.route("**/api/security", route =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        twoFactorEnabled: false,
        twoFactorAvailable: true,
        recoveryCodesRemaining: 0,
        sessions: [],
      }),
    }),
  );

  let enabled = true;
  const postedPayloads: Array<{ enabled?: boolean }> = [];
  await page.route("**/api/settings/quick-share", route => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as { enabled?: boolean };
      postedPayloads.push(payload);
      if (typeof payload.enabled === "boolean") enabled = payload.enabled;
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        enabled,
        maxFileMb: 2048,
        ttlMinutes: 1440,
        activeFiles: 1,
        activeBytes: 1024,
        maxTotalBytes: 21474836480,
      }),
    });
  });

  const loaded = page.waitForResponse(response => response.url().endsWith("/api/settings/quick-share") && response.request().method() === "GET");
  await page.goto("/");
  await loaded;

  await expect(page.getByRole("heading", { name: "Truyền File Nhanh (/share)" })).toBeVisible();
  await expect(page.getByText("Đang mở truy cập", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Đường dẫn lưu trữ")).toHaveCount(0);
  await expect(page.getByText("Đường dẫn lưu trữ")).toHaveCount(0);

  const lockRequest = page.waitForResponse(response => response.url().endsWith("/api/settings/quick-share") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Khóa truy cập" }).click();
  await lockRequest;

  expect(postedPayloads.at(-1)).toEqual({ enabled: false });
  await expect(page.getByText("Đã khóa truy cập", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mở truy cập" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Đã khóa truy cập tính năng truyền file nhanh (/share)." })).toBeVisible();

  const unlockRequest = page.waitForResponse(response => response.url().endsWith("/api/settings/quick-share") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Mở truy cập" }).click();
  await unlockRequest;

  expect(postedPayloads.at(-1)).toEqual({ enabled: true });
  await expect(page.getByText("Đang mở truy cập", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Khóa truy cập" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Đã mở lại truy cập tính năng truyền file nhanh (/share)." })).toBeVisible();
});
