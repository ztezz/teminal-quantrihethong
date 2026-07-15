import { useCallback, useEffect, useRef } from "react";

interface VisibilityPollingOptions<T> {
  enabled: boolean;
  interval: number;
  request: (signal: AbortSignal) => Promise<T>;
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
}

export function useVisibilityPolling<T>({
  enabled,
  interval,
  request,
  onData,
  onError,
}: VisibilityPollingOptions<T>) {
  const requestRef = useRef(request);
  const onDataRef = useRef(onData);
  const onErrorRef = useRef(onError);
  const controllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);

  useEffect(() => {
    requestRef.current = request;
    onDataRef.current = onData;
    onErrorRef.current = onError;
  }, [request, onData, onError]);

  const refresh = useCallback(async () => {
    if (!enabled || document.visibilityState !== "visible") return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    const sequence = ++sequenceRef.current;
    controllerRef.current = controller;
    try {
      const data = await requestRef.current(controller.signal);
      if (!controller.signal.aborted && sequence === sequenceRef.current) {
        onDataRef.current(data);
      }
    } catch (error) {
      if (!controller.signal.aborted && sequence === sequenceRef.current) {
        onErrorRef.current?.(error);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => void refresh(), interval);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
      else controllerRef.current?.abort();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
      controllerRef.current?.abort();
      sequenceRef.current += 1;
    };
  }, [enabled, interval, refresh]);

  return refresh;
}
