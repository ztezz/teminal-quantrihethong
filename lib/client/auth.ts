import { publicApiUrl } from "@/lib/security-utils";

// sessionStorage survives reloads in this tab but is cleared when the tab closes.
const TOKEN_KEY = "vps_terminal_bearer_token";
let stepUpToken: string | null = null;
const apiBase = publicApiUrl(process.env.NEXT_PUBLIC_API_URL || "");

export function setSessionToken(token: unknown) {
  if (typeof window === "undefined") return;
  if (typeof token === "string" && token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
  stepUpToken = null;
}
export function clearSessionTokens() { setSessionToken(null); stepUpToken = null; }
export function setStepUpToken(token: unknown) {
  stepUpToken = typeof token === "string" && token ? token : null;
}
export function authHeaders(url: string | URL, initial?: HeadersInit, base = apiBase): Headers {
  const headers = new Headers(initial);
  if (typeof window === "undefined") return headers;
  try {
    const target = new URL(String(url), window.location.href);
    const trusted = new URL(base || window.location.origin, window.location.href);
    if (!/^https?:$/.test(target.protocol) || target.origin !== trusted.origin) return headers;
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    if (stepUpToken && !headers.has("X-Step-Up-Token")) headers.set("X-Step-Up-Token", stepUpToken);
  } catch { /* Never attach credentials to malformed URLs. */ }
  return headers;
}
export function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const headers = authHeaders(url, init.headers ?? (input instanceof Request ? input.headers : undefined));
  const authenticated = headers.has("Authorization") || headers.has("X-Step-Up-Token");
  return globalThis.fetch(input, { ...init, headers, ...(authenticated ? { redirect: "error" as const } : {}) });
}

export async function downloadAuthenticated(url: string, fallbackName: string) {
  const response = await authenticatedFetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fallbackName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
