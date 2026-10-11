export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export type TotpConfig = {
  secret: string;
  issuer: string;
  account: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
};

export function normalizeTotpSecret(value: string): string {
  const secret = value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]{8,}$/.test(secret)) throw new Error("Khóa bí mật phải là Base32 hợp lệ (ít nhất 8 ký tự).");
  return secret;
}

function decodeBase32(value: string): Uint8Array<ArrayBuffer> {
  const secret = normalizeTotpSecret(value);
  const bytes: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const character of secret) {
    buffer = (buffer << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
  }
  return Uint8Array.from(bytes);
}

export function parseTotpUri(value: string): TotpConfig {
  let uri: URL;
  try { uri = new URL(value.trim()); } catch { throw new Error("Liên kết otpauth không hợp lệ."); }
  if (uri.protocol !== "otpauth:" || uri.hostname.toLowerCase() !== "totp") throw new Error("Chỉ hỗ trợ liên kết otpauth://totp.");
  let label: string;
  try { label = decodeURIComponent(uri.pathname.slice(1)); } catch { throw new Error("Tên tài khoản trong liên kết không hợp lệ."); }
  const [labelIssuer, ...accountParts] = label.split(":");
  const account = (accountParts.length ? accountParts.join(":") : labelIssuer).trim();
  const issuer = (uri.searchParams.get("issuer") || (accountParts.length ? labelIssuer : "")).trim();
  if (!account) throw new Error("Liên kết thiếu tên tài khoản.");
  const algorithm = (uri.searchParams.get("algorithm") || "SHA1").toUpperCase();
  const digits = Number(uri.searchParams.get("digits") || 6);
  const period = Number(uri.searchParams.get("period") || 30);
  if (!(["SHA1", "SHA256", "SHA512"] as string[]).includes(algorithm) || ![6, 8].includes(digits) || !Number.isInteger(period) || period < 15 || period > 120) {
    throw new Error("Thuật toán, số chữ số hoặc chu kỳ TOTP không được hỗ trợ.");
  }
  return { secret: normalizeTotpSecret(uri.searchParams.get("secret") || ""), issuer, account, algorithm: algorithm as TotpAlgorithm, digits: digits as 6 | 8, period };
}

export async function generateTotp(config: TotpConfig, timestamp = Date.now()): Promise<string> {
  if (!Number.isFinite(timestamp) || !Number.isInteger(config.period) || config.period < 15 || config.period > 120 || ![6, 8].includes(config.digits)) throw new Error("Cấu hình TOTP không hợp lệ.");
  const hash = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" }[config.algorithm];
  if (!hash) throw new Error("Thuật toán TOTP không được hỗ trợ.");
  const counter = Math.floor(timestamp / 1000 / config.period);
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey("raw", decodeBase32(config.secret), { name: "HMAC", hash }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** config.digits).padStart(config.digits, "0");
}
