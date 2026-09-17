package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/example/wiki-graph/backend/internal/config"
	"github.com/example/wiki-graph/backend/internal/httpapi"
	"github.com/example/wiki-graph/backend/internal/repo/blob"
	"github.com/example/wiki-graph/backend/internal/repo/elastic"
	"github.com/example/wiki-graph/backend/internal/repo/graph"
	"github.com/example/wiki-graph/backend/internal/service"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	esRepo, err := elastic.New(cfg)
	if err != nil {
		return err
	}
	fmt.Print(("\n\n\n"))
	graphRepo, err := graph.New(cfg)
	if err != nil {
		return err
	}
	defer graphRepo.Close(context.Background())

	blobRepo, err := blob.New(cfg)
	if err != nil {
		return err
	}

	// Схема создаётся на старте: индекс ES и ограничения Neo4j идемпотентны.
	initCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := esRepo.EnsureIndex(initCtx); err != nil {
		return err
	}
	if err := graphRepo.EnsureConstraints(initCtx); err != nil {
		return err
	}

	svc := service.New(esRepo, graphRepo, blobRepo, cfg.GraphMaxK)
	srv := &http.Server{
		Addr:              ":" + cfg.BackendPort,
		Handler:           httpapi.NewRouter(svc, cfg, log),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "port", cfg.BackendPort)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
