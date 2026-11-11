import { Waypoints } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useSearch } from '../api/hooks';
import { normalizeLang, parseSize } from '../components/SearchBar';
import { EmptyView, ErrorView, LoadingView } from '../components/StateViews';

import styles from './SearchPage.module.css';

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const lang = normalizeLang(searchParams.get('lang'));
  const size = parseSize(searchParams.get('size'));

  const { data, isPending, error, refetch } = useSearch(q, lang, size);

  if (q.trim() === '') {
    return (
      <EmptyView
        title="Start typing to search"
        hint="Results will appear here. Use the search box above."
      />
    );
  }

  if (isPending) {
    return <LoadingView label={`Searching for “${q}”…`} />;
  }

  if (error) {
    return (
      <ErrorView
        message={error instanceof ApiError ? error.message : 'Unexpected error'}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!data || data.items.length === 0) {
    return <EmptyView hint="Try a different query." title={`Nothing found for “${q}”`} />;
  }

  return (
    <div className={styles.page}>
      <p className={styles.meta}>
        {data.total} result{data.total === 1 ? '' : 's'} for “{q}”
      </p>
      <ul className={styles.results}>
        {data.items.map((item) => (
          <li key={item.uuid} className={styles.result}>
            <div className={styles.resultHeader}>
              <Link to={`/page/${item.uuid}`} className={styles.title}>
                {item.title}
              </Link>
              <Link
                to={`/graph/${item.uuid}`}
                className={styles.graphLink}
                aria-label={`Open graph for ${item.title}`}
                title="Open graph"
              >
                <Waypoints size={14} aria-hidden="true" />
              </Link>
            </div>
            <p className={styles.url}>{item.url}</p>
            {item.description ? <p className={styles.description}>{item.description}</p> : null}
            <p className={styles.resultFooter}>
              {item.author ? <span>{item.author}</span> : null}
              <span className={styles.score}>score {item.score.toFixed(2)}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
