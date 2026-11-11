import { useHealth } from '../api/hooks';
import { ApiError } from '../api/client';

import styles from './HealthBadge.module.css';

const SERVICES: Array<{ key: 'elasticsearch' | 'neo4j' | 's3'; label: string }> = [
  { key: 'elasticsearch', label: 'Elasticsearch' },
  { key: 'neo4j', label: 'Neo4j' },
  { key: 's3', label: 'S3' },
];

export function HealthBadge() {
  const { data, error, isPending } = useHealth();

  let status: 'ok' | 'degraded' | 'unknown' = 'unknown';
  if (error) {
    status = 'degraded';
  } else if (data) {
    status = Object.values(data).every((v) => v === 'ok') ? 'ok' : 'degraded';
  }

  const tooltip =
    status === 'degraded'
      ? error instanceof ApiError
        ? `Degraded: ${error.message}`
        : data
          ? SERVICES.filter((s) => data[s.key] !== 'ok')
              .map((s) => `${s.label}: down`)
              .join(', ')
          : 'Degraded'
      : status === 'ok'
        ? 'All systems operational'
        : 'Checking…';

  return (
    <span className={styles.wrapper}>
      <span
        className={styles.dot}
        data-status={status}
        role="status"
        aria-label={tooltip}
        title={isPending ? undefined : tooltip}
        tabIndex={0}
      />
      <span className={styles.tooltip} role="tooltip">
        {tooltip}
      </span>
    </span>
  );
}
