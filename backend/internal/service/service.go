package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/example/wiki-graph/backend/internal/domain"
)

// Репозитории описаны интерфейсами: сервис не зависит от конкретных клиентов,
// а тесты подставляют моки (в первую очередь S3).
type SearchRepo interface {
	Insert(ctx context.Context, page domain.Page) error
	Search(ctx context.Context, query, lang string, size int) ([]domain.SearchHit, error)
	Random(ctx context.Context) (domain.SearchHit, error)
	Ping(ctx context.Context) error
}

type GraphRepo interface {
	Insert(ctx context.Context, page domain.Page) (created bool, err error)
	FindGraph(ctx context.Context, id string, k int) (domain.GraphResult, error)
	FindBacklinks(ctx context.Context, id string) ([]string, error)
	Stats(ctx context.Context) (domain.Stats, error)
	Ping(ctx context.Context) error
}

type BlobRepo interface {
	Put(ctx context.Context, uuid string, content []byte, contentType string) error
	PresignedURL(ctx context.Context, uuid string, ttl time.Duration) (string, error)
	TTL() time.Duration
	Ping(ctx context.Context) error
}

type Service struct {
	search SearchRepo
	graph  GraphRepo
	blob   BlobRepo
	maxK   int
}

func New(search SearchRepo, graph GraphRepo, blob BlobRepo, maxK int) *Service {
	if maxK < 1 || maxK > 5 {
		maxK = 5
	}
	return &Service{search: search, graph: graph, blob: blob, maxK: maxK}
}

// pageNamespace фиксирует пространство имён для детерминированного UUID.
// Менять его нельзя: изменение переименует все страницы.
var pageNamespace = uuid.NameSpaceURL

// PageUUID считает UUIDv5 от url. Один и тот же url всегда даёт один и тот же
// uuid, поэтому повторная вставка попадает в те же ключи во всех трёх
// хранилищах и перезаписывает их.
func PageUUID(url string) string {
	return uuid.NewSHA1(pageNamespace, []byte(url)).String()
}

// InsertInput — payload internal-эндпоинта.
type InsertInput struct {
	URL         string
	Title       string
	Author      string
	Description string
	Content     []byte
	Links       []string
}

// InsertResult сообщает наружу, была страница создана или перезаписана.
type InsertResult struct {
	UUID    string
	Created bool
}

// StorageError указывает, на каком хранилище упала вставка.
type StorageError struct {
	Stage string
	Err   error
}

func (e *StorageError) Error() string { return fmt.Sprintf("%s: %v", e.Stage, e.Err) }
func (e *StorageError) Unwrap() error { return e.Err }

// Insert раскладывает один payload в три проекции: ES → Neo4j → S3.
//
// Операция идемпотентна на всех трёх шагах, поэтому при падении на любом из
// них достаточно повторить тот же запрос целиком: частично записанное
// состояние будет затёрто, а не заблокировано конфликтом.
func (s *Service) Insert(ctx context.Context, in InsertInput) (InsertResult, error) {
	url := strings.TrimSpace(in.URL)
	if url == "" {
		return InsertResult{}, fmt.Errorf("%w: url is required", domain.ErrInvalidArgument)
	}

	page := domain.Page{
		UUID:        PageUUID(url),
		URL:         url,
		Title:       in.Title,
		Author:      in.Author,
		Description: in.Description,
		Content:     in.Content,
		Links:       in.Links,
	}

	if err := s.search.Insert(ctx, page); err != nil {
		return InsertResult{}, &StorageError{Stage: "elasticsearch", Err: err}
	}
	created, err := s.graph.Insert(ctx, page)
	if err != nil {
		return InsertResult{}, &StorageError{Stage: "neo4j", Err: err}
	}
	if err := s.blob.Put(ctx, page.UUID, page.Content, ""); err != nil {
		return InsertResult{}, &StorageError{Stage: "s3", Err: err}
	}

	return InsertResult{UUID: page.UUID, Created: created}, nil
}

func (s *Service) Search(ctx context.Context, query, lang string, size int) ([]domain.SearchHit, error) {
	return s.search.Search(ctx, query, lang, size)
}

func (s *Service) Random(ctx context.Context) (domain.SearchHit, error) {
	return s.search.Random(ctx)
}

// Graph валидирует k по конфигу и границам [1;5] и отдаёт flat-словарь.
func (s *Service) Graph(ctx context.Context, id string, k int) (domain.GraphResult, error) {
	if k <= 0 {
		k = 1
	}
	if k > s.maxK {
		return domain.GraphResult{}, fmt.Errorf("%w: k must be in [1;%d]", domain.ErrInvalidArgument, s.maxK)
	}
	return s.graph.FindGraph(ctx, id, k)
}

func (s *Service) Backlinks(ctx context.Context, id string) ([]string, error) {
	return s.graph.FindBacklinks(ctx, id)
}

// PageURL выдаёт presigned-ссылку на HTML. Сам контент через бэкенд не идёт.
func (s *Service) PageURL(ctx context.Context, id string) (string, time.Duration, error) {
	if _, err := uuid.Parse(id); err != nil {
		return "", 0, fmt.Errorf("%w: uuid expected", domain.ErrInvalidArgument)
	}
	url, err := s.blob.PresignedURL(ctx, id, 0)
	if err != nil {
		return "", 0, err
	}
	return url, s.blob.TTL(), nil
}

func (s *Service) Stats(ctx context.Context) (domain.Stats, error) {
	return s.graph.Stats(ctx)
}

// Health опрашивает все три хранилища и возвращает статус по каждому.
func (s *Service) Health(ctx context.Context) (map[string]string, error) {
	checks := map[string]func(context.Context) error{
		"elasticsearch": s.search.Ping,
		"neo4j":         s.graph.Ping,
		"s3":            s.blob.Ping,
	}
	out := make(map[string]string, len(checks))
	var failed error
	for name, check := range checks {
		if err := check(ctx); err != nil {
			out[name] = "down: " + err.Error()
			failed = errors.Join(failed, fmt.Errorf("%s: %w", name, err))
			continue
		}
		out[name] = "ok"
	}
	return out, failed
}
