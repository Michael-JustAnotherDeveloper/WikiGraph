import { useEffect } from 'react';
import { Link, Route, Routes } from 'react-router-dom';

import { Toasts } from './components/Toasts';
import { ThemeToggle } from './components/ThemeToggle';
import { LangToggle } from './components/LangToggle';
import { GraphPage } from './pages/GraphPage';
import { PageViewer } from './pages/PageViewer';
import { SearchPage } from './pages/SearchPage';
import { useUiStore } from './store/ui';

export default function App() {
  const theme = useUiStore((s) => s.theme);

  // Тема живёт на <html>, чтобы её видели и CSS-переменные, и canvas графа.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Главная
        </Link>
        <div className="topbar-spacer" />
        <LangToggle />
        <ThemeToggle />
      </header>

      <main className="content">
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/graph/:id" element={<GraphPage />} />
          <Route path="/page/:uuid" element={<PageViewer />} />
          <Route
            path="*"
            element={
              <div className="glass state">
                <strong>Такой страницы нет</strong>
                Вернитесь к поиску и начните с запроса.
              </div>
            }
          />
        </Routes>
      </main>

      <Toasts />
    </div>
  );
}