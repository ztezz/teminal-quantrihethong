import type { RequestHandler } from 'express';

export const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Step-Up-Token', 'Idempotency-Key', 'X-File-Name', 'X-Directory', 'X-Policy-Token', 'X-Upload-Offset', 'X-Quick-Share-Token'] as const;

export function createCorsMiddleware(allowedOriginsInput: string | string[]): RequestHandler {
  const allowedOrigins = Array.isArray(allowedOriginsInput)
    ? allowedOriginsInput
    : allowedOriginsInput.split(',').map(s => s.trim()).filter(Boolean);

  return (req, res, next) => {
    const origin = req.headers.origin;
    const isAllowed = origin && (allowedOrigins.includes(origin) || allowedOrigins.includes('*'));

    res.setHeader('Vary', 'Origin');
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (allowedOrigins.length === 1 && !allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
    }

    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS.join(', '));
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID');

    if (req.method === 'OPTIONS') return res.sendStatus(204);

    const isOnlyOfficeCallback = req.path.startsWith('/api/files/onlyoffice/callback/');
    if (!['GET', 'HEAD'].includes(req.method) && !isAllowed && !isOnlyOfficeCallback) {
      return res.status(403).json({ success: false, error: 'Invalid request origin' });
    }

    next();
  };
}
