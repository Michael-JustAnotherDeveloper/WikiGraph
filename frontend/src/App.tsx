import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Header } from './components/Header';
import { ArticlePage } from './pages/ArticlePage';
import { GraphPage } from './pages/GraphPage';
import { HomePage } from './pages/HomePage';
import { RandomPage } from './pages/RandomPage';
import { SearchPage } from './pages/SearchPage';

import styles from './App.module.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className={styles.app}>
          <Header />
          <main className={styles.main}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/graph/:uuidOrUrl" element={<GraphPage />} />
              <Route path="/page/:uuid" element={<ArticlePage />} />
              <Route path="/random" element={<RandomPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
