package elastic

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/elastic/go-elasticsearch/v8"
	"github.com/elastic/go-elasticsearch/v8/esapi"

	"github.com/example/wiki-graph/backend/internal/config"
	"github.com/example/wiki-graph/backend/internal/domain"
	"github.com/example/wiki-graph/backend/internal/lang"
)

//go:embed mapping.json
var mappingJSON []byte

// Repo — проекция Page в поисковый индекс. Единственное место в системе,
// которое знает о языке.
type Repo struct {
	es    *elasticsearch.Client
	index string
}

func New(cfg *config.Config) (*Repo, error) {
	client, err := elasticsearch.NewClient(elasticsearch.Config{
		Addresses: []string{cfg.ESURL},
		Username:  cfg.ESUsername,
		Password:  cfg.ESPassword,
	})
	if err != nil {
		return nil, fmt.Errorf("elasticsearch client: %w", err)
	}
	return &Repo{es: client, index: cfg.ESIndex}, nil
}

// NewWithClient используется в тестах с подменённым транспортом.
func NewWithClient(client *elasticsearch.Client, index string) *Repo {
	return &Repo{es: client, index: index}
}

// EnsureIndex создаёт индекс с маппингом из mapping.json, если его ещё нет.
func (r *Repo) EnsureIndex(ctx context.Context) error {
	exists, err := r.es.Indices.Exists([]string{r.index}, r.es.Indices.Exists.WithContext(ctx))
	if err != nil {
		return fmt.Errorf("index exists: %w", err)
	}
	defer exists.Body.Close()
	if exists.StatusCode == http.StatusOK {
		return nil
	}

	var mapping map[string]any
	if err := json.Unmarshal(mappingJSON, &mapping); err != nil {
		return fmt.Errorf("parse mapping.json: %w", err)
	}
	body, err := json.Marshal(map[string]any{"mappings": mapping})
	if err != nil {
		return err
	}

	res, err := r.es.Indices.Create(r.index,
		r.es.Indices.Create.WithBody(bytes.NewReader(body)),
		r.es.Indices.Create.WithContext(ctx),
	)
	if err != nil {
		return fmt.Errorf("create index: %w", err)
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("create index: %s", errorBody(res))
	}
	return nil
}

// Insert кладёт документ целиком под _id == uuid. Полный index (а не update)
// выбран намеренно: при перезаписи страницы язык заголовка мог смениться,
// и частичный апдейт оставил бы в документе поля прежнего языка.
func (r *Repo) Insert(ctx context.Context, page domain.Page) error {
	l := lang.Detect(page.Title, page.Description)

	doc := map[string]any{
		"uuid": page.UUID,
		"url":  page.URL,
	}
	doc["title_"+l] = page.Title
	doc["author_"+l] = page.Author
	doc["description_"+l] = page.Description

	body, err := json.Marshal(doc)
	if err != nil {
		return err
	}

	res, err := r.es.Index(r.index, bytes.NewReader(body),
		r.es.Index.WithDocumentID(page.UUID),
		r.es.Index.WithRefresh("wait_for"),
		r.es.Index.WithContext(ctx),
	)
	if err != nil {
		return fmt.Errorf("es index: %w", err)
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es index: %s", errorBody(res))
	}
	return nil
}

// fieldsFor возвращает список полей с бустерами: родной язык запроса весит
// больше, чужой остаётся в выдаче с пониженным весом.
func fieldsFor(l string) []string {
	if l == lang.EN {
		return []string{
			"title_en^3.0", "author_en^2.0", "description_en^1.0",
			"title_ru^1.0", "author_ru^0.5", "description_ru^0.25",
		}
	}
	return []string{
		"title_ru^3.0", "author_ru^2.0", "description_ru^1.0",
		"title_en^1.0", "author_en^0.5", "description_en^0.25",
	}
}

// Search выполняет мультиязычный поиск. Если lang пуст, язык запроса
// определяется эвристикой по самому запросу.
func (r *Repo) Search(ctx context.Context, query string, l string, size int) ([]domain.SearchHit, error) {
	if strings.TrimSpace(query) == "" {
		return []domain.SearchHit{}, nil
	}
	if l == "" {
		l = lang.Detect(query)
	} else {
		l = lang.Normalize(l)
	}
	if size <= 0 || size > 50 {
		size = 20
	}

	body, err := json.Marshal(map[string]any{
		"size": size,
		"query": map[string]any{
			"multi_match": map[string]any{
				"query":  query,
				"fields": fieldsFor(l),
				"type":   "best_fields",
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return r.runSearch(ctx, body)
}

// Random возвращает одну случайную страницу.
func (r *Repo) Random(ctx context.Context) (domain.SearchHit, error) {
	body, err := json.Marshal(map[string]any{
		"size": 1,
		"query": map[string]any{
			"function_score": map[string]any{
				"query":        map[string]any{"match_all": map[string]any{}},
				"random_score": map[string]any{},
			},
		},
	})
	if err != nil {
		return domain.SearchHit{}, err
	}
	hits, err := r.runSearch(ctx, body)
	if err != nil {
		return domain.SearchHit{}, err
	}
	if len(hits) == 0 {
		return domain.SearchHit{}, domain.ErrNotFound
	}
	return hits[0], nil
}

func (r *Repo) Ping(ctx context.Context) error {
	res, err := r.es.Ping(r.es.Ping.WithContext(ctx))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es ping: %s", res.Status())
	}
	return nil
}

type searchResponse struct {
	Hits struct {
		Hits []struct {
			ID     string          `json:"_id"`
			Score  float64         `json:"_score"`
			Source json.RawMessage `json:"_source"`
		} `json:"hits"`
	} `json:"hits"`
}

type source struct {
	UUID          string `json:"uuid"`
	URL           string `json:"url"`
	TitleRU       string `json:"title_ru"`
	AuthorRU      string `json:"author_ru"`
	DescriptionRU string `json:"description_ru"`
	TitleEN       string `json:"title_en"`
	AuthorEN      string `json:"author_en"`
	DescriptionEN string `json:"description_en"`
}

func (r *Repo) runSearch(ctx context.Context, body []byte) ([]domain.SearchHit, error) {
	res, err := r.es.Search(
		r.es.Search.WithIndex(r.index),
		r.es.Search.WithBody(bytes.NewReader(body)),
		r.es.Search.WithContext(ctx),
	)
	if err != nil {
		return nil, fmt.Errorf("es search: %w", err)
	}
	defer res.Body.Close()
	if res.IsError() {
		return nil, fmt.Errorf("es search: %s", errorBody(res))
	}

	var parsed searchResponse
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode search response: %w", err)
	}

	out := make([]domain.SearchHit, 0, len(parsed.Hits.Hits))
	for _, h := range parsed.Hits.Hits {
		var src source
		if err := json.Unmarshal(h.Source, &src); err != nil {
			return nil, fmt.Errorf("decode _source: %w", err)
		}
		uuid := src.UUID
		if uuid == "" {
			uuid = h.ID
		}
		// Наружу отдаётся один набор полей: заполнен всегда ровно один язык.
		out = append(out, domain.SearchHit{
			UUID:        uuid,
			URL:         src.URL,
			Title:       firstNonEmpty(src.TitleRU, src.TitleEN),
			Author:      firstNonEmpty(src.AuthorRU, src.AuthorEN),
			Description: firstNonEmpty(src.DescriptionRU, src.DescriptionEN),
			Score:       h.Score,
		})
	}
	return out, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func errorBody(res *esapi.Response) string {
	b, err := io.ReadAll(res.Body)
	if err != nil {
		return res.Status()
	}
	return res.Status() + " " + string(b)
}
