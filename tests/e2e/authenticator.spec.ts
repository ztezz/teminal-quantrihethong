import { test, expect } from "@playwright/test";
import { encryptVaultValue, importVaultKey } from "../../lib/client/vault-crypto";

test("shows multiple 2FA codes in a separate wallet", async ({ page }) => {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const keyText = Buffer.from(rawKey).toString("base64url");
  const key = await importVaultKey(keyText);
  const configs = [
    { title: "GitHub", account: "alice@example.com", secret: "JBSWY3DPEHPK3PXP" },
    { title: "Cloudflare", account: "alice@example.com", secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" },
  ];
  const items = await Promise.all(configs.map(async (value, index) => {
    const id = `00000000-0000-4000-8000-00000000000${index + 1}`;
    return {
      id, version: 1, pinned: false, createdAt: new Date().toISOString(),
      envelope: await encryptVaultValue({ title: value.title, type: "totp", tags: [], folder: "" }, key, `item:${id}:envelope`),
      content: await encryptVaultValue({ body: "", totp: { secret: value.secret, issuer: value.title, account: value.account, algorithm: "SHA1", digits: 6, period: 30 } }, key, `item:${id}:content`),
    };
  }));
  await page.addInitScript(() => localStorage.setItem("vps_terminal_active_tab", "authenticator"));
  await page.route("**/api/auth/verify", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, user: { id: "root", username: "root", role: "root" } }) }));
  await page.route("**/api/vault/config", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, key: keyText }) }));
  await page.route("**/api/vault/items?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, items }) }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ví 2FA" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(2);
  await expect(page.locator("article").filter({ hasText: "GitHub" }).locator(".font-mono")).toHaveText(/^\d{6}$/);
  await expect(page.locator("article").filter({ hasText: "Cloudflare" }).locator(".font-mono")).toHaveText(/^\d{6}$/);
  await expect(page.getByRole("button", { name: "Sổ Ghi Chú" })).toBeVisible();
});
