import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { CORS_ALLOWED_HEADERS, createCorsMiddleware } from './cors-config';

test('CORS allows deletion safety headers', () => {
  const headers = new Set(CORS_ALLOWED_HEADERS.map(header => header.toLowerCase()));
  assert.equal(headers.has('idempotency-key'), true);
  assert.equal(headers.has('x-policy-token'), true);
});

test('CORS preflight exposes deletion safety headers', async () => {
  const app = express();
  app.use(createCorsMiddleware('https://ssh.luugame.fun'));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/files/trash`, { method: 'OPTIONS', headers: { origin: 'https://ssh.luugame.fun', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,idempotency-key,x-policy-token' } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://ssh.luugame.fun');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    const allowed = response.headers.get('access-control-allow-headers')?.toLowerCase() || '';
    assert.match(allowed, /idempotency-key/);
    assert.match(allowed, /x-policy-token/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
