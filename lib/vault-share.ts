import crypto from 'node:crypto';

export type SharedTotp = { title: string; account: string; secret: string; algorithm: 'SHA1' | 'SHA256' | 'SHA512'; digits: 6 | 8; period: number };

function decryptValue(payload: string, key: Buffer, context: string): unknown {
  const [ivText, cipherText] = payload.split('.');
  if (!ivText || !cipherText) throw new Error('Invalid vault data');
  const encrypted = Buffer.from(cipherText, 'base64url');
  if (encrypted.length < 17) throw new Error('Invalid vault data');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(encrypted.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'));
}

export function readSharedTotp(item: { id: string; envelope: string; content: string }, rawKey: string): SharedTotp {
  const key = Buffer.from(rawKey, 'base64url');
  if (key.length !== 32) throw new Error('Invalid vault key');
  const meta = decryptValue(item.envelope, key, `item:${item.id}:envelope`) as { title?: unknown; type?: unknown };
  const content = decryptValue(item.content, key, `item:${item.id}:content`) as { totp?: Record<string, unknown> };
  const config = content?.totp;
  if (meta?.type !== 'totp' || typeof meta.title !== 'string' || !config || typeof config.account !== 'string' ||
      typeof config.secret !== 'string' || !/^[A-Z2-7]{8,}$/i.test(config.secret) ||
      !['SHA1', 'SHA256', 'SHA512'].includes(String(config.algorithm)) || ![6, 8].includes(Number(config.digits)) ||
      !Number.isInteger(config.period) || Number(config.period) < 15 || Number(config.period) > 120) throw new Error('Invalid TOTP item');
  return { title: meta.title, account: config.account, secret: config.secret.toUpperCase(), algorithm: config.algorithm as SharedTotp['algorithm'], digits: config.digits as 6 | 8, period: config.period as number };
}

export function generateSharedTotp(config: SharedTotp, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, buffer = 0;
  const bytes: number[] = [];
  for (const char of config.secret) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / config.period)));
  const digest = crypto.createHmac(config.algorithm.toLowerCase(), Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** config.digits).padStart(config.digits, '0');
}
