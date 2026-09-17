//go:build integration

package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/example/wiki-graph/backend/internal/config"
	"github.com/example/wiki-graph/backend/internal/domain"
	"github.com/example/wiki-graph/backend/internal/httpapi"
	"github.com/example/wiki-graph/backend/internal/repo/elastic"
	"github.com/example/wiki-graph/backend/internal/repo/graph"
	"github.com/example/wiki-graph/backend/internal/service"
)

const internalToken = "test-internal-token"

// mockBlob заменяет S3: держит объекты в памяти и выдаёт фиктивный
// presigned URL. Проверяется контракт, а не сам AWS SDK.
type mockBlob struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func newMockBlob() *mockBlob { return &mockBlob{objects: map[string][]byte{}} }

func (m *mockBlob) Put(_ context.Context, uuid string, content []byte, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[uuid] = content
	return nil
}

func (m *mockBlob) PresignedURL(_ context.Context, uuid string, _ time.Duration) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.objects[uuid]; !ok {
		return "", domain.ErrNotFound
	}
	return fmt.Sprintf("https://s3.example.test/wiki-content/%s?X-Amz-Signature=stub", uuid), nil
}

func (m *mockBlob) TTL() time.Duration         { return 15 * time.Minute }
func (m *mockBlob) Ping(context.Context) error { return nil }
func (m *mockBlob) get(uuid string) ([]byte, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.objects[uuid]
	return v, ok
}

func newTestServer(t *testing.T) (*httptest.Server, *mockBlob) {
	t.Helper()
	ctx := context.Background()

	cfg := &config.Config{
		InternalToken: internalToken,
		GraphMaxK:     5,
		ESURL:         startElasticsearch(t),
		ESIndex:       "wiki_pages_test",
		Neo4jURI:      startNeo4j(t),
		Neo4jUser:     "neo4j",
		Neo4jPassword: neo4jPassword,
		CORSOrigin:    "*",
	}

	esRepo, err := elastic.New(cfg)
	if err != nil {
		t.Fatalf("es repo: %v", err)
	}
	if err := esRepo.EnsureIndex(ctx); err != nil {
		t.Fatalf("ensure index: %v", err)
	}

	graphRepo, err := graph.New(cfg)
	if err != nil {
		t.Fatalf("graph repo: %v", err)
	}
	t.Cleanup(func() { _ = graphRepo.Close(context.Background()) })
	if err := graphRepo.EnsureConstraints(ctx); err != nil {
		t.Fatalf("constraints: %v", err)
	}

	blob := newMockBlob()
	svc := service.New(esRepo, graphRepo, blob, cfg.GraphMaxK)
	srv := httptest.NewServer(httpapi.NewRouter(svc, cfg, slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(srv.Close)

	return srv, blob
}

func insertPage(t *testing.T, srv *httptest.Server, token string, payload map[string]any) (int, map[string]any) {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/internal/pages", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", token)

	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()

	var decoded map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&decoded)
	return resp.StatusCode, decoded
}

func getJSON(t *testing.T, srv *httptest.Server, path string, out any) int {
	t.Helper()
	resp, err := srv.Client().Get(srv.URL + path)
	if err != nil {
		t.Fatalf("get %s: %v", path, err)
	}
	defer resp.Body.Close()
	if out != nil {
		_ = json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

// Полный цикл: вставка через internal-эндпоинт должна разложиться во все три
// хранилища так, чтобы страница нашлась поиском, попала в граф и получила
// presigned-ссылку.
func TestInsertPageFullCycle(t *testing.T) {
	srv, blob := newTestServer(t)

	status, body := insertPage(t, srv, internalToken, map[string]any{
		"url":         "/wiki/A",
		"title":       "Статья А",
		"author":      "Иван Иванов",
		"description": "Краткое описание статьи",
		"content":     "<html><body>А</body></html>",
		"links":       []string{"/wiki/B"},
	})
	if status != http.StatusCreated {
		t.Fatalf("insert status = %d, want 201; body=%v", status, body)
	}

	uuid, _ := body["uuid"].(string)
	if uuid != service.PageUUID("/wiki/A") {
		t.Fatalf("uuid = %q, want deterministic %q", uuid, service.PageUUID("/wiki/A"))
	}

	// S3.
	content, ok := blob.get(uuid)
	if !ok || len(content) == 0 {
		t.Fatal("content did not reach the object storage")
	}

	// Elasticsearch.
	var searchResp struct {
		Hits []domain.SearchHit `json:"hits"`
	}
	if code := getJSON(t, srv, "/api/search?q=Статья&lang=ru", &searchResp); code != http.StatusOK {
		t.Fatalf("search status = %d", code)
	}
	if len(searchResp.Hits) == 0 || searchResp.Hits[0].UUID != uuid {
		t.Fatalf("page is not searchable: %+v", searchResp.Hits)
	}

	// Neo4j.
	var graphResp domain.GraphResult
	if code := getJSON(t, srv, "/api/graph/"+uuid+"?k=1", &graphResp); code != http.StatusOK {
		t.Fatalf("graph status = %d", code)
	}
	if len(graphResp.Nodes) != 2 || len(graphResp.Edges) != 1 {
		t.Fatalf("unexpected graph: %+v", graphResp)
	}
	if !hasEdge(graphResp, "/wiki/A", "/wiki/B") {
		t.Fatal("edge A -> B is missing")
	}
	if nodeByURL(t, graphResp, "/wiki/B").Resolved {
		t.Fatal("/wiki/B must be an unresolved stub")
	}

	// Presigned URL.
	var urlResp struct {
		URL string `json:"url"`
	}
	if code := getJSON(t, srv, "/api/page/"+uuid+"/url", &urlResp); code != http.StatusOK {
		t.Fatalf("page url status = %d", code)
	}
	if urlResp.URL == "" {
		t.Fatal("presigned url is empty")
	}

	// Backlinks.
	var backlinks struct {
		Backlinks []string `json:"backlinks"`
	}
	if code := getJSON(t, srv, "/api/backlinks/"+service.PageUUID("/wiki/B"), &backlinks); code != http.StatusOK {
		t.Fatalf("backlinks status = %d", code)
	}
}

// Повторная вставка того же url перезаписывает данные во всех трёх
// хранилищах и отвечает 200 вместо 201.
func TestInsertPageOverwrite(t *testing.T) {
	srv, blob := newTestServer(t)

	payload := map[string]any{
		"url":         "/wiki/A",
		"title":       "Старый заголовок",
		"description": "Старое описание",
		"content":     "<html>old</html>",
		"links":       []string{"/wiki/B"},
	}
	if status, body := insertPage(t, srv, internalToken, payload); status != http.StatusCreated {
		t.Fatalf("first insert status = %d; body=%v", status, body)
	}

	payload["title"] = "Новый заголовок"
	payload["content"] = "<html>new</html>"
	payload["links"] = []string{"/wiki/C"}

	status, body := insertPage(t, srv, internalToken, payload)
	if status != http.StatusOK {
		t.Fatalf("second insert status = %d, want 200; body=%v", status, body)
	}
	uuid, _ := body["uuid"].(string)

	if content, _ := blob.get(uuid); string(content) != "<html>new</html>" {
		t.Fatalf("content was not overwritten: %q", content)
	}

	var graphResp domain.GraphResult
	if code := getJSON(t, srv, "/api/graph/"+uuid+"?k=1", &graphResp); code != http.StatusOK {
		t.Fatalf("graph status = %d", code)
	}
	if !hasEdge(graphResp, "/wiki/A", "/wiki/C") || hasEdge(graphResp, "/wiki/A", "/wiki/B") {
		t.Fatalf("edges were not reconciled: %+v", graphResp.Edges)
	}

	var searchResp struct {
		Hits []domain.SearchHit `json:"hits"`
	}
	if code := getJSON(t, srv, "/api/search?q=Новый&lang=ru", &searchResp); code != http.StatusOK {
		t.Fatalf("search status = %d", code)
	}
	if len(searchResp.Hits) != 1 || searchResp.Hits[0].Title != "Новый заголовок" {
		t.Fatalf("search index was not overwritten: %+v", searchResp.Hits)
	}
}

func TestInternalEndpointRequiresToken(t *testing.T) {
	srv, _ := newTestServer(t)

	status, _ := insertPage(t, srv, "wrong-token", map[string]any{"url": "/wiki/A"})
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", status)
	}

	status, _ = insertPage(t, srv, internalToken, map[string]any{"title": "без url"})
	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", status)
	}
}
