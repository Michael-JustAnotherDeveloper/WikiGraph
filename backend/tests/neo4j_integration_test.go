//go:build integration

package tests

import (
	"context"
	"testing"

	"github.com/example/wiki-graph/backend/internal/config"
	"github.com/example/wiki-graph/backend/internal/domain"
	"github.com/example/wiki-graph/backend/internal/repo/graph"
	"github.com/example/wiki-graph/backend/internal/service"
)

func newGraphRepo(t *testing.T) *graph.Repo {
	t.Helper()
	uri := startNeo4j(t)

	repo, err := graph.New(&config.Config{
		Neo4jURI:      uri,
		Neo4jUser:     "neo4j",
		Neo4jPassword: neo4jPassword,
	})
	if err != nil {
		t.Fatalf("new graph repo: %v", err)
	}
	t.Cleanup(func() { _ = repo.Close(context.Background()) })

	if err := repo.EnsureConstraints(context.Background()); err != nil {
		t.Fatalf("constraints: %v", err)
	}
	return repo
}

func page(url, title string, links ...string) domain.Page {
	return domain.Page{
		UUID:        service.PageUUID(url),
		URL:         url,
		Title:       title,
		Description: "описание " + url,
		Links:       links,
	}
}

func nodeByURL(t *testing.T, res domain.GraphResult, url string) domain.GraphNode {
	t.Helper()
	for _, n := range res.Nodes {
		if n.URL == url {
			return n
		}
	}
	t.Fatalf("node %s is missing from graph", url)
	return domain.GraphNode{}
}

func hasEdge(res domain.GraphResult, from, to string) bool {
	for _, e := range res.Edges {
		if e.From == from && e.To == to {
			return true
		}
	}
	return false
}

// Ссылка на незалитый url создаёт :Stub; вставка страницы с этим url
// повышает заглушку до :Page, сохраняя входящее ребро.
func TestInsertPromotesStubToPage(t *testing.T) {
	ctx := context.Background()
	repo := newGraphRepo(t)

	if _, err := repo.Insert(ctx, page("/wiki/A", "Статья А", "/wiki/B")); err != nil {
		t.Fatalf("insert A: %v", err)
	}

	res, err := repo.FindGraph(ctx, service.PageUUID("/wiki/A"), 1)
	if err != nil {
		t.Fatalf("graph before promotion: %v", err)
	}
	if b := nodeByURL(t, res, "/wiki/B"); b.Resolved || b.UUID != nil || b.Title != nil {
		t.Fatalf("/wiki/B must be an unresolved stub, got %+v", b)
	}

	created, err := repo.Insert(ctx, page("/wiki/B", "Статья Б"))
	if err != nil {
		t.Fatalf("insert B: %v", err)
	}
	if !created {
		t.Fatal("promotion of a stub must be reported as creation")
	}

	res, err = repo.FindGraph(ctx, service.PageUUID("/wiki/A"), 1)
	if err != nil {
		t.Fatalf("graph after promotion: %v", err)
	}
	b := nodeByURL(t, res, "/wiki/B")
	if !b.Resolved || b.UUID == nil || *b.UUID != service.PageUUID("/wiki/B") {
		t.Fatalf("/wiki/B must be a resolved page, got %+v", b)
	}
	if !hasEdge(res, "/wiki/A", "/wiki/B") {
		t.Fatal("incoming edge must survive promotion")
	}
}

// Повторная вставка того же url перезаписывает поля и приводит рёбра
// в соответствие новому списку links, а не накапливает старые.
func TestInsertOverwritesExistingPage(t *testing.T) {
	ctx := context.Background()
	repo := newGraphRepo(t)

	if _, err := repo.Insert(ctx, page("/wiki/A", "Старый заголовок", "/wiki/B")); err != nil {
		t.Fatalf("first insert: %v", err)
	}

	created, err := repo.Insert(ctx, page("/wiki/A", "Новый заголовок", "/wiki/C"))
	if err != nil {
		t.Fatalf("second insert: %v", err)
	}
	if created {
		t.Fatal("repeated insert must be reported as an overwrite, not a creation")
	}

	res, err := repo.FindGraph(ctx, service.PageUUID("/wiki/A"), 1)
	if err != nil {
		t.Fatalf("graph: %v", err)
	}

	a := nodeByURL(t, res, "/wiki/A")
	if a.Title == nil || *a.Title != "Новый заголовок" {
		t.Fatalf("title was not overwritten: %+v", a)
	}
	if !hasEdge(res, "/wiki/A", "/wiki/C") {
		t.Fatal("new edge is missing")
	}
	if hasEdge(res, "/wiki/A", "/wiki/B") {
		t.Fatal("stale edge survived the overwrite")
	}
	// Заглушка /wiki/B осталась без входящих рёбер и должна быть убрана.
	for _, n := range res.Nodes {
		if n.URL == "/wiki/B" {
			t.Fatal("orphaned stub was not cleaned up")
		}
	}
	if len(res.Nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d: %+v", len(res.Nodes), res.Nodes)
	}
}

// Обход должен останавливаться ровно на k-й итерации.
func TestFindGraphRespectsDepth(t *testing.T) {
	ctx := context.Background()
	repo := newGraphRepo(t)

	// A -> B -> C -> D(stub)
	for _, p := range []domain.Page{
		page("/wiki/A", "A", "/wiki/B"),
		page("/wiki/B", "B", "/wiki/C"),
		page("/wiki/C", "C", "/wiki/D"),
	} {
		if _, err := repo.Insert(ctx, p); err != nil {
			t.Fatalf("insert %s: %v", p.URL, err)
		}
	}

	cases := []struct {
		k         int
		wantNodes int
	}{
		{1, 2}, // A, B
		{2, 3}, // A, B, C
		{3, 4}, // A, B, C, D(stub)
		{5, 4}, // дальше идти некуда
	}
	for _, tc := range cases {
		res, err := repo.FindGraph(ctx, "/wiki/A", tc.k)
		if err != nil {
			t.Fatalf("graph k=%d: %v", tc.k, err)
		}
		if len(res.Nodes) != tc.wantNodes {
			t.Errorf("k=%d: got %d nodes, want %d", tc.k, len(res.Nodes), tc.wantNodes)
		}
	}

	res, err := repo.FindGraph(ctx, "/wiki/A", 3)
	if err != nil {
		t.Fatalf("graph: %v", err)
	}
	if d := nodeByURL(t, res, "/wiki/D"); d.Resolved {
		t.Fatalf("/wiki/D must stay unresolved: %+v", d)
	}
	if len(res.Edges) != 3 {
		t.Fatalf("expected 3 edges, got %d: %+v", len(res.Edges), res.Edges)
	}

	if _, err := repo.FindGraph(ctx, "/wiki/A", 6); err == nil {
		t.Fatal("k outside [1;5] must be rejected")
	}
	if _, err := repo.FindGraph(ctx, "/wiki/unknown", 1); err == nil {
		t.Fatal("unknown page must produce an error")
	}
}

func TestFindBacklinks(t *testing.T) {
	ctx := context.Background()
	repo := newGraphRepo(t)

	for _, p := range []domain.Page{
		page("/wiki/A", "A", "/wiki/C"),
		page("/wiki/B", "B", "/wiki/C"),
		page("/wiki/C", "C"),
	} {
		if _, err := repo.Insert(ctx, p); err != nil {
			t.Fatalf("insert %s: %v", p.URL, err)
		}
	}

	urls, err := repo.FindBacklinks(ctx, service.PageUUID("/wiki/C"))
	if err != nil {
		t.Fatalf("backlinks: %v", err)
	}
	if len(urls) != 2 {
		t.Fatalf("expected 2 backlinks, got %v", urls)
	}
}
