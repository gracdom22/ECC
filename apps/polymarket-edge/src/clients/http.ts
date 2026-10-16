import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Strips credentials from URLs before they reach logs or error messages. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:apiKey|api_key|key|token)=)[^&]*/gi, '$1[REDACTED]');
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export interface JsonResponse<T> {
  data: T;
  headers: Headers;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<S extends z.ZodTypeAny>(
  url: string,
  schema: S,
  opts: FetchJsonOptions = {},
): Promise<JsonResponse<z.infer<S>>> {
  const { timeoutMs = 15000, retries = 2, headers = {} } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'polymarket-edge-paper/0.1', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const err = new HttpError(`HTTP ${res.status} for ${redactUrl(url)}`, res.status);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err;
        lastError = err;
      } else {
        const body: unknown = await res.json();
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          throw new Error(`Unexpected response shape from ${redactUrl(url)}: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        }
        return { data: parsed.data, headers: res.headers };
      }
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      lastError = err instanceof Error ? new Error(redactUrl(err.message)) : err;
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${redactUrl(url)}`);
}
