import { create } from 'zustand';

export type Theme = 'light' | 'dark';
export type Lang = 'ru' | 'en';

const THEME_KEY = 'wiki-graph:theme';
const LANG_KEY = 'wiki-graph:lang';

function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Язык берётся из локали браузера и дальше живёт как выбор пользователя. */
function initialLang(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored === 'ru' || stored === 'en') return stored;
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

interface Toast {
  id: number;
  message: string;
}

interface UiState {
  theme: Theme;
  lang: Lang;
  toasts: Toast[];
  toggleTheme: () => void;
  setLang: (lang: Lang) => void;
  notify: (message: string) => void;
  dismiss: (id: number) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: initialTheme(),
  lang: initialLang(),
  toasts: [],

  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    set({ theme: next });
  },

  setLang: (lang) => {
    localStorage.setItem(LANG_KEY, lang);
    set({ lang });
  },

  notify: (message) => {
    const id = Date.now() + Math.random();
    set({ toasts: [...get().toasts, { id, message }] });
    window.setTimeout(() => get().dismiss(id), 4000);
  },

  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));