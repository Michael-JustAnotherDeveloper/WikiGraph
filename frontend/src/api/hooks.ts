import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { apiGet, bareGet } from './client';
import {
  BacklinksResponseSchema,
  GraphResponseSchema,
  HealthResponseSchema,
  PageUrlResponseSchema,
  RandomResponseSchema,
  SearchResponseSchema,
  StatsResponseSchema,
  type Lang,
} from './types';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

const SEARCH_DEBOUNCE_MS = 300;

export function useSearch(q: string, lang: Lang, size: number) {
  const debouncedQ = useDebouncedValue(q.trim(), SEARCH_DEBOUNCE_MS);

  return useQuery({
    queryKey: ['search', { q: debouncedQ, lang, size }],
    queryFn: ({ signal }) =>
      apiGet(
        `/search?q=${encodeURIComponent(debouncedQ)}&lang=${lang}&size=${size}`,
        SearchResponseSchema,
        signal,
      ),
    enabled: debouncedQ.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function clampK(k: number): number {
  if (!Number.isFinite(k)) return 1;
  return Math.min(5, Math.max(1, Math.round(k)));
}

export function useGraph(id: string, k: number) {
  return useQuery({
    queryKey: ['graph', { id, k }],
    queryFn: ({ signal }) =>
      apiGet(`/graph/${encodeURIComponent(id)}?k=${k}`, GraphResponseSchema, signal),
    enabled: id.length > 0,
  });
}

export function useBacklinks(id: string) {
  return useQuery({
    queryKey: ['backlinks', id],
    queryFn: ({ signal }) =>
      apiGet(`/backlinks/${encodeURIComponent(id)}`, BacklinksResponseSchema, signal),
    enabled: id.length > 0,
  });
}

export function usePageUrl(uuid: string) {
  return useQuery({
    queryKey: ['page-url', uuid],
    queryFn: ({ signal }) =>
      apiGet(`/page/${encodeURIComponent(uuid)}/url`, PageUrlResponseSchema, signal),
    enabled: uuid.length > 0,
    staleTime: 0,
    retry: false,
  });
}

export function useRandom() {
  return useQuery({
    queryKey: ['random'],
    queryFn: ({ signal }) => apiGet('/random', RandomResponseSchema, signal),
    retry: false,
  });
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: ({ signal }) => bareGet('/stats', StatsResponseSchema, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => bareGet('/health', HealthResponseSchema, signal),
    refetchInterval: 30_000,
    retry: false,
  });
}
