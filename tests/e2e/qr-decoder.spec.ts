import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import QRCode from "qrcode";

test("imports a TOTP account from an SVG QR image", async ({ page }) => {
  const payload = "otpauth://totp/GitHub:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";
  const svg = await QRCode.toString(payload, { type: "svg" });
  const bundle = await build({ entryPoints: ["lib/client/qr-decoder.ts"], bundle: true, write: false, format: "iife", globalName: "QrDecoder", platform: "browser" });
  await page.goto("/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async source => {
    const decoder = (window as unknown as { QrDecoder: { decodeQrFile: (file: File) => Promise<string | null> } }).QrDecoder;
    return decoder.decodeQrFile(new File([source], "setup.svg", { type: "image/svg+xml" }));
  }, svg);
  expect(result).toBe(payload);
});
