import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { fetchRandom, search } from '../api/client';
import { useUiStore } from '../store/ui';

export function SearchPage() {
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState('');
  const lang = useUiStore((s) => s.lang);
  const notify = useUiStore((s) => s.notify);
  const navigate = useNavigate();

  const results = useQuery({
    queryKey: ['search', submitted, lang],
    queryFn: () => search(submitted, lang),
    enabled: submitted.trim().length > 0,
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(draft.trim());
  }

  async function openRandom() {
    try {
      const hit = await fetchRandom();
      navigate(`/graph/${hit.uuid}`);
    } catch {
      notify('Пока нечего показать — в индексе нет страниц');
    }
  }

  return (
    <>
      <div className="search-head">
        <h1>Найдите статью и посмотрите, с чем она связана</h1>
        <p>
          Поиск идёт по заголовку, автору и описанию. У каждой находки есть граф
          исходящих ссылок — по нему видно, куда статья ведёт дальше.
        </p>
      </div>

      <form className="glass search-bar" onSubmit={onSubmit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Например: графовые базы данных"
          aria-label="Поисковый запрос"
        />
        <button type="button" className="button-quiet" onClick={openRandom}>
          Случайная
        </button>
        <button type="submit" className="button-primary" disabled={draft.trim().length === 0}>
          Найти
        </button>
      </form>

      {submitted === '' && (
        <div className="glass state">
          <strong>Начните с запроса</strong>
          Язык переключается в шапке — он меняет, какие поля весят больше при
          ранжировании.
        </div>
      )}

      {results.isLoading && <div className="glass state">Ищем…</div>}

      {results.isError && (
        <div className="glass state">
          <strong>Поиск не ответил</strong>
          {(results.error as Error).message}
        </div>
      )}

      {results.data && results.data.length === 0 && (
        <div className="glass state">
          <strong>Ничего не нашлось</strong>
          Попробуйте другие слова или переключите язык.
        </div>
      )}

      {results.data && results.data.length > 0 && (
        <div className="results">
          {results.data.map((hit) => (
            <article className="glass result" key={hit.uuid}>
              <div className="result-body">
                <h2>{hit.title || hit.url}</h2>
                <div className="result-meta">
                  {hit.author ? `${hit.author} · ` : ''}
                  {hit.url}
                </div>
                {hit.description && <p>{hit.description}</p>}
              </div>
              <div className="result-actions">
                <div className="score">{hit.score.toFixed(2)}</div>
                <button
                  className="button-primary"
                  onClick={() => navigate(`/graph/${hit.uuid}`)}
                >
                  Показать граф
                </button>
                <button
                  className="button-quiet"
                  onClick={() => navigate(`/page/${hit.uuid}`)}
                >
                  Открыть
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}