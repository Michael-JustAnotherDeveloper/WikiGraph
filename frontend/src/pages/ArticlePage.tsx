import { ExternalLink, RefreshCw } from 'lucide-react';
import { useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useGraph, usePageUrl } from '../api/hooks';
import { BacklinksPanel } from '../components/BacklinksPanel';
import { ErrorView, LoadingView } from '../components/StateViews';

import styles from './ArticlePage.module.css';

export function ArticlePage() {
  const { uuid = '' } = useParams();

  const graph = useGraph(uuid, 1);
  const pageUrl = usePageUrl(uuid);

  const title =
    graph.data?.nodes.find((n) => n.uuid === uuid)?.title ??
    graph.data?.nodes.find((n) => n.url === uuid)?.title ??
    uuid;

  const presignedUrl = pageUrl.data?.url;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                if (presignedUrl) window.open(presignedUrl, '_blank', 'noopener,noreferrer');
              }}
              disabled={!presignedUrl}
              aria-label="Open article in a new tab"
            >
              <ExternalLink size={14} aria-hidden="true" />
              Open in new tab
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => void pageUrl.refetch()}
              disabled={pageUrl.isPending || pageUrl.isFetching}
              aria-label="Refresh article link"
            >
              <RefreshCw size={14} aria-hidden="true" />
              Refresh link
            </button>
          </div>
        </header>

        <div className={styles.frameWrap}>
          {pageUrl.isPending ? (
            <LoadingView label="Loading article…" />
          ) : pageUrl.error ? (
            <ErrorView
              title={
                pageUrl.error instanceof ApiError && pageUrl.error.status === 404
                  ? 'Article not found'
                  : 'Something went wrong'
              }
              message={
                pageUrl.error instanceof ApiError ? pageUrl.error.message : 'Unexpected error'
              }
              onRetry={() => void pageUrl.refetch()}
              retryLabel="Refresh link"
            />
          ) : presignedUrl ? (
            <iframe
              src={presignedUrl}
              title={title}
              sandbox="allow-scripts allow-same-origin"
              className={styles.frame}
            />
          ) : null}
        </div>
      </main>
      <BacklinksPanel id={uuid} />
    </div>
  );
}
