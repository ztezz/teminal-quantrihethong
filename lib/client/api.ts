import { publicApiUrl } from "@/lib/security-utils";

export type ApiErrorBody = {
  error?: string;
  code?: string;
  [key: string]: unknown;
};

export class ApiError<TBody = ApiErrorBody> extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: TBody | null,
    readonly response: Response,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiRequestOptions<TBody = unknown> = Omit<RequestInit, "body"> & {
  body?: TBody | BodyInit | null;
  query?: Record<string, string | number | boolean | null | undefined>;
};

export type ApiClientOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  defaultHeaders?: HeadersInit;
};

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = publicApiUrl(
    options.baseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "",
  );
  const fetcher = options.fetch ?? globalThis.fetch;

  async function request<TResponse, TBody = unknown>(
    path: string,
    requestOptions: ApiRequestOptions<TBody> = {},
  ): Promise<TResponse> {
    if (!path.startsWith("/")) throw new Error("API paths must start with /");

    const { body, query, headers: requestHeaders, ...init } = requestOptions;
    let url = `${baseUrl}${path}`;
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== null && value !== undefined) searchParams.set(key, String(value));
    }
    const queryString = searchParams.toString();
    if (queryString) url += `${url.includes("?") ? "&" : "?"}${queryString}`;

    const headers = new Headers(options.defaultHeaders);
    new Headers(requestHeaders).forEach((value, key) => headers.set(key, value));
    const isBodyInit =
      typeof body === "string" ||
      body instanceof Blob ||
      body instanceof FormData ||
      body instanceof URLSearchParams ||
      body instanceof ArrayBuffer ||
      ArrayBuffer.isView(body);
    const requestBody = body == null || isBodyInit ? (body as BodyInit | null | undefined) : JSON.stringify(body);
    if (body != null && !isBodyInit && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetcher(url, {
      ...init,
      body: requestBody,
      credentials: init.credentials ?? "include",
      headers,
    });
    if (response.status === 204) return undefined as TResponse;

    const contentType = response.headers.get("content-type") ?? "";
    const result = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const errorBody = typeof result === "object" && result !== null ? (result as ApiErrorBody) : null;
      throw new ApiError(
        errorBody?.error ?? response.statusText ?? "API request failed",
        response.status,
        errorBody,
        response,
      );
    }
    return result as TResponse;
  }

  return { baseUrl, request };
}

export const apiClient = createApiClient();
