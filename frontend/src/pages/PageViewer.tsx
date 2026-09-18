import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { fetchPageURL } from '../api/client';

export function PageViewer() {
  const { uuid = '' } = useParams();

  // Ссылка временная, поэтому её не кешируем дольше срока жизни.
  const page = useQuery({
    queryKey: ['page-url', uuid],
    queryFn: () => fetchPageURL(uuid),
    staleTime: 0,
  });

  if (page.isLoading) {
    return <div className="glass state">Получаем ссылку на страницу…</div>;
  }

  if (page.isError || !page.data) {
    return (
      <div className="glass state">
        <strong>Страница недоступна</strong>
        {(page.error as Error | undefined)?.message ?? 'Хранилище не отдало ссылку.'}
      </div>
    );
  }

  const expires = new Date(page.data.expires_at);

  return (
    <div className="glass viewer">
      <div className="viewer-bar">
        <Link to={`/graph/${uuid}`} className="button-quiet">
          К графу
        </Link>
        <span>
          Ссылка действует до {expires.toLocaleTimeString()}
        </span>
        <div className="topbar-spacer" />
        <a
          className="pill"
          href={page.data.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          Открыть в новой вкладке
        </a>
      </div>
      <iframe src={page.data.url} title="Содержимое страницы" sandbox="allow-same-origin" />
    </div>
  );
}