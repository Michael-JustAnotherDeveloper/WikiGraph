import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import type { Lang } from '../api/types';

import styles from './SearchBar.module.css';

const COMMIT_DEBOUNCE_MS = 300;
const SIZES = [10, 20, 50];

export function browserDefaultLang(): Lang {
  if (typeof navigator === 'undefined' || typeof navigator.language !== 'string') {
    return 'ru';
  }
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'ru';
}

export function normalizeLang(raw: string | null): Lang {
  return raw === 'en' || raw === 'ru' ? raw : browserDefaultLang();
}

export function parseSize(raw: string | null): number {
  if (raw === null) return 20;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? Math.round(n) : 20;
}

export function SearchBar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const q = searchParams.get('q') ?? '';
  const lang = normalizeLang(searchParams.get('lang'));
  const size = parseSize(searchParams.get('size'));

  const [inputValue, setInputValue] = useState(q);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setInputValue(q);
  }, [q]);

  const commit = (next: { q?: string; lang?: Lang; size?: number }) => {
    const params = new URLSearchParams(searchParams);
    if (next.q !== undefined) {
      if (next.q === '') {
        params.delete('q');
      } else {
        params.set('q', next.q);
      }
    }
    if (next.lang !== undefined) params.set('lang', next.lang);
    if (next.size !== undefined) params.set('size', String(next.size));

    if (params.toString() === searchParams.toString()) return;

    if (location.pathname === '/search') {
      setSearchParams(params, { replace: true });
    } else {
      navigate(`/search?${params.toString()}`);
    }
  };

  // Latest-commit ref lets the debounce effect call commit without re-arming
  // the timer on every param change.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (inputValue === q) return;
    timerRef.current = setTimeout(() => commitRef.current({ q: inputValue }), COMMIT_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [inputValue, q]);

  const flush = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    commit({ q: inputValue });
  };

  return (
    <form
      className={styles.bar}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        flush();
      }}
    >
      <div className={styles.inputWrapper}>
        <Search className={styles.inputIcon} size={16} aria-hidden="true" />
        <input
          type="search"
          className={styles.input}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') flush();
          }}
          placeholder="Search articles…"
          aria-label="Search articles"
        />
      </div>

      <div className={styles.langSwitch} role="group" aria-label="Language">
        {(['ru', 'en'] as const).map((l) => (
          <button
            key={l}
            type="button"
            className={styles.langButton}
            data-active={lang === l}
            aria-pressed={lang === l}
            onClick={() => commit({ lang: l })}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <label className={styles.sizeField}>
        <span className="visually-hidden">Results per page</span>
        <select
          className={styles.sizeSelect}
          value={size}
          onChange={(e) => commit({ size: Number(e.target.value) })}
          aria-label="Results per page"
        >
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
