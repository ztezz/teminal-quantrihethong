import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/client/api";
import type { LogEntry } from "@/app/components/control-center/types";

interface AuditResponse {
  success: true;
  logs: LogEntry[];
  total: number;
}

interface IntegrityResponse {
  success: true;
  valid: boolean;
  checked: number;
  brokenAt?: number;
}

export function useAuditLog(enabled: boolean) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");
  const [result, setResult] = useState("");
  const [integrity, setIntegrity] = useState<Omit<IntegrityResponse, "success"> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);

  const filters = () => ({
    q: query.trim() || undefined,
    category: category || undefined,
    level: level || undefined,
    result: result || undefined,
  });
  const load = useCallback(async (nextOffset = offset) => {
    if (!enabled) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    const sequence = ++sequenceRef.current;
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.request<AuditResponse>("/api/logs", {
        query: { offset: nextOffset, limit: 50, ...filters() },
        signal: controller.signal,
      });
      if (controller.signal.aborted || sequence !== sequenceRef.current) return;
      setLogs(response.logs);
      setTotal(response.total || 0);
      setOffset(nextOffset);
    } catch (error) {
      if (!controller.signal.aborted && sequence === sequenceRef.current)
        setError(error instanceof Error ? error.message : "Không thể tải nhật ký");
    } finally {
      if (!controller.signal.aborted && sequence === sequenceRef.current) setLoading(false);
    }
  // Filter state intentionally defines the current request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, offset, query, category, level, result]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    sequenceRef.current += 1;
  }, []);

  const checkIntegrity = async () => {
    const response = await apiClient.request<IntegrityResponse>("/api/logs/integrity");
    setIntegrity(response);
  };
  const exportLogs = async (format: "json" | "csv") => {
    const url = new URL(`${apiClient.baseUrl}/api/logs/export`, window.location.origin);
    Object.entries({ format, ...filters() }).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return;
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `audit-log.${format}`;
    link.click();
    URL.revokeObjectURL(objectUrl);
  };

  return { logs, total, offset, query, setQuery, category, setCategory, level, setLevel, result, setResult, integrity, loading, error, load, checkIntegrity, exportLogs };
}
