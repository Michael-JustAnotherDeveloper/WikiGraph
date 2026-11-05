package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	httpRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total http requests",
		},
		[]string{"method", "route", "status"},
	)

	httpRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "http_duration_seconds",
			Help: "HTTP  requests latency",
		},
		[]string{"method", "route", "status"},
	)

	httpInFlight = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "http_requests_in_flight",
			Help: "Requests currently being process",
		},
	)

	InsertDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "internal_insert_duration",
			Help: "To detect all time of transaction",
		},
		[]string{"status"}, // ok|error|canceled; Todo: add invalid status
	)

	StorageDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "internal_storage_insert_duration",
			Help: "To detect bottlenecks in put/insert data into s3/neo4j/elastic",
		},
		[]string{"stage", "status"}, // stage: elasticsearch|neo4j|S3; status: ok|error|canceled
	)

	SlowestStage = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "internal_stage_total",
			Help: "Counts how often each stage was the slowest in a parallel Insert",
		},
		[]string{"stage"},
	)
)
