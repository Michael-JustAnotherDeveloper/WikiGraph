package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/example/wiki-graph/backend/internal/config"
	"github.com/example/wiki-graph/backend/internal/domain"
	"github.com/example/wiki-graph/backend/internal/service"
)

type API struct {
	svc *service.Service
	cfg *config.Config
	log *slog.Logger
}

func NewRouter(svc *service.Service, cfg *config.Config, log *slog.Logger) http.Handler {
	api := &API{svc: svc, cfg: cfg, log: log}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{cfg.CORSOrigin},
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowedHeaders: []string{"Content-Type", "X-Internal-Token"},
	}))

	r.Get("/health", api.health)
	r.Get("/stats", api.stats)

	r.Route("/api", func(r chi.Router) {
		r.Get("/search", api.search)
		r.Get("/graph/{id}", api.graph)
		r.Get("/page/{uuid}/url", api.pageURL)
		r.Get("/backlinks/{id}", api.backlinks)
		r.Get("/random", api.random)
	})

	r.Route("/internal", func(r chi.Router) {
		r.Use(api.requireInternalToken)
		r.Post("/pages", api.insertPage)
	})

	return r
}

// requireInternalToken закрывает запись. Сравнение постоянное по времени.
func (a *API) requireInternalToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get("X-Internal-Token")
		want := a.cfg.InternalToken
		if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			writeError(w, http.StatusUnauthorized, "invalid internal token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type insertRequest struct {
	URL         string   `json:"url"`
	Title       string   `json:"title"`
	Author      string   `json:"author"`
	Description string   `json:"description"`
	Content     string   `json:"content"`
	Links       []string `json:"links"`
}

// insertPage — единственная точка записи в систему.
// 201 — страница создана, 200 — существующая перезаписана.
func (a *API) insertPage(w http.ResponseWriter, r *http.Request) {
	var req insertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "malformed json: "+err.Error())
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}

	res, err := a.svc.Insert(r.Context(), service.InsertInput{
		URL:         req.URL,
		Title:       req.Title,
		Author:      req.Author,
		Description: req.Description,
		Content:     []byte(req.Content),
		Links:       req.Links,
	})
	if err != nil {
		var storageErr *service.StorageError
		switch {
		case errors.Is(err, domain.ErrInvalidArgument):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.As(err, &storageErr):
			a.log.Error("insert failed", "stage", storageErr.Stage, "url", req.URL, "err", storageErr.Err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{
				"error": "storage failure",
				"stage": storageErr.Stage,
				"hint":  "операция идемпотентна, запрос можно повторить целиком",
			})
		default:
			a.log.Error("insert failed", "url", req.URL, "err", err)
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	status := http.StatusOK
	if res.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{"uuid": res.UUID, "created": res.Created})
}

func (a *API) search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	lang := r.URL.Query().Get("lang")
	size, _ := strconv.Atoi(r.URL.Query().Get("size"))

	hits, err := a.svc.Search(r.Context(), q, lang, size)
	if err != nil {
		a.log.Error("search failed", "q", q, "err", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hits": hits})
}

func (a *API) graph(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	k, err := strconv.Atoi(r.URL.Query().Get("k"))
	if err != nil {
		k = 1
	}

	res, err := a.svc.Graph(r.Context(), id, k)
	if err != nil {
		a.writeDomainError(w, err, "graph")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *API) pageURL(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "uuid")
	url, ttl, err := a.svc.PageURL(r.Context(), id)
	if err != nil {
		a.writeDomainError(w, err, "page url")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"url":        url,
		"expires_in": int(ttl.Seconds()),
		"expires_at": time.Now().Add(ttl).UTC().Format(time.RFC3339),
	})
}

func (a *API) backlinks(w http.ResponseWriter, r *http.Request) {
	urls, err := a.svc.Backlinks(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		a.writeDomainError(w, err, "backlinks")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"backlinks": urls})
}

func (a *API) random(w http.ResponseWriter, r *http.Request) {
	hit, err := a.svc.Random(r.Context())
	if err != nil {
		a.writeDomainError(w, err, "random")
		return
	}
	writeJSON(w, http.StatusOK, hit)
}

func (a *API) stats(w http.ResponseWriter, r *http.Request) {
	stats, err := a.svc.Stats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// health опрашивает все три хранилища; 503, если хотя бы одно недоступно.
func (a *API) health(w http.ResponseWriter, r *http.Request) {
	checks, err := a.svc.Health(r.Context())
	status := http.StatusOK
	overall := "ok"
	if err != nil {
		status = http.StatusServiceUnavailable
		overall = "degraded"
	}
	writeJSON(w, status, map[string]any{"status": overall, "checks": checks})
}

func (a *API) writeDomainError(w http.ResponseWriter, err error, op string) {
	switch {
	case errors.Is(err, domain.ErrInvalidArgument):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		a.log.Error(op+" failed", "err", err)
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
