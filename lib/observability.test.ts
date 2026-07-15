import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestMetricsCollector } from './observability';

test('RequestMetricsCollector aggregates latency, errors, methods, and status groups', () => {
  const collector = new RequestMetricsCollector(10, 0);
  collector.record({ method: 'get', path: '/api/a', statusCode: 200, durationMs: 10 });
  collector.record({ method: 'POST', path: '/api/b', statusCode: 404, durationMs: 20 });
  collector.record({ method: 'GET', path: '/api/c', statusCode: 503, durationMs: 70 });

  assert.deepEqual(collector.snapshot(), {
    startedAt: '1970-01-01T00:00:00.000Z',
    requests: 3,
    inFlight: 0,
    errors: 2,
    errorRate: 66.67,
    latencyMs: { average: 33.33, p95: 70, maximum: 70 },
    statusCodes: { '2xx': 1, '4xx': 1, '5xx': 1 },
    methods: { GET: 2, POST: 1 },
  });
});

test('RequestMetricsCollector completion callback is idempotent', () => {
  const collector = new RequestMetricsCollector();
  const complete = collector.start();
  assert.equal(collector.snapshot().inFlight, 1);
  complete({ method: 'GET', path: '/api/a', statusCode: 204, durationMs: 2 });
  complete({ method: 'GET', path: '/api/a', statusCode: 500, durationMs: 3 });
  assert.equal(collector.snapshot().inFlight, 0);
  assert.equal(collector.snapshot().requests, 1);
  assert.equal(collector.snapshot().errors, 0);
});
