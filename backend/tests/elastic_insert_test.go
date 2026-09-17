package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/elastic/go-elasticsearch/v8"

	"github.com/example/wiki-graph/backend/internal/domain"
	"github.com/example/wiki-graph/backend/internal/repo/elastic"
)

// mockTransport перехватывает запросы клиента ES и запоминает тело документа.
type mockTransport struct {
	lastPath string
	lastBody []byte
}

func (m *mockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	m.lastPath = req.URL.Path
	if req.Body != nil {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		m.lastBody = body
	}
	resp := &http.Response{
		StatusCode: http.StatusCreated,
		Header:     http.Header{},
		Body:       io.NopCloser(strings.NewReader(`{"result":"created"}`)),
		Request:    req,
	}
	resp.Header.Set("Content-Type", "application/json")
	// Клиент v8 отказывается работать без этого заголовка.
	resp.Header.Set("X-Elastic-Product", "Elasticsearch")
	return resp, nil
}

func newMockedRepo(t *testing.T) (*elastic.Repo, *mockTransport) {
	t.Helper()
	tr := &mockTransport{}
	client, err := elasticsearch.NewClient(elasticsearch.Config{
		Addresses: []string{"http://localhost:9200"},
		Transport: tr,
	})
	if err != nil {
		t.Fatalf("new es client: %v", err)
	}
	return elastic.NewWithClient(client, "wiki_pages"), tr
}

func TestElasticsearchInsertPicksLanguageFields(t *testing.T) {
	cases := []struct {
		name        string
		page        domain.Page
		wantFilled  []string
		wantMissing []string
	}{
		{
			name: "русский payload",
			page: domain.Page{
				UUID:        "11111111-1111-1111-1111-111111111111",
				URL:         "/wiki/A",
				Title:       "Статья А",
				Author:      "Иван Иванов",
				Description: "Краткое описание статьи",
			},
			wantFilled:  []string{"title_ru", "author_ru", "description_ru"},
			wantMissing: []string{"title_en", "author_en", "description_en"},
		},
		{
			name: "английский payload",
			page: domain.Page{
				UUID:        "22222222-2222-2222-2222-222222222222",
				URL:         "/wiki/B",
				Title:       "Article B",
				Author:      "John Doe",
				Description: "Short description",
			},
			wantFilled:  []string{"title_en", "author_en", "description_en"},
			wantMissing: []string{"title_ru", "author_ru", "description_ru"},
		},
		{
			// Язык определяется по title; пустой title уводит решение
			// в description.
			name: "пустой title — язык берётся из description",
			page: domain.Page{
				UUID:        "33333333-3333-3333-3333-333333333333",
				URL:         "/wiki/C",
				Description: "Graph traversal explained",
			},
			wantFilled:  []string{"description_en"},
			wantMissing: []string{"description_ru", "title_ru"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo, tr := newMockedRepo(t)
			if err := repo.Insert(context.Background(), tc.page); err != nil {
				t.Fatalf("insert: %v", err)
			}

			// _id документа должен совпадать с uuid.
			if !strings.Contains(tr.lastPath, tc.page.UUID) {
				t.Fatalf("document id is missing from path %q", tr.lastPath)
			}

			var doc map[string]any
			if err := json.NewDecoder(bytes.NewReader(tr.lastBody)).Decode(&doc); err != nil {
				t.Fatalf("decode indexed document: %v", err)
			}
			for _, field := range tc.wantFilled {
				if v, ok := doc[field]; !ok || v == "" {
					t.Errorf("field %s must be filled, got %v", field, v)
				}
			}
			for _, field := range tc.wantMissing {
				if v, ok := doc[field]; ok && v != "" {
					t.Errorf("field %s must be empty, got %v", field, v)
				}
			}
			if doc["url"] != tc.page.URL {
				t.Errorf("url = %v, want %v", doc["url"], tc.page.URL)
			}
		})
	}
}
