import type { RequestHandler } from 'express';

export const CORS_ALLOWED_HEADERS = ['Content-Type', 'Idempotency-Key', 'X-File-Name', 'X-Directory', 'X-Policy-Token', 'X-Upload-Offset', 'X-Quick-Share-Token'] as const;

export function createCorsMiddleware(allowedOrigin: string): RequestHandler {
  return (req, res, next) => {
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS.join(', '));
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    const isOnlyOfficeCallback = req.path.startsWith('/api/files/onlyoffice/callback/');
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== allowedOrigin && !isOnlyOfficeCallback) return res.status(403).json({ success: false, error: 'Invalid request origin' });
    next();
  };
}
