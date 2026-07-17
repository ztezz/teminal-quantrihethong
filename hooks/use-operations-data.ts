import { useState } from "react";
import { apiClient } from "@/lib/client/api";
import type { OverviewData } from "@/app/components/control-center/types";
import { useVisibilityPolling } from "./use-visibility-polling";

export interface MetricsData {
  cpu: number;
  memUsedMB: number;
  memTotalMB: number;
  memPercent: number;
  diskUsedGB: number;
  diskTotalGB: number;
  diskPercent: number;
}

interface MetricsResponse extends MetricsData {
  success: true;
}

export function useMetricsPolling(enabled: boolean) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useVisibilityPolling({
    enabled,
    interval: 5_000,
    request: (signal) => apiClient.request<MetricsResponse>("/api/metrics", { signal }),
    onData: (payload) => {
      setMetrics(payload);
      setError(null);
      setUpdatedAt(Date.now());
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Không thể tải tài nguyên"),
  });
  return { metrics, error, updatedAt };
}

export function useOverviewPolling(enabled: boolean) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [history, setHistory] = useState<Array<{ timestamp: string; cpu: number; memory: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useVisibilityPolling({
    enabled,
    interval: 15_000,
    request: (signal) => apiClient.request<OverviewData>("/api/overview", { signal }),
    onData: (payload) => {
      setData(payload);
      setHistory((current) => {
        if (current.at(-1)?.timestamp === payload.generatedAt) return current;
        return [...current, { timestamp: payload.generatedAt, cpu: payload.host.cpu, memory: payload.host.memory.percent }].slice(-24);
      });
      setError(null);
      setLoading(false);
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Không thể tải tổng quan");
      setLoading(false);
    },
  });
  return { data, history, loading, error, refresh };
}
