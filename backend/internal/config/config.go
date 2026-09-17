package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	BackendPort   string
	InternalToken string
	GraphMaxK     int

	ESURL      string
	ESIndex    string
	ESUsername string
	ESPassword string

	Neo4jURI      string
	Neo4jUser     string
	Neo4jPassword string

	S3Endpoint     string
	S3Region       string
	S3Bucket       string
	S3AccessKey    string
	S3SecretKey    string
	S3PresignedTTL time.Duration

	CORSOrigin string
}

// Load читает конфигурацию из переменных окружения.
// Обязательные переменные перечислены в .env.example; при их отсутствии
// возвращается ошибка, чтобы сервис не стартовал в полуживом состоянии.
func Load() (*Config, error) {
	cfg := &Config{
		BackendPort:   env("BACKEND_PORT", "8080"),
		InternalToken: os.Getenv("INTERNAL_TOKEN"),
		ESURL:         env("ES_URL", "http://localhost:9200"),
		ESIndex:       env("ES_INDEX", "wiki_pages"),
		ESUsername:    os.Getenv("ES_USERNAME"),
		ESPassword:    os.Getenv("ES_PASSWORD"),
		Neo4jURI:      env("NEO4J_URI", "bolt://localhost:7687"),
		Neo4jUser:     env("NEO4J_USER", "neo4j"),
		Neo4jPassword: os.Getenv("NEO4J_PASSWORD"),
		S3Endpoint:    os.Getenv("S3_ENDPOINT"),
		S3Region:      env("S3_REGION", "ru-1"),
		S3Bucket:      os.Getenv("S3_BUCKET"),
		S3AccessKey:   os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:   os.Getenv("S3_SECRET_KEY"),
		CORSOrigin:    env("CORS_ORIGIN", "*"),
	}

	k, err := strconv.Atoi(env("GRAPH_MAX_K", "5"))
	if err != nil || k < 1 {
		return nil, fmt.Errorf("GRAPH_MAX_K must be a positive integer")
	}
	cfg.GraphMaxK = k

	ttl, err := time.ParseDuration(env("S3_PRESIGNED_TTL", "15m"))
	if err != nil {
		return nil, fmt.Errorf("S3_PRESIGNED_TTL: %w", err)
	}
	cfg.S3PresignedTTL = ttl

	required := map[string]string{
		"INTERNAL_TOKEN": cfg.InternalToken,
		"NEO4J_PASSWORD": cfg.Neo4jPassword,
		"S3_ENDPOINT":    cfg.S3Endpoint,
		"S3_BUCKET":      cfg.S3Bucket,
		"S3_ACCESS_KEY":  cfg.S3AccessKey,
		"S3_SECRET_KEY":  cfg.S3SecretKey,
	}
	for name, value := range required {
		if value == "" {
			return nil, fmt.Errorf("%s is required", name)
		}
	}

	return cfg, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
