import { useUiStore } from '../store/ui';

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  return (
    <button
      className="pill"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
    >
      {theme === 'dark' ? '☾' : '☀'} {theme === 'dark' ? 'Тёмная' : 'Светлая'}
    </button>
  );
}