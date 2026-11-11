import { AlertTriangle, Inbox } from 'lucide-react';

import styles from './StateViews.module.css';

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={styles.container} role="status" aria-live="polite">
      <div className={styles.skeleton} aria-hidden="true">
        <div className={styles.skeletonLine} />
        <div className={styles.skeletonLine} />
        <div className={styles.skeletonLine} />
      </div>
      <p className={styles.label}>{label}</p>
    </div>
  );
}

export function EmptyView({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className={styles.container}>
      <Inbox className={styles.icon} size={24} strokeWidth={1.5} aria-hidden="true" />
      <p className={styles.title}>{title}</p>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

export function ErrorView({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Retry',
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className={styles.container} role="alert">
      <AlertTriangle className={styles.icon} size={24} strokeWidth={1.5} aria-hidden="true" />
      <p className={styles.title}>{title}</p>
      <p className={styles.hint}>{message}</p>
      {onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
