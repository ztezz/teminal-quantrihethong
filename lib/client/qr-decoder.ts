export async function decodeQrPixels(pixels: Uint8ClampedArray, width: number, height: number): Promise<string | null> {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4) throw new Error("Dữ liệu ảnh QR không hợp lệ.");
  const { default: jsQR } = await import("jsqr");
  return jsQR(pixels, width, height)?.data || null;
}
