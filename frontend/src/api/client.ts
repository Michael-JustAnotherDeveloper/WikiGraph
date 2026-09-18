const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export interface SearchHit {
  uuid: string;
  url: string;
  title: string;
  author: string;
  description: string;
  score: number;
}

/** Для :Stub бэкенд присылает uuid/title/description как null. */
export interface GraphNode {
  uuid: string | null;
  url: string;
  title: string | null;
  description: string | null;
  resolved: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PageURL {
  url: string;
  expires_in: number;
  expires_at: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    let message = `Запрос завершился с кодом ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // тело не в JSON — оставляем сообщение по коду
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export function search(query: string, lang: string) {
  const params = new URLSearchParams({ q: query, lang });
  return request<{ hits: SearchHit[] }>(`/search?${params}`).then((r) => r.hits ?? []);
}

/** id принимает и uuid, и url — бэкенд ищет узел по обоим. */
export function fetchGraph(id: string, k: number) {
  return request<GraphResult>(`/graph/${encodeURIComponent(id)}?k=${k}`);
}

export function fetchPageURL(uuid: string) {
  return request<PageURL>(`/page/${encodeURIComponent(uuid)}/url`);
}

export function fetchBacklinks(id: string) {
  return request<{ backlinks: string[] }>(`/backlinks/${encodeURIComponent(id)}`).then(
    (r) => r.backlinks ?? [],
  );
}

export function fetchRandom() {
  return request<SearchHit>('/random');
}