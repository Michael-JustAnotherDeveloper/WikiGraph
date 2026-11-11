import { z } from 'zod';

/*
 * Single entry point for all network calls (Agents.md §9).
 *
 * - `apiGet` talks to the frozen /api prefix (VITE_API_BASE, fallback /api).
 * - `bareGet` is for the root-level endpoints /health and /stats, which live
 *   outside the /api prefix both in the spec (§7.6, §7.7) and in the dev
 *   server proxy config (§13).
 */

const envBase: unknown = import.meta.env.VITE_API_BASE;

export const API_BASE: string =
  typeof envBase === 'string' && envBase.trim() !== '' ? envBase : '/api';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// Frozen error body is { code, message } (Agents.md §7.8). The current backend
// sends { error: string } instead (TODO.md, @backend) — accepted as fallback.
type ErrorBody = {
  code?: unknown;
  message?: unknown;
  error?: unknown;
};

async function parseErrorBody(res: Response): Promise<ApiError> {
  let body: ErrorBody | null = null;
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    body = null;
  }

  const code =
    typeof body?.code === 'string' && body.code !== ''
      ? body.code
      : typeof body?.error === 'string'
        ? 'error'
        : 'unknown';

  const message =
    typeof body?.message === 'string' && body.message !== ''
      ? body.message
      : typeof body?.error === 'string' && body.error !== ''
        ? body.error
        : `Request failed with status ${res.status}`;

  return new ApiError(code, res.status, message);
}

async function request<S extends z.ZodTypeAny>(
  url: string,
  schema: S,
  signal?: AbortSignal,
): Promise<z.output<S>> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw await parseErrorBody(res);
  }

  const json: unknown = await res.json();
  try {
    return schema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiError('invalid_response', res.status, 'Unexpected response from server');
    }
    throw err;
  }
}

export function apiGet<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  signal?: AbortSignal,
): Promise<z.output<S>> {
  return request(`${API_BASE}${path}`, schema, signal);
}

export function bareGet<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  signal?: AbortSignal,
): Promise<z.output<S>> {
  return request(path, schema, signal);
}
