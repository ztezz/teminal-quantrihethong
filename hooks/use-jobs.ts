import { useEffect, useState } from "react";
import { apiClient } from "@/lib/client/api";
import type { Job, JobResponse, JobsResponse, JobState, JobType } from "@/app/components/control-center/types";
import { useVisibilityPolling } from "./use-visibility-polling";

export function useJobs(active: boolean) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [stateFilter, setStateFilter] = useState<JobState | "">("");
  const [typeFilter, setTypeFilter] = useState<JobType | "">("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useVisibilityPolling({
    enabled: active,
    interval: 3_000,
    request: (signal) => {
      setRefreshing(true);
      return apiClient.request<JobsResponse>("/api/jobs", {
        signal,
        query: { state: stateFilter || undefined, type: typeFilter || undefined, limit: 200 },
      });
    },
    onData: (response) => {
      setJobs(response.jobs);
      setTotal(response.total);
      setSelectedId((current) => response.jobs.some((job) => job.id === current) ? current : response.jobs[0]?.id ?? "");
      setError(null);
      setLoading(false);
      setRefreshing(false);
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Không thể tải danh sách tác vụ");
      setLoading(false);
      setRefreshing(false);
    },
  });

  useEffect(() => {
    const onRefresh = () => void refresh();
    window.addEventListener("jobs:refresh", onRefresh);
    return () => window.removeEventListener("jobs:refresh", onRefresh);
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [active, stateFilter, typeFilter, refresh]);

  const create = async (type: JobType, path: string) => {
    const response = await apiClient.request<JobResponse, { type: JobType; path: string }>("/api/jobs", {
      method: "POST",
      body: { type, path },
    });
    setStateFilter("");
    setTypeFilter("");
    setJobs((current) => [response.job, ...current.filter((job) => job.id !== response.job.id)]);
    setSelectedId(response.job.id);
    setTotal((value) => value + 1);
    return response.job;
  };

  const cancel = async (job: Job) => {
    const response = await apiClient.request<JobResponse>(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
    setJobs((current) => current.map((item) => item.id === job.id ? response.job : item));
    return response.job;
  };

  return { jobs, total, stateFilter, setStateFilter, typeFilter, setTypeFilter, selectedId, setSelectedId, loading, refreshing, error, refresh, create, cancel };
}
