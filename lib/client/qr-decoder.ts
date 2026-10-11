export async function decodeQrPixels(pixels: Uint8ClampedArray, width: number, height: number): Promise<string | null> {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4) throw new Error("Dữ liệu ảnh QR không hợp lệ.");
  const { default: jsQR } = await import("jsqr");
  return jsQR(pixels, width, height)?.data || null;
}

export async function decodeQrSource(source: CanvasImageSource, width: number, height: number, maxSize = 1600): Promise<string | null> {
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Trình duyệt không thể đọc ảnh QR.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return decodeQrPixels(pixels.data, pixels.width, pixels.height);
}

export async function decodeQrFile(file: File): Promise<string | null> {
  const supported = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if ((!supported.includes(file.type) && !isSvg) || file.size > 10 * 1024 * 1024) throw new Error("Chọn ảnh QR PNG, JPG, WebP hoặc SVG dưới 10 MB.");
  let imageBlob: Blob = file;
  if (isSvg) {
    const document = new DOMParser().parseFromString(await file.text(), "image/svg+xml");
    if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") throw new Error("Ảnh SVG không hợp lệ.");
    const allowed = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "clipPath", "use", "title", "desc"]);
    for (const element of [document.documentElement, ...Array.from(document.querySelectorAll("*"))]) {
      if (!allowed.has(element.localName)) { element.remove(); continue; }
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.localName.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith("on") || /url\s*\(|@import/i.test(value) || (name === "href" && !value.startsWith("#"))) element.removeAttributeNode(attribute);
      }
    }
    imageBlob = new Blob([new XMLSerializer().serializeToString(document.documentElement)], { type: "image/svg+xml" });
  }
  const url = URL.createObjectURL(imageBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () => reject(new Error("Không thể mở ảnh QR."));
      value.src = url;
    });
    return decodeQrSource(image, image.naturalWidth, image.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}
