import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "./client/api";

test("api client supports same-origin relative URLs", async () => {
  let requestedUrl = "";
  const client = createApiClient({
    baseUrl: "",
    fetch: async (input) => {
      requestedUrl = String(input);
      return Response.json({ success: true });
    },
  });

  const result = await client.request<{ success: boolean }>("/api/settings", {
    query: { page: 2, search: "hello world" },
  });

  assert.deepEqual(result, { success: true });
  assert.equal(requestedUrl, "/api/settings?page=2&search=hello+world");
});

test("api client prefixes configured backend URLs", async () => {
  let requestedUrl = "";
  const client = createApiClient({
    baseUrl: "https://api.example.com/",
    fetch: async (input) => {
      requestedUrl = String(input);
      return Response.json({ success: true });
    },
  });

  await client.request("/api/health");
  assert.equal(requestedUrl, "https://api.example.com/api/health");
});

test("bearer credentials are scoped to the configured API origin and preserve caller headers", async () => {
  const store = new Map<string, string>();
  Object.assign(globalThis, { window: { location: { href: "https://app.example/", origin: "https://app.example" } }, sessionStorage: { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => store.delete(k) } });
  try {
    const { setSessionToken, setStepUpToken, authHeaders } = await import("./client/auth");
    setSessionToken("session-secret");
    setStepUpToken("grant-secret");
    const headers = authHeaders("https://api.example/api/files", { "X-Test": "ok" }, "https://api.example");
    assert.equal(headers.get("authorization"), "Bearer session-secret");
    assert.equal(headers.get("x-step-up-token"), "grant-secret");
    assert.equal(headers.get("x-test"), "ok");
    assert.equal(authHeaders("https://evil.example/path", undefined, "https://api.example").get("authorization"), null);
    assert.equal(authHeaders("https://evil.example/path", undefined, "https://api.example").get("x-step-up-token"), null);
    setSessionToken(null);
    assert.equal(authHeaders("https://api.example/api", undefined, "https://api.example").get("authorization"), null);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
