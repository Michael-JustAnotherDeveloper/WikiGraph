package metrics

import (
	"context"
	"errors"
	"time"
)

func detectStatus(err error) string {
	status := "ok"
	switch {
	case err == nil:
	case errors.Is(err, context.Canceled):
		status = "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		status = "canceled"
	default:
		status = "error"
	}
	return status
}

func ObserveStorage(durationSeconds float64, stage string, err error) {
	status := detectStatus(err)
	StorageDuration.WithLabelValues(stage, status).Observe(durationSeconds)
}

func ObserveTransaction(startTime time.Time, err error) {
	status := detectStatus(err)
	InsertDuration.WithLabelValues(status).Observe(SinceSeconds(startTime))
}

func ObserveSlowestStage(stageDurations map[string]float64) {
	var slowest float64 = -1
	if len(stageDurations) == 0 {
		return
	}
	result := ""
	for stage := range stageDurations {
		if stageDurations[stage] > slowest {
			slowest = stageDurations[stage]
			result = stage
		}
	}
	SlowestStage.WithLabelValues(result).Inc()
}

func SinceSeconds(startTime time.Time) float64 {
	return time.Since(startTime).Seconds()
}
