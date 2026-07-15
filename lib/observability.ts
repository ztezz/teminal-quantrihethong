export interface RequestMetricInput {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

export interface RequestMetricsSnapshot {
  startedAt: string;
  requests: number;
  inFlight: number;
  errors: number;
  errorRate: number;
  latencyMs: { average: number; p95: number; maximum: number };
  statusCodes: Record<string, number>;
  methods: Record<string, number>;
}

const round = (value: number) => Math.round(value * 100) / 100;

export class RequestMetricsCollector {
  private readonly startedAt: number;
  private requests = 0;
  private inFlight = 0;
  private errors = 0;
  private totalDurationMs = 0;
  private maximumDurationMs = 0;
  private readonly recentDurations: number[] = [];
  private readonly statusCodes: Record<string, number> = {};
  private readonly methods: Record<string, number> = {};

  constructor(private readonly latencySampleSize = 1_000, startedAt = Date.now()) {
    this.startedAt = startedAt;
  }

  start() {
    this.inFlight++;
    let completed = false;
    return (metric: RequestMetricInput) => {
      if (completed) return;
      completed = true;
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.record(metric);
    };
  }

  record(metric: RequestMetricInput) {
    const duration = Math.max(0, Number.isFinite(metric.durationMs) ? metric.durationMs : 0);
    const statusGroup = `${Math.floor(metric.statusCode / 100)}xx`;
    const method = metric.method.toUpperCase();
    this.requests++;
    if (metric.statusCode >= 400) this.errors++;
    this.totalDurationMs += duration;
    this.maximumDurationMs = Math.max(this.maximumDurationMs, duration);
    this.statusCodes[statusGroup] = (this.statusCodes[statusGroup] || 0) + 1;
    this.methods[method] = (this.methods[method] || 0) + 1;
    this.recentDurations.push(duration);
    if (this.recentDurations.length > this.latencySampleSize) this.recentDurations.shift();
  }

  snapshot(): RequestMetricsSnapshot {
    const sorted = [...this.recentDurations].sort((a, b) => a - b);
    const p95Index = sorted.length ? Math.ceil(sorted.length * 0.95) - 1 : 0;
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      requests: this.requests,
      inFlight: this.inFlight,
      errors: this.errors,
      errorRate: this.requests ? round(this.errors / this.requests * 100) : 0,
      latencyMs: {
        average: this.requests ? round(this.totalDurationMs / this.requests) : 0,
        p95: round(sorted[p95Index] || 0),
        maximum: round(this.maximumDurationMs),
      },
      statusCodes: { ...this.statusCodes },
      methods: { ...this.methods },
    };
  }
}
