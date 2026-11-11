import { describe, expect, it } from 'vitest';

import {
  BacklinksResponseSchema,
  GraphResponseSchema,
  HealthResponseSchema,
  PageUrlResponseSchema,
  RandomResponseSchema,
  SearchResponseSchema,
  StatsResponseSchema,
} from '../api/types';

describe('API schemas (frozen contract normalization)', () => {
  it('SearchResponse: accepts the spec shape { items, total }', () => {
    const parsed = SearchResponseSchema.parse({
      items: [
        {
          uuid: 'u1',
          url: 'https://a.test',
          title: 'A',
          author: 'auth',
          description: 'desc',
          score: 1.5,
        },
      ],
      total: 1,
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.total).toBe(1);
  });

  it('SearchResponse: normalizes the backend { hits } shape', () => {
    const parsed = SearchResponseSchema.parse({
      hits: [
        { uuid: 'u1', url: 'https://a.test', title: 'A', author: '', description: '', score: 2 },
      ],
    });
    expect(parsed.total).toBe(1);
    expect(parsed.items[0]).toMatchObject({ uuid: 'u1', title: 'A' });
  });

  it('BacklinksResponse: accepts the spec shape { items }', () => {
    const parsed = BacklinksResponseSchema.parse({
      items: [{ uuid: 'u1', url: 'https://a.test', title: 'A' }],
    });
    expect(parsed.items[0]).toEqual({ uuid: 'u1', url: 'https://a.test', title: 'A' });
  });

  it('BacklinksResponse: normalizes the backend { backlinks: string[] } shape', () => {
    const parsed = BacklinksResponseSchema.parse({ backlinks: ['https://a.test'] });
    expect(parsed.items).toEqual([{ uuid: '', url: 'https://a.test', title: '' }]);
  });

  it('HealthResponse: accepts the spec shape with flat service statuses', () => {
    expect(HealthResponseSchema.parse({ elasticsearch: 'ok', neo4j: 'ok', s3: 'ok' })).toEqual({
      elasticsearch: 'ok',
      neo4j: 'ok',
      s3: 'ok',
    });
  });

  it('HealthResponse: normalizes the backend { status, checks } shape', () => {
    const parsed = HealthResponseSchema.parse({
      status: 'degraded',
      checks: { elasticsearch: 'ok', neo4j: 'down: connection refused', s3: 'ok' },
    });
    expect(parsed).toEqual({ elasticsearch: 'ok', neo4j: 'down', s3: 'ok' });
  });

  it('GraphResponse validates nodes and url-keyed edges', () => {
    const parsed = GraphResponseSchema.parse({
      nodes: [
        {
          uuid: null,
          url: 'https://stub.test',
          title: null,
          description: null,
          resolved: false,
        },
      ],
      edges: [{ from: 'https://a.test', to: 'https://b.test' }],
    });
    expect(parsed.nodes[0].resolved).toBe(false);
    expect(parsed.edges[0]).toEqual({ from: 'https://a.test', to: 'https://b.test' });
  });

  it('RandomResponse strips extra backend fields down to { uuid, url }', () => {
    expect(
      RandomResponseSchema.parse({
        uuid: 'u1',
        url: 'https://a.test',
        title: 'A',
        author: '',
        description: '',
        score: 3,
      }),
    ).toEqual({ uuid: 'u1', url: 'https://a.test' });
  });

  it('PageUrlResponse keeps the presigned url and ignores expiry extras', () => {
    expect(
      PageUrlResponseSchema.parse({
        url: 'https://s3.example/x',
        expires_in: 3600,
        expires_at: 'x',
      }),
    ).toEqual({ url: 'https://s3.example/x' });
  });

  it('StatsResponse validates counters', () => {
    expect(StatsResponseSchema.parse({ pages: 1, stubs: 2, edges: 3 })).toEqual({
      pages: 1,
      stubs: 2,
      edges: 3,
    });
  });
});
