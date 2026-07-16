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
