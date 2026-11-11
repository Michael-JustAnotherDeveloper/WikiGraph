import { z } from 'zod';

/*
 * Zod schemas for the frozen API contracts from Agents.md §7.
 *
 * The current Go backend deviates from the frozen contract for a few
 * endpoints (see TODO.md, tag @backend). The unions below accept the
 * backend's actual shape as a fallback and normalize it into the frozen
 * spec shape, so the public TypeScript types stay exactly per spec.
 */

export const SearchHitSchema = z.object({
  uuid: z.string(),
  url: z.string(),
  title: z.string(),
  author: z.string().optional(),
  description: z.string().optional(),
  score: z.number(),
});

const SpecSearchResponseSchema = z
  .object({
    items: z.array(SearchHitSchema),
    total: z.number().int().nonnegative(),
  })
  .transform((body) => ({ items: body.items, total: body.total }));

// Backend currently returns { "hits": [...] } without "total" (TODO.md, @backend).
const BackendSearchResponseSchema = z
  .object({ hits: z.array(SearchHitSchema) })
  .transform((body) => ({ items: body.hits, total: body.hits.length }));

export const SearchResponseSchema = z.union([
  SpecSearchResponseSchema,
  BackendSearchResponseSchema,
]);

export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchResponse = z.infer<typeof SpecSearchResponseSchema>;

export const GraphNodeSchema = z.object({
  uuid: z.string().nullable(),
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  resolved: z.boolean(),
});

export const GraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const GraphResponseSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphResponse = z.infer<typeof GraphResponseSchema>;

export const BacklinkItemSchema = z.object({
  uuid: z.string(),
  url: z.string(),
  title: z.string(),
});

const SpecBacklinksResponseSchema = z
  .object({
    items: z.array(BacklinkItemSchema),
  })
  .transform((body) => ({ items: body.items }));

// Backend currently returns { "backlinks": [<url>, ...] } (TODO.md, @backend).
// UUID/title are unknown in that shape; uuid stays empty and the panel falls
// back to linking by url.
const BackendBacklinksResponseSchema = z
  .object({ backlinks: z.array(z.string()) })
  .transform((body) => ({
    items: body.backlinks.map((url) => ({ uuid: '', url, title: '' })),
  }));

export const BacklinksResponseSchema = z.union([
  SpecBacklinksResponseSchema,
  BackendBacklinksResponseSchema,
]);

export type BacklinkItem = z.infer<typeof BacklinkItemSchema>;
export type BacklinksResponse = z.infer<typeof SpecBacklinksResponseSchema>;

export const PageUrlResponseSchema = z.object({
  url: z.string().min(1),
});

export type PageUrlResponse = z.infer<typeof PageUrlResponseSchema>;

export const RandomResponseSchema = z.object({
  uuid: z.string(),
  url: z.string(),
});

export type RandomResponse = z.infer<typeof RandomResponseSchema>;

export const StatsResponseSchema = z.object({
  pages: z.number(),
  stubs: z.number(),
  edges: z.number(),
});

export type StatsResponse = z.infer<typeof StatsResponseSchema>;

const HealthStatusSchema = z.enum(['ok', 'down']);

const SpecHealthResponseSchema = z
  .object({
    elasticsearch: HealthStatusSchema,
    neo4j: HealthStatusSchema,
    s3: HealthStatusSchema,
  })
  .transform((body) => ({
    elasticsearch: body.elasticsearch,
    neo4j: body.neo4j,
    s3: body.s3,
  }));

// Backend currently returns { "status": "ok"|"degraded", "checks": { name: "ok"|"down: ..." } }
// with HTTP 503 on failure (TODO.md, @backend).
const BackendHealthResponseSchema = z
  .object({
    status: z.string().optional(),
    checks: z.record(z.string()),
  })
  .transform((body) => {
    const statusOf = (name: string): 'ok' | 'down' =>
      (body.checks[name] ?? '').startsWith('ok') ? 'ok' : 'down';
    return {
      elasticsearch: statusOf('elasticsearch'),
      neo4j: statusOf('neo4j'),
      s3: statusOf('s3'),
    };
  });

export const HealthResponseSchema = z.union([
  SpecHealthResponseSchema,
  BackendHealthResponseSchema,
]);

export type HealthResponse = z.infer<typeof SpecHealthResponseSchema>;

export type Lang = 'ru' | 'en';
