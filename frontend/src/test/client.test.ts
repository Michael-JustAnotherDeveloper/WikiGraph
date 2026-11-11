import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { API_BASE, ApiError, apiGet, bareGet } from '../api/client';

const schema = z.object({ a: z.number() });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefixes paths with VITE_API_BASE (fallback /api)', async () => {
    expect(API_BASE).toBe('/api');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { a: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiGet('/stats', schema);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stats',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('parses a successful JSON body with the zod schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { a: 42 })));
    await expect(apiGet('/x', schema)).resolves.toEqual({ a: 42 });
  });

  it('throws invalid_response ApiError when the body does not match the schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { b: 'oops' })));

    const err = await apiGet('/x', schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('invalid_response');
    expect((err as ApiError).status).toBe(200);
  });

  it('parses the frozen error body { code, message }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { code: 'not_found', message: 'Nope' })),
    );

    const err = await apiGet('/x', schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err as ApiError).toMatchObject({ code: 'not_found', status: 404, message: 'Nope' });
  });

  it('falls back to the backend { error } body with a generic code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' })));

    const err = await apiGet('/x', schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err as ApiError).toMatchObject({ code: 'error', status: 500, message: 'boom' });
  });

  it('produces a generic message for non-JSON error bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    const err = await apiGet('/x', schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err as ApiError).toMatchObject({ code: 'unknown', status: 502 });
    expect((err as ApiError).message).toContain('502');
  });

  it('bareGet does not add the /api prefix (for /health and /stats)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { a: 7 }));
    vi.stubGlobal('fetch', fetchMock);

    await bareGet('/health', schema);
    expect(fetchMock).toHaveBeenCalledWith('/health', expect.anything());
  });

  it('passes the AbortSignal through to fetch and rethrows aborts as-is', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        queueMicrotask(() => {
          /* emulate fetch rejection on abort */
        });
      });
      return Promise.reject(abortError);
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    await expect(apiGet('/x', schema, controller.signal)).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
