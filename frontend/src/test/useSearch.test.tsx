import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet } from '../api/client';
import { useSearch } from '../api/hooks';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, apiGet: vi.fn(), bareGet: vi.fn() };
});

const apiGetMock = vi.mocked(apiGet);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiGetMock.mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not send the request while q is empty', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useSearch('', 'en', 20), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(apiGetMock).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('searches immediately on mount and debounces subsequent q changes by 300 ms', async () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(({ q }) => useSearch(q, 'en', 20), {
      wrapper,
      initialProps: { q: 'wi' },
    });

    // First value fires right away (URL updates are already debounced in SearchBar).
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiGetMock).toHaveBeenLastCalledWith(
      '/search?q=wi&lang=en&size=20',
      expect.anything(),
      expect.anything(),
    );

    rerender({ q: 'wik' });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(apiGetMock).toHaveBeenLastCalledWith(
      '/search?q=wik&lang=en&size=20',
      expect.anything(),
      expect.anything(),
    );

    await act(async () => {});
    expect(result.current.data).toEqual({ items: [], total: 0 });
  });

  it('aborts the previous in-flight request when the query changes', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    apiGetMock.mockImplementation(
      (_path: string, _schema: unknown, signal?: AbortSignal) =>
        new Promise(() => {
          signals.push(signal);
        }),
    );

    const wrapper = makeWrapper();
    const { rerender } = renderHook(({ q }) => useSearch(q, 'en', 20), {
      wrapper,
      initialProps: { q: 'first' },
    });

    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(signals[0]).toBeDefined();
    expect(signals[0]?.aborted).toBe(false);

    rerender({ q: 'second' });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(signals[1]?.aborted).toBe(false);
    expect(signals[0]?.aborted).toBe(true);
  });
});
