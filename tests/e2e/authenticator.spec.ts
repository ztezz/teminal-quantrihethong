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
  let revoked = false;
  await page.route('**/api/vault/shares', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, shares: revoked ? [] : [{ id: 'share-1', itemId: items[0].id, createdAt: Date.now(), expiresAt: Date.now() + 300_000 }] }) }));
  await page.route(`**/api/vault/items/${items[0].id}/shares/share-1`, route => { revoked = true; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) }); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ví 2FA" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(2);
  await expect(page.locator("article").filter({ hasText: "GitHub" }).locator(".font-mono")).toHaveText(/^\d{6}$/);
  await expect(page.locator("article").filter({ hasText: "Cloudflare" }).locator(".font-mono")).toHaveText(/^\d{6}$/);
  await page.locator("article").filter({ hasText: "GitHub" }).getByRole('button', { name: 'Sửa' }).click();
  await expect(page.getByRole('dialog', { name: 'Sửa mã 2FA' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sửa mã 2FA' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Thêm mã' }).click();
  await expect(page.getByRole('dialog', { name: 'Thêm mã 2FA' })).toBeVisible();
  await page.getByRole('button', { name: 'Hủy' }).click();
  await page.getByRole('button', { name: 'Quản lý link' }).click();
  await expect(page.getByRole('heading', { name: 'Quản lý link chia sẻ' })).toBeVisible();
  await page.getByRole('button', { name: 'Thu hồi' }).click();
  await expect(page.getByText('Chưa có link chia sẻ nào còn hiệu lực.')).toBeVisible();
  await expect(page.getByRole("button", { name: "Sổ Ghi Chú" })).toBeVisible();
});

test('creates a timed 2FA link and shows its live code to the recipient', async ({ page }) => {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const keyText = Buffer.from(rawKey).toString('base64url');
  const key = await importVaultKey(keyText);
  const id = '00000000-0000-4000-8000-000000000001';
  const item = {
    id, version: 1, pinned: false, createdAt: new Date().toISOString(),
    envelope: await encryptVaultValue({ title: 'GitHub', type: 'totp' }, key, `item:${id}:envelope`),
    content: await encryptVaultValue({ totp: { secret: 'JBSWY3DPEHPK3PXP', issuer: 'GitHub', account: 'alice@example.com', algorithm: 'SHA1', digits: 6, period: 30 } }, key, `item:${id}:content`),
  };
  await page.addInitScript(() => localStorage.setItem('vps_terminal_active_tab', 'authenticator'));
  await page.route('**/api/auth/verify', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, user: { id: 'root', username: 'root', role: 'root' } }) }));
  await page.route('**/api/vault/config', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, key: keyText }) }));
  await page.route('**/api/vault/items?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, items: [item] }) }));
  await page.route(`**/api/vault/items/${id}/shares`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().method() === 'POST' ? { success: true, share: { id: 'share-1', createdAt: Date.now(), expiresAt: Date.now() + 300_000 }, token: 'a'.repeat(43) } : { success: true, shares: [] }) }));
  await page.route(`**/api/vault/shared/${'a'.repeat(43)}`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, title: 'GitHub', account: 'alice@example.com', code: '123456', period: 30, expiresAt: Date.now() + 300_000, serverTime: Date.now() }) }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Chia sẻ' }).click();
  await expect(page.getByRole('dialog', { name: 'Chia sẻ mã GitHub' })).toBeVisible();
  await page.getByLabel('Thời gian chia sẻ').selectOption('5');
  await page.getByRole('button', { name: 'Tạo link chia sẻ' }).click();
  await expect(page.getByRole('dialog', { name: 'Xác nhận chia sẻ mã 2FA' })).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận chia sẻ' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã tạo link chia sẻ GitHub' })).toBeVisible();
  const link = await page.getByRole('textbox', { name: 'Link chia sẻ mới' }).inputValue();
  expect(link).toContain(`/vault-share#token=${'a'.repeat(43)}`);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Mã 2FA được chia sẻ' })).toBeVisible();
  await expect(page.getByText('123456')).toBeVisible();
});
