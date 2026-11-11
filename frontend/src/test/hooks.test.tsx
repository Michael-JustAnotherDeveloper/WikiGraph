import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet, bareGet } from '../api/client';
import {
  clampK,
  useBacklinks,
  useGraph,
  useHealth,
  usePageUrl,
  useRandom,
  useStats,
} from '../api/hooks';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, apiGet: vi.fn(), bareGet: vi.fn() };
});

const apiGetMock = vi.mocked(apiGet);
const bareGetMock = vi.mocked(bareGet);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('API hooks', () => {
  beforeEach(() => {
    apiGetMock.mockResolvedValue({ nodes: [], edges: [] } as never);
    bareGetMock.mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('useGraph requests /graph/{id}?k= with the id url-encoded', async () => {
    const graph = { nodes: [], edges: [] };
    apiGetMock.mockResolvedValue(graph as never);

    const { result } = renderHook(() => useGraph('https://ru.wikipedia.org/wiki/X', 3), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual(graph));
    expect(apiGetMock).toHaveBeenCalledWith(
      `/graph/${encodeURIComponent('https://ru.wikipedia.org/wiki/X')}?k=3`,
      expect.anything(),
      expect.anything(),
    );
  });

  it('useBacklinks requests /backlinks/{id}', async () => {
    const backlinks = { items: [{ uuid: 'u1', url: 'https://a.test', title: 'A' }] };
    apiGetMock.mockResolvedValue(backlinks as never);

    const { result } = renderHook(() => useBacklinks('u1'), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(backlinks));
    expect(apiGetMock).toHaveBeenCalledWith('/backlinks/u1', expect.anything(), expect.anything());
  });

  it('usePageUrl requests /page/{uuid}/url', async () => {
    const page = { url: 'https://s3.example/presigned' };
    apiGetMock.mockResolvedValue(page as never);

    const { result } = renderHook(() => usePageUrl('u1'), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(page));
    expect(apiGetMock).toHaveBeenCalledWith('/page/u1/url', expect.anything(), expect.anything());
  });

  it('useRandom requests /random', async () => {
    const random = { uuid: 'u1', url: 'https://a.test' };
    apiGetMock.mockResolvedValue(random as never);

    const { result } = renderHook(() => useRandom(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(random));
    expect(apiGetMock).toHaveBeenCalledWith('/random', expect.anything(), expect.anything());
  });

  it('useStats requests bare /stats without the /api prefix', async () => {
    const stats = { pages: 1, stubs: 2, edges: 3 };
    bareGetMock.mockResolvedValue(stats as never);

    const { result } = renderHook(() => useStats(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(stats));
    expect(bareGetMock).toHaveBeenCalledWith('/stats', expect.anything(), expect.anything());
  });

  it('useHealth requests bare /health without the /api prefix', async () => {
    const health = { elasticsearch: 'ok', neo4j: 'ok', s3: 'ok' };
    bareGetMock.mockResolvedValue(health as never);

    const { result } = renderHook(() => useHealth(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(health));
    expect(bareGetMock).toHaveBeenCalledWith('/health', expect.anything(), expect.anything());
  });

  it('clampK clamps depth to [1, 5]', () => {
    expect(clampK(0)).toBe(1);
    expect(clampK(3)).toBe(3);
    expect(clampK(9)).toBe(5);
    expect(clampK(Number.NaN)).toBe(1);
  });
});
