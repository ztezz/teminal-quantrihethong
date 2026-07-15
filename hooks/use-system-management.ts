import { useCallback, useRef, useState } from "react";
import { apiClient, ApiError } from "@/lib/client/api";
import type { SystemProcess, SystemService, UserRole } from "@/app/components/control-center/types";

type StepUp = () => Promise<boolean>;
type SystemView = "services" | "processes";
interface ServicesResponse { success: true; services: SystemService[] }
interface ProcessesResponse { success: true; processes: SystemProcess[] }
interface LogsResponse { success: true; logs: string }

export function useSystemManagement(enabled: boolean, role: UserRole | undefined, requestStepUp: StepUp) {
  const [view, setView] = useState<SystemView>("services");
  const [services, setServices] = useState<SystemService[]>([]);
  const [processes, setProcesses] = useState<SystemProcess[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceLogs, setServiceLogs] = useState<{ unit: string; logs: string } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (target: SystemView = view) => {
    if (!enabled || !role || !["admin", "root"].includes(role)) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      if (target === "services") {
        const response = await apiClient.request<ServicesResponse>("/api/system/services", { signal: controller.signal });
        setServices(response.services || []);
      } else {
        const response = await apiClient.request<ProcessesResponse>("/api/system/processes", { signal: controller.signal });
        setProcesses(response.processes || []);
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Không thể tải dữ liệu hệ thống");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [enabled, role, view]);

  const requestWithStepUp = async <T, B>(path: string, body: B) => {
    try {
      return await apiClient.request<T, B>(path, { method: "POST", body });
    } catch (caught) {
      if (!(caught instanceof ApiError) || caught.status !== 428 || !(await requestStepUp())) throw caught;
      return apiClient.request<T, B>(path, { method: "POST", body });
    }
  };
  const serviceAction = async (unit: string, action: string) => {
    await requestWithStepUp<{ success: true }, { action: string }>(`/api/system/services/${encodeURIComponent(unit)}/action`, { action });
    await load("services");
  };
  const signalProcess = async (pid: number, signal: "SIGTERM" | "SIGKILL") => {
    await requestWithStepUp<{ success: true }, { signal: string }>(`/api/system/processes/${pid}/signal`, { signal });
    await load("processes");
  };
  const openServiceLogs = async (unit: string) => {
    try {
      const response = await apiClient.request<LogsResponse>(`/api/system/services/${encodeURIComponent(unit)}/logs`, { query: { lines: 200 } });
      setServiceLogs({ unit, logs: response.logs });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tải nhật ký service");
    }
  };

  return { view, setView, services, processes, query, setQuery, loading, error, setError, serviceLogs, setServiceLogs, load, serviceAction, signalProcess, openServiceLogs };
}
