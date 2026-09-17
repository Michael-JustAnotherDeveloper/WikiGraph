package graph

import (
	"context"
	"fmt"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/example/wiki-graph/backend/internal/config"
	"github.com/example/wiki-graph/backend/internal/domain"
)

// Repo — проекция Page в граф. О языке не знает: title/description пишутся
// как есть, одним полем.
type Repo struct {
	driver neo4j.DriverWithContext
}

func New(cfg *config.Config) (*Repo, error) {
	driver, err := neo4j.NewDriverWithContext(
		cfg.Neo4jURI,
		neo4j.BasicAuth(cfg.Neo4jUser, cfg.Neo4jPassword, ""),
	)
	if err != nil {
		return nil, fmt.Errorf("neo4j driver: %w", err)
	}
	return &Repo{driver: driver}, nil
}

func NewWithDriver(driver neo4j.DriverWithContext) *Repo { return &Repo{driver: driver} }

func (r *Repo) Close(ctx context.Context) error { return r.driver.Close(ctx) }

func (r *Repo) Ping(ctx context.Context) error { return r.driver.VerifyConnectivity(ctx) }

// EnsureConstraints создаёт ограничения уникальности. Идемпотентно.
func (r *Repo) EnsureConstraints(ctx context.Context) error {
	stmts := []string{
		"CREATE CONSTRAINT page_uuid_unique IF NOT EXISTS FOR (n:Page) REQUIRE n.uuid IS UNIQUE",
		"CREATE CONSTRAINT page_url_unique IF NOT EXISTS FOR (n:Page) REQUIRE n.url IS UNIQUE",
		"CREATE CONSTRAINT stub_url_unique IF NOT EXISTS FOR (n:Stub) REQUIRE n.url IS UNIQUE",
	}
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	for _, stmt := range stmts {
		res, err := session.Run(ctx, stmt, nil)
		if err != nil {
			return fmt.Errorf("constraint: %w", err)
		}
		if _, err := res.Consume(ctx); err != nil {
			return fmt.Errorf("constraint: %w", err)
		}
	}
	return nil
}

const (
	// existsCypher отвечает на вопрос «это создание или перезапись».
	// Заглушка по тому же url считается отсутствием страницы.
	existsCypher = `
		OPTIONAL MATCH (p:Page {url: $url})
		RETURN p IS NOT NULL AS pageExists
	`

	// promoteStubCypher повышает заглушку до :Page. Узел остаётся тем же,
	// поэтому входящие рёбра сохраняются.
	promoteStubCypher = `
		MATCH (s:Stub {url: $url})
		SET s:Page
		REMOVE s:Stub
	`

	// upsertPageCypher создаёт или обновляет саму страницу.
	upsertPageCypher = `
		MERGE (p:Page {url: $url})
		SET p.uuid = $uuid,
		    p.title = $title,
		    p.description = $description
	`

	// dropOutgoingCypher сносит все исходящие рёбра: список links в payload —
	// это полное состояние страницы, а не дельта.
	dropOutgoingCypher = `
		MATCH (p:Page {url: $url})-[r:LINKS_TO]->()
		DELETE r
	`

	// createStubsCypher заводит :Stub для тех исходящих url, по которым
	// ещё нет ни страницы, ни заглушки.
	createStubsCypher = `
		UNWIND $links AS link
		OPTIONAL MATCH (pg:Page {url: link})
		OPTIONAL MATCH (st:Stub  {url: link})
		WITH link, coalesce(pg, st) AS existing
		FOREACH (_ IN CASE WHEN existing IS NULL THEN [1] ELSE [] END |
			CREATE (:Stub {url: link})
		)
	`

	// linkCypher строит рёбра. Отдельным запросом от createStubsCypher,
	// чтобы не читать в том же запросе то, что сами же только что создали.
	linkCypher = `
		MATCH (p:Page {url: $url})
		UNWIND $links AS link
		OPTIONAL MATCH (pg:Page {url: link})
		OPTIONAL MATCH (st:Stub  {url: link})
		WITH p, coalesce(pg, st) AS target
		WHERE target IS NOT NULL
		MERGE (p)-[:LINKS_TO]->(target)
	`

	// cleanupStubsCypher убирает заглушки, оставшиеся без входящих рёбер
	// после реконсиляции: :Stub существует только как цель ссылки.
	cleanupStubsCypher = `
		MATCH (s:Stub) WHERE NOT ()-[:LINKS_TO]->(s)
		DELETE s
	`
)

// Insert вставляет страницу или полностью перезаписывает существующую.
// Возвращает created == true, если :Page с таким url ещё не было — включая
// случай, когда по этому url висела только заглушка.
//
// Вся последовательность идёт одной транзакцией: промежуточного состояния
// «старые рёбра удалены, новые ещё не созданы» снаружи не видно.
func (r *Repo) Insert(ctx context.Context, page domain.Page) (bool, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	links := dedupe(page.Links)
	params := map[string]any{
		"uuid":        page.UUID,
		"url":         page.URL,
		"title":       page.Title,
		"description": page.Description,
		"links":       links,
	}

	out, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		res, err := tx.Run(ctx, existsCypher, params)
		if err != nil {
			return nil, err
		}
		rec, err := res.Single(ctx)
		if err != nil {
			return nil, err
		}
		v, _ := rec.Get("pageExists")
		created := !asBool(v)

		for _, stmt := range []string{promoteStubCypher, upsertPageCypher, dropOutgoingCypher} {
			if err := run(ctx, tx, stmt, params); err != nil {
				return nil, err
			}
		}
		if len(links) > 0 {
			for _, stmt := range []string{createStubsCypher, linkCypher} {
				if err := run(ctx, tx, stmt, params); err != nil {
					return nil, err
				}
			}
		}
		if err := run(ctx, tx, cleanupStubsCypher, nil); err != nil {
			return nil, err
		}
		return created, nil
	})
	if err != nil {
		return false, fmt.Errorf("neo4j upsert: %w", err)
	}
	return out.(bool), nil
}

// findGraphCypher: длина пути в variable-length подставляется в текст запроса
// (Cypher не принимает её параметром), поэтому k обязан быть провалидирован
// до попадания сюда.
const findGraphCypher = `
MATCH (start:Page) WHERE start.uuid = $id OR start.url = $id
MATCH (start)-[:LINKS_TO*0..%d]->(n)
WITH collect(DISTINCT n) AS nodes
UNWIND nodes AS n
OPTIONAL MATCH (n)-[:LINKS_TO]->(m) WHERE m IN nodes
RETURN
  n.url          AS url,
  n.uuid         AS uuid,
  n.title        AS title,
  n.description  AS description,
  n:Page         AS resolved,
  collect(m.url) AS targets
`

// FindGraph обходит LINKS_TO в исходящем направлении до k итераций и
// возвращает плоский набор вершин и рёбер — без дополнительных запросов
// в ES, потому что title/description уже лежат в графе.
//
// id принимает как uuid, так и url.
func (r *Repo) FindGraph(ctx context.Context, id string, k int) (domain.GraphResult, error) {
	if k < 1 || k > 5 {
		return domain.GraphResult{}, fmt.Errorf("%w: k must be in [1;5]", domain.ErrInvalidArgument)
	}

	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		res, err := tx.Run(ctx, fmt.Sprintf(findGraphCypher, k), map[string]any{"id": id})
		if err != nil {
			return nil, err
		}
		recs, err := res.Collect(ctx)
		if err != nil {
			return nil, err
		}

		out := domain.GraphResult{Nodes: []domain.GraphNode{}, Edges: []domain.GraphEdge{}}
		for _, rec := range recs {
			url, _ := rec.Get("url")
			resolved, _ := rec.Get("resolved")
			node := domain.GraphNode{
				URL:         asString(url),
				UUID:        stringPtr(rec, "uuid"),
				Title:       stringPtr(rec, "title"),
				Description: stringPtr(rec, "description"),
				Resolved:    asBool(resolved),
			}
			out.Nodes = append(out.Nodes, node)

			targets, _ := rec.Get("targets")
			for _, t := range asSlice(targets) {
				if to := asString(t); to != "" {
					out.Edges = append(out.Edges, domain.GraphEdge{From: node.URL, To: to})
				}
			}
		}
		return out, nil
	})
	if err != nil {
		return domain.GraphResult{}, fmt.Errorf("neo4j graph: %w", err)
	}

	res := result.(domain.GraphResult)
	if len(res.Nodes) == 0 {
		return domain.GraphResult{}, domain.ErrNotFound
	}
	return res, nil
}

const backlinksCypher = `
MATCH (t) WHERE (t:Page OR t:Stub) AND (t.uuid = $id OR t.url = $id)
MATCH (src)-[:LINKS_TO]->(t)
RETURN DISTINCT src.url AS url
`

// FindBacklinks возвращает url, которые ссылаются на данный узел.
func (r *Repo) FindBacklinks(ctx context.Context, id string) ([]string, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		res, err := tx.Run(ctx, backlinksCypher, map[string]any{"id": id})
		if err != nil {
			return nil, err
		}
		recs, err := res.Collect(ctx)
		if err != nil {
			return nil, err
		}
		urls := make([]string, 0, len(recs))
		for _, rec := range recs {
			v, _ := rec.Get("url")
			if s := asString(v); s != "" {
				urls = append(urls, s)
			}
		}
		return urls, nil
	})
	if err != nil {
		return nil, fmt.Errorf("neo4j backlinks: %w", err)
	}
	return result.([]string), nil
}

const statsCypher = `
CALL { MATCH (p:Page) RETURN count(p) AS pages }
CALL { MATCH (s:Stub) RETURN count(s) AS stubs }
CALL { MATCH ()-[r:LINKS_TO]->() RETURN count(r) AS edges }
RETURN pages, stubs, edges
`

func (r *Repo) Stats(ctx context.Context) (domain.Stats, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		res, err := tx.Run(ctx, statsCypher, nil)
		if err != nil {
			return nil, err
		}
		rec, err := res.Single(ctx)
		if err != nil {
			return nil, err
		}
		pages, _ := rec.Get("pages")
		stubs, _ := rec.Get("stubs")
		edges, _ := rec.Get("edges")
		return domain.Stats{Pages: asInt(pages), Stubs: asInt(stubs), Edges: asInt(edges)}, nil
	})
	if err != nil {
		return domain.Stats{}, fmt.Errorf("neo4j stats: %w", err)
	}
	return result.(domain.Stats), nil
}

func run(ctx context.Context, tx neo4j.ManagedTransaction, stmt string, params map[string]any) error {
	res, err := tx.Run(ctx, stmt, params)
	if err != nil {
		return err
	}
	_, err = res.Consume(ctx)
	return err
}

// dedupe убирает дубликаты и пустые значения. Ссылка страницы на саму себя
// допустима и сохраняется.
func dedupe(links []string) []string {
	seen := make(map[string]struct{}, len(links))
	out := make([]string, 0, len(links))
	for _, l := range links {
		if l == "" {
			continue
		}
		if _, ok := seen[l]; ok {
			continue
		}
		seen[l] = struct{}{}
		out = append(out, l)
	}
	return out
}

func asString(v any) string { s, _ := v.(string); return s }
func asBool(v any) bool     { b, _ := v.(bool); return b }
func asInt(v any) int64     { i, _ := v.(int64); return i }
func asSlice(v any) []any   { s, _ := v.([]any); return s }

// stringPtr возвращает nil для отсутствующих свойств — так uuid/title/
// description у :Stub уезжают на фронт как null.
func stringPtr(rec *neo4j.Record, key string) *string {
	v, ok := rec.Get(key)
	if !ok || v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		return nil
	}
	return &s
}
