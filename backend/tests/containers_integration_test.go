//go:build integration

package tests

import (
	"context"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	neo4jImage    = "neo4j:5.22"
	esImage       = "docker.elastic.co/elasticsearch/elasticsearch:8.17.0"
	neo4jPassword = "testpassword"
)

// startNeo4j поднимает Neo4j и возвращает bolt-URI.
// Security оставляем включённой — драйвер всё равно ходит с basic auth.
func startNeo4j(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        neo4jImage,
			ExposedPorts: []string{"7687/tcp", "7474/tcp"},
			Env: map[string]string{
				"NEO4J_AUTH":                         "neo4j/" + neo4jPassword,
				"NEO4J_server_memory_pagecache_size": "128M",
			},
			WaitingFor: wait.ForHTTP("/").
				WithPort("7474/tcp").
				WithStartupTimeout(3 * time.Minute),
		},
		Started: true,
	})
	if err != nil {
		t.Fatalf("start neo4j: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("neo4j host: %v", err)
	}
	port, err := container.MappedPort(ctx, "7687/tcp")
	if err != nil {
		t.Fatalf("neo4j port: %v", err)
	}
	return "bolt://" + host + ":" + port.Port()
}

// startElasticsearch поднимает одноузловой ES с выключенной security,
// чтобы тест не занимался сертификатами.
func startElasticsearch(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        esImage,
			ExposedPorts: []string{"9200/tcp"},
			Env: map[string]string{
				"discovery.type":         "single-node",
				"xpack.security.enabled": "false",
				"ES_JAVA_OPTS":           "-Xms512m -Xmx512m",
			},
			WaitingFor: wait.ForHTTP("/_cluster/health").
				WithPort("9200/tcp").
				WithStartupTimeout(5 * time.Minute),
		},
		Started: true,
	})
	if err != nil {
		t.Fatalf("start elasticsearch: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("es host: %v", err)
	}
	port, err := container.MappedPort(ctx, "9200/tcp")
	if err != nil {
		t.Fatalf("es port: %v", err)
	}
	return "http://" + host + ":" + port.Port()
}
