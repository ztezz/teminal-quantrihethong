import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import { decodeQrPixels } from "./client/qr-decoder";

test("reads an otpauth QR image locally", async () => {
  const payload = "otpauth://totp/GitHub:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";
  const qr = QRCode.create(payload);
  const scale = 5;
  const border = 4;
  const width = (qr.modules.size + border * 2) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const row = Math.floor(y / scale) - border;
      const col = Math.floor(x / scale) - border;
      const dark = row >= 0 && col >= 0 && row < qr.modules.size && col < qr.modules.size && qr.modules.get(row, col);
      const offset = (y * width + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = dark ? 0 : 255;
      pixels[offset + 3] = 255;
    }
  }
  assert.equal(await decodeQrPixels(pixels, width, width), payload);
});
