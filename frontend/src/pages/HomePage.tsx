import { useStats } from '../api/hooks';

import styles from './HomePage.module.css';

export function HomePage() {
  const { data } = useStats();

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>WikiGraph</h1>
        <p className={styles.subtitle}>
          A visual knowledge-base browser. Search articles, explore the graph of links around them,
          and read pages right here.
        </p>
      </section>
      <footer className={styles.footer}>
        {data ? (
          <p className={styles.stats}>
            {data.pages.toLocaleString()} pages · {data.stubs.toLocaleString()} stubs ·{' '}
            {data.edges.toLocaleString()} links
          </p>
        ) : null}
      </footer>
    </div>
  );
}
