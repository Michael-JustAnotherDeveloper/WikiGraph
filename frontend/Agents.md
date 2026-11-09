# AGENTS.md — WikiGraph Frontend

> **Scope reminder:** The agent operates **only inside `frontend/`**. Every other directory in the repository is mounted **read-only** at the Linux kernel level. Any attempt to write outside `frontend/` fails with `Permission denied` (`EACCES`). The agent must treat this as a hard boundary, not a bug to work around. `.env` is **never** read, created, or modified — the agent works exclusively against `.env.example`.

## 1. Purpose
This file is the **specification for the CLI agent** implementing the WikiGraph frontend. API contracts below are **frozen**. If something is missing, record it in `frontend/TODO.md` and stop — do not invent endpoints.

## 2. Product in one paragraph
WikiGraph is a visual knowledge-base browser. The user searches articles via Elasticsearch, sees a graph of links around a selected node (Neo4j), clicks a node, and opens the article's HTML served by a presigned URL from S3. The common key across all three stores is `uuid = UUIDv5(url)`.

## 3. Agent's responsibility boundary (enforced by OS)

**Writable (inside `frontend/`):**
- `frontend/src/**`, `frontend/public/**`
- `frontend/package.json`, `frontend/package-lock.json`
- `frontend/vite.config.ts`, `frontend/tsconfig*.json`, `frontend/index.html`
- `frontend/.env.example`
- `frontend/TODO.md`

**Read-only (`0444` / `0555` — writes return `EACCES`):**
- everything else in the repository, including `frontend/.env` if it exists

**Forbidden — do not attempt:**
- Creating, editing, or deleting `.env` anywhere, including `frontend/.env`. Use `.env.example` only. The human operator copies `.env.example` → `.env` outside the agent session.
- Writing to the repo root, `.git/`, `.github/`, `backend/`, `admin/`, `infra/`, `scripts/`, `architecture.md`.
- `chmod` / `chown` / `sudo` or any other attempt to bypass read-only boundaries.
- Network access outside the `npm` registry and the local dev API (`http://localhost:8080`).
- Logging, echoing, or embedding values that look like secrets.

If a write outside `frontend/` is required → append a `BLOCKED:` entry to `frontend/TODO.md` with the proposed diff and stop.

### 3.1 `.env.example` content
```
VITE_API_BASE=/api
```

## 4. Stack (mandatory)
- TypeScript 5.5.3, React 18.3.1, Vite 5.3.4
- Routing: `react-router-dom` v6
- Data: `@tanstack/react-query` v5
- State: `zustand` (allowed — it is the project's chosen state layer in the project brief)
- Graph: **`react-force-graph-2d`** (fixed by the project brief — do not substitute)
- Styling: **CSS Modules** + CSS variables (no Tailwind, no UI kits)
- Icons: `lucide-react`
- Fonts: **Inter** via `@fontsource/inter` (no CDN)
- Lint/format: ESLint + Prettier

## 5. Design language — **Obsidian-inspired (mandatory)**

The design language is **"like Obsidian"**, not glassmorphism. This is a hard requirement; the earlier glassmorphism reference is superseded.

Concrete rules:
- **Dark theme by default**, light theme via toggle; both driven by CSS variables on `:root` and `[data-theme="dark"]`.
- **Palette:**
  - background `#1e1e1e`
  - panels `#262626`
  - borders `1px solid #333`
  - primary text `#dcddde`, muted text `#999`
  - accent (links, active nodes, focus rings) **violet `#8b5cf6`**
- **No glassmorphism**: no `backdrop-filter`, no `blur()`, no translucent frosted panels, no gradients, no drop shadows. Separation is achieved with thin borders and flat surfaces only.
- **Minimal decoration**: flat surfaces, no ornamental elements. Visual hierarchy via color contrast, weight, and spacing — not depth.
- **Typography:** Inter, base size 14px, line-height 1.5, weights 400/500/600 only.
- **Spacing:** all spacing multiples of **4px**. Radii: `4px` small, `8px` medium.
- **Graph node colors:**
  - `:Page` → accent violet `#8b5cf6`, opacity 1.0
  - `:Stub` → muted gray `#666`, opacity 0.45, dashed outline
- **Hover/focus:** background shifts to `#2e2e2e`; focus ring is `2px solid #8b5cf6` offset by `2px`.
- **Empty/loading/error states** are flat, text-first, no illustrations.

Anything that visually resembles frosted glass, blurred panels, or layered translucency is **out of scope** and must be rejected during review.

## 6. Routes and screens
| Route | Screen | Data source |
| --- | --- | --- |
| `/` | Search + empty state | `GET /api/search` |
| `/search?q=&lang=&size=` | Search results | `GET /api/search` |
| `/graph/:uuidOrUrl?k=` | Force-directed graph around a node | `GET /api/graph/{uuid\|url}?k=` |
| `/page/:uuid` | Article view (sandboxed iframe) | `GET /api/page/{uuid}/url` |
| `/random` | Redirect to a random article | `GET /api/random` → `/page/:uuid` |

Shared header on every screen: logo, global search, theme toggle, "Random" button, health badge.

## 7. API contracts (frozen)

Base prefix: `/api`. All responses JSON.

### 7.1 `GET /api/search?q=<string>&lang=<ru|en>&size=<int 1..50>`
```ts
type SearchResponse = {
  items: Array<{
    uuid: string;
    url: string;
    title: string;
    author?: string;
    description?: string;
    score: number;
  }>;
  total: number;
};
```
`size` default 20, max 50. Do not send the request if `q` is empty. Validate with `zod` in `src/api/types.ts`.

### 7.2 `GET /api/graph/{uuid|url}?k=<1..5>`
The backend returns a **flat** structure — nodes carry `resolved`, edges reference node **urls**, not indices:
```ts
type GraphResponse = {
  nodes: Array<{
    uuid: string | null;   // null for Stub
    url: string;
    title: string | null;  // null for Stub
    description: string | null;
    resolved: boolean;     // false for Stub
  }>;
  edges: Array<{ from: string; to: string }>; // urls
};
```
`k` defaults to 1; UI clamps to `[1,5]`.

### 7.3 `GET /api/page/{uuid}/url`
Response: `{ url: string }`. Rendered in `<iframe sandbox="allow-scripts allow-same-origin">` at `/page/:uuid`. On expired URL (403 from S3) show a "Refresh link" button that re-fetches.

### 7.4 `GET /api/backlinks/{uuid|url}`
```ts
type BacklinksResponse = { items: Array<{ uuid: string; url: string; title: string }> };
```

### 7.5 `GET /api/random`
Response: `{ uuid: string; url: string }` → redirect to `/page/:uuid`.

### 7.6 `GET /stats`
```ts
type StatsResponse = { pages: number; stubs: number; edges: number };
```
Rendered in the homepage footer.

### 7.7 `GET /health`
```ts
type HealthResponse = {
  elasticsearch: 'ok' | 'down';
  neo4j: 'ok' | 'down';
  s3: 'ok' | 'down';
};
```
HTTP 503 if any is `down`. UI shows a colored indicator in the header.

### 7.8 Errors
`{ code: string; message: string }`. All `react-query` hooks wrap errors into an `ApiError` class with `code`, `status`, `message`.

## 8. Required UI behaviors
1. **Search**: input with 300 ms debounce, `q/lang/size` synced to the URL via `useSearchParams`. `lang` comes from a UI switch (default: browser locale normalized to `ru`/`en`, fallback `ru`). Enter triggers immediate search. Cancel previous request with `AbortController`.
2. **Graph** (`react-force-graph-2d`):
   - Force-directed layout.
   - `:Page` → accent violet, opaque; `:Stub` → muted gray, `0.45` opacity, dashed outline.
   - **Hover** shows description (Page) or url (Stub) in a flat tooltip.
   - **Click Page** → `/page/:uuid`. **Click Stub** → toast "This page has not been uploaded yet." (no S3 call).
   - Drag, zoom, fit-to-screen. `k` selector (1..5) in a corner. Legend: Page / Stub.
3. **Article view**: title from the graph node, `<iframe sandbox>` with the presigned URL, "Open in new tab" and "Refresh link" buttons.
4. **States**: loading (flat skeleton), empty, error (message + retry).
5. **Health badge** in the header: polls `/health` every 30 s; red badge + tooltip on 503.
6. **Theme**: light/dark toggle, persisted in `localStorage`, dark by default.

## 9. Non-functional requirements
- TypeScript strict mode on.
- No `any` in public types; `unknown` + `zod` at the API boundary.
- All network calls go through `src/api/client.ts` reading `import.meta.env.VITE_API_BASE` (fallback `/api`).
- Tests: `vitest` + `@testing-library/react`. Minimum:
  - `client.ts` — error parsing;
  - `useSearch` — debounce + cancellation;
  - `Graph` — renders nodes from fixture, distinguishes resolved vs stub, fires the correct click handler.
- Accessibility: keyboard-operable controls, `aria-label` on icon buttons, contrast ≥ 4.5:1.
- Bundle: `npm run build` produces no warnings for chunks > 500 kB. The graph library must be `React.lazy`-loaded.
- ESLint clean, `tsc --noEmit` clean.

## 10. Directory layout (mandatory)
```
frontend/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .env.example                # VITE_API_BASE=/api  (never .env)
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/
│   │   ├── client.ts
│   │   ├── types.ts            # zod schemas + TS types
│   │   └── hooks.ts
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── SearchBar.tsx
│   │   ├── Graph.tsx
│   │   ├── BacklinksPanel.tsx
│   │   ├── HealthBadge.tsx
│   │   ├── ThemeToggle.tsx
│   │   └── StateViews.tsx
│   ├── pages/
│   │   ├── HomePage.tsx
│   │   ├── SearchPage.tsx
│   │   ├── GraphPage.tsx
│   │   └── ArticlePage.tsx
│   ├── styles/
│   │   ├── tokens.css
│   │   └── global.css
│   └── test/
│       ├── setup.ts
│       └── *.test.tsx
└── TODO.md
```

## 11. Definition of Done
1. `npm install && npm run build` succeeds, no TS errors.
2. `npm run lint` → 0 errors.
3. `npm test` → all green; `src/api` coverage ≥ 70 %.
4. Manual smoke (documented in PR): search → graph → article → backlinks → random → theme toggle → health badge.
5. All 8 endpoints from §7 used exactly where §6 says.
6. `TODO.md` contains either nothing or `BLOCKED:`/question entries with reasoning.
7. **Visual review passed**: no glassmorphism anywhere. No `backdrop-filter`, no `blur()`, no gradients, no shadows. Palette, typography, spacing match §5. Dark theme is default.

## 12. Agent rules
- Work iteratively: skeleton first (`main.tsx`, `App.tsx`, routes, `client.ts`), then one screen at a time, each with a test and a manual smoke note.
- Do **not** commit or push without an explicit request.
- Do **not** add dependencies beyond §4 without justification in the PR.
- If an API contract is ambiguous → `TODO` in `frontend/TODO.md` and a loud `throw new Error('TODO: ...')` in the corresponding hook. Do not guess.
- Work on branch `feat/frontend-<short-name>`.
- Follow §5 literally — anything visually resembling frosted glass or translucent panels is rejected.
- **Never bypass read-only boundaries.** If a file outside `frontend/` must change, append a `BLOCKED:` entry to `frontend/TODO.md`. No `chmod`, `chown`, `sudo`.
- **Never read, create, or modify `.env`.** Use `.env.example` only.

## 13. Local verification
```bash
cd frontend
npm install
# Do NOT create .env — the agent works against .env.example only.
npm run dev                # http://localhost:5173
# Human operator, outside agent session, from project root:
#   sudo docker compose up -d
```
Vite dev proxies `/api`, `/health`, `/stats` to `http://localhost:8080` via `server.proxy`.

## 14. Escalation
API-contract questions → `TODO.md` in the PR, tag `@backend`. Infra/deploy questions → out of scope, leave a TODO. Any change outside `frontend/` → `BLOCKED:` entry in `frontend/TODO.md` with the proposed diff.