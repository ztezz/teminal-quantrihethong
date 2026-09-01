const encoder = new TextEncoder();
const decoder = new TextDecoder();

const encode = (value: ArrayBuffer | Uint8Array) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const decode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), character => character.charCodeAt(0));
};

export const randomSalt = () => encode(crypto.getRandomValues(new Uint8Array(16)));

export async function importVaultKey(value: string) {
  return crypto.subtle.importKey("raw", decode(value), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function deriveVaultKey(password: string, salt: string, iterations: number) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: decode(salt), iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptVaultValue(value: unknown, key: CryptoKey, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(context) }, key, encoder.encode(JSON.stringify(value)));
  return `${encode(iv)}.${encode(encrypted)}`;
}

export async function decryptVaultValue<T>(payload: string, key: CryptoKey, context: string): Promise<T> {
  const [iv, encrypted] = payload.split(".");
  if (!iv || !encrypted) throw new Error("Dữ liệu két không hợp lệ");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(iv), additionalData: encoder.encode(context) }, key, decode(encrypted));
  return JSON.parse(decoder.decode(plain)) as T;
}

export async function encryptBackup(value: unknown, password: string) {
  const salt = randomSalt(); const iterations = 600_000; const key = await deriveVaultKey(password, salt, iterations);
  return { format: "nodeshell-vault-backup-v1", salt, iterations, payload: await encryptVaultValue(value, key, "nodeshell-vault-backup-v1") };
}

export async function decryptBackup(value: unknown, password: string) {
  const backup = value as { format?: string; salt?: string; iterations?: number; payload?: string };
  if (backup.format !== "nodeshell-vault-backup-v1" || !backup.salt || !backup.iterations || !backup.payload) throw new Error("File backup không hợp lệ");
  return decryptVaultValue<Record<string, unknown>>(backup.payload, await deriveVaultKey(password, backup.salt, backup.iterations), backup.format);
}

export function generatePassword(length = 24, symbols = true) {
  const alphabet = `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789${symbols ? "!@#$%^&*()-_=+" : ""}`;
  const limit = 256 - 256 % alphabet.length; let password = "";
  while (password.length < length) { const values = crypto.getRandomValues(new Uint8Array(length)); for (const value of values) if (value < limit && password.length < length) password += alphabet[value % alphabet.length]; }
  return password;
}
