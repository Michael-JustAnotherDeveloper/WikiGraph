import { Link } from 'react-router-dom';

import { useBacklinks } from '../api/hooks';
import { ApiError } from '../api/client';

import styles from './BacklinksPanel.module.css';

export function BacklinksPanel({ id }: { id: string }) {
  const { data, isPending, error, refetch } = useBacklinks(id);

  return (
    <aside className={styles.panel} aria-label="Backlinks">
      <h2 className={styles.heading}>Backlinks</h2>
      {isPending ? <p className={styles.note}>Loading…</p> : null}
      {error ? (
        <div className={styles.note}>
          <p>{error instanceof ApiError ? error.message : 'Failed to load backlinks'}</p>
          <button type="button" className={styles.retry} onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      ) : null}
      {data ? (
        data.items.length === 0 ? (
          <p className={styles.note}>No backlinks yet.</p>
        ) : (
          <ul className={styles.list}>
            {data.items.map((item) => (
              <li key={item.url} className={styles.item}>
                <Link
                  to={item.uuid ? `/page/${item.uuid}` : `/graph/${encodeURIComponent(item.url)}`}
                  className={styles.link}
                >
                  {item.title || item.url}
                </Link>
                <span className={styles.url}>{item.url}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </aside>
  );
}
