import { useUiStore } from '../store/ui';

/** Язык уходит в /api/search и меняет бустеры полей на стороне ES. */
export function LangToggle() {
  const lang = useUiStore((s) => s.lang);
  const setLang = useUiStore((s) => s.setLang);

  return (
    <div className="segmented" role="group" aria-label="Язык поиска">
      <button aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>
        Рус
      </button>
      <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
        Eng
      </button>
    </div>
  );
}