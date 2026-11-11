import { useSearchParams, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { clampK, useGraph } from '../api/hooks';
import { Graph } from '../components/Graph';
import { EmptyView, ErrorView, LoadingView } from '../components/StateViews';

import styles from './GraphPage.module.css';

export function GraphPage() {
  const { uuidOrUrl = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const k = clampK(Number(searchParams.get('k') ?? '1'));

  const { data, isPending, error, refetch } = useGraph(uuidOrUrl, k);

  const handleKChange = (next: number) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('k', String(clampK(next)));
        return params;
      },
      { replace: true },
    );
  };

  const centerTitle = data?.nodes.find((n) => n.uuid === uuidOrUrl || n.url === uuidOrUrl)?.title;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{centerTitle ?? 'Graph'}</h1>
        {centerTitle ? <p className={styles.subtitle}>{uuidOrUrl}</p> : null}
      </header>

      <div className={styles.graph}>
        {isPending ? (
          <LoadingView label="Building graph…" />
        ) : error ? (
          <ErrorView
            message={error instanceof ApiError ? error.message : 'Unexpected error'}
            onRetry={() => void refetch()}
          />
        ) : !data || data.nodes.length === 0 ? (
          <EmptyView title="No links found" hint="This page has no known neighbours." />
        ) : (
          <Graph data={data} k={k} centerId={uuidOrUrl} onKChange={handleKChange} />
        )}
      </div>
    </div>
  );
}
