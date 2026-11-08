import assert from 'node:assert/strict';
import test from 'node:test';
import { cookieValue, sessionCredential, StepUpGrants } from './auth-credentials';

test('bearer credentials take precedence; malformed authorization never falls back', () => {
  const cookie = 'other=x; terminal_session=cookie-token';
  assert.equal(sessionCredential(undefined, cookie), 'cookie-token');
  assert.equal(sessionCredential('Bearer bearer-token', cookie), 'bearer-token');
  assert.equal(sessionCredential('bearer abc', cookie), 'abc');
  for (const header of ['', 'Basic abc', 'Bearer ', 'Bearer a b']) assert.equal(sessionCredential(header, cookie), '');
  assert.equal(cookieValue('terminal_session=%zz', 'terminal_session'), '');
});

test('step-up grants are random, session-bound and expire', async () => {
  const grants = new StepUpGrants(25);
  const grant = grants.issue('session-a');
  assert.notEqual(grant, grants.issue('session-a'));
  assert.equal(grants.valid(grant, 'session-a'), true);
  assert.equal(grants.valid(grant, 'session-b'), false);
  assert.equal(grants.valid(grant, ''), false);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(grants.valid(grant, 'session-a'), false);
});
