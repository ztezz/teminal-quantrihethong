import { useCallback, useState } from "react";
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

  const filters = () => ({
    q: query.trim() || undefined,
    category: category || undefined,
    level: level || undefined,
    result: result || undefined,
  });
  const load = useCallback(async (nextOffset = offset) => {
    if (!enabled) return;
    try {
      const response = await apiClient.request<AuditResponse>("/api/logs", {
        query: { offset: nextOffset, limit: 50, ...filters() },
      });
      setLogs(response.logs);
      setTotal(response.total || 0);
      setOffset(nextOffset);
    } catch (error) {
      console.error("Failed to load logs:", error);
    }
  // Filter state intentionally defines the current request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, offset, query, category, level, result]);

  const checkIntegrity = async () => {
    const response = await apiClient.request<IntegrityResponse>("/api/logs/integrity");
    setIntegrity(response);
  };
  const exportLogs = async (format: "json" | "csv") => {
    const url = new URL(`${apiClient.baseUrl}/api/logs/export`);
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

  return { logs, total, offset, query, setQuery, category, setCategory, level, setLevel, result, setResult, integrity, load, checkIntegrity, exportLogs };
}
