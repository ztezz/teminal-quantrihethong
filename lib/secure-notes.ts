import crypto from 'node:crypto';

export function noteEncryptionKey(secret: string | undefined): Buffer {
  if (!secret || secret.length < 32) throw Object.assign(new Error('AUTH_ENCRYPTION_KEY must contain at least 32 characters'), { status: 503 });
  return crypto.createHash('sha256').update(`notes:${secret}`).digest();
}

export function encryptNoteText(value: string, key: Buffer, aad: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

export function decryptNoteText(payload: string, key: Buffer, aad: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Encrypted note payload is invalid');
  const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
