package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
)

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func MetricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		httpInFlight.Inc()
		defer httpInFlight.Dec()

		next.ServeHTTP(rec, r)

		routePat := chi.RouteContext(r.Context()).RoutePattern()
		if routePat == "" {
			routePat = "unmatched"
		}
		status := rec.status

		if status == 0 {
			status = http.StatusOK
		}

		labels := prometheus.Labels{
			"method": r.Method,
			"route":  routePat,
			"status": strconv.Itoa(status),
		}

		httpRequestsTotal.With(labels).Inc()
		httpRequestDuration.With(labels).Observe(time.Since(start).Seconds())
	})
}
