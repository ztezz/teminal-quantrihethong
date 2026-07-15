import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminalSessionRegistry } from './terminal-session-registry';

type Timer = NodeJS.Timeout & { callback: () => void; cleared: boolean; delay: number };

function fixture(options: { max?: number; idle?: number; lifetime?: number } = {}) {
  let now = 1000;
  const timers: Timer[] = [];
  const registry = new TerminalSessionRegistry({
    maxSessionsPerUser: options.max ?? 2,
    idleTimeoutMs: options.idle ?? 100,
    maxLifetimeMs: options.lifetime ?? 1000,
    now: () => now,
    setTimer: (callback, delay) => {
      const timer = { callback, cleared: false, delay, unref() { return this; } } as unknown as Timer;
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => { (timer as Timer).cleared = true; }
  });
  return { registry, timers, advance: (ms: number) => { now += ms; } };
}

test('enforces the per-user quota without affecting other users', () => {
  const { registry } = fixture();
  const disconnect = () => undefined;
  assert.equal(registry.register({ id: 'a', userId: 'u1', sessionHash: 's1', disconnect }), true);
  assert.equal(registry.register({ id: 'b', userId: 'u1', sessionHash: 's1', disconnect }), true);
  assert.equal(registry.register({ id: 'c', userId: 'u1', sessionHash: 's2', disconnect }), false);
  assert.equal(registry.register({ id: 'd', userId: 'u2', sessionHash: 's3', disconnect }), true);
  assert.equal(registry.countForUser('u1'), 2);
});

test('input activity replaces the idle timer and only the current timer disconnects', () => {
  const { registry, timers, advance } = fixture();
  const reasons: string[] = [];
  registry.register({ id: 'a', userId: 'u1', sessionHash: 's1', disconnect: reason => reasons.push(reason) });
  const firstIdle = timers[0];
  advance(50);
  assert.equal(registry.touch('a'), true);
  assert.equal(firstIdle.cleared, true);
  firstIdle.callback();
  assert.equal(registry.size, 1);
  timers[2].callback();
  assert.deepEqual(reasons, ['idle timeout exceeded']);
  assert.equal(registry.size, 0);
});

test('session and user revocation invoke each callback exactly once', () => {
  const { registry } = fixture({ max: 3, idle: 0 });
  const closed: string[] = [];
  for (const [id, userId, sessionHash] of [['a', 'u1', 's1'], ['b', 'u1', 's2'], ['c', 'u2', 's3']]) {
    registry.register({ id, userId, sessionHash, disconnect: reason => closed.push(`${id}:${reason}`) });
  }
  assert.equal(registry.disconnectSession('s1'), 1);
  assert.equal(registry.disconnectUser('u1'), 1);
  assert.equal(registry.disconnectAll(), 1);
  assert.equal(registry.disconnectAll(), 0);
  assert.deepEqual(closed, ['a:session revoked', 'b:user access revoked', 'c:server shutdown']);
});

test('maximum lifetime remains fixed when activity is updated', () => {
  const { registry, timers } = fixture({ idle: 100 });
  const reasons: string[] = [];
  registry.register({ id: 'a', userId: 'u1', sessionHash: 's1', disconnect: reason => reasons.push(reason) });
  const lifetime = timers[1];
  registry.touch('a');
  lifetime.callback();
  assert.deepEqual(reasons, ['maximum lifetime exceeded']);
});
