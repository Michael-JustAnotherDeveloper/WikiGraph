# TODO — WikiGraph Frontend

Вопросы по API-контрактам (расхождения реального бэкенда с замороженной спекой
Agents.md §7). Фронтенд принимает ОБЕ формы и нормализует их в спеко-типы
(`src/api/types.ts`), поэтому приложение работает и сейчас. После правки
бэкенда фолбэки можно удалить. Тег @backend

## Q1 (@backend): `GET /api/search` — форма ответа

- **Спека (§7.1):** `{ items: SearchHit[], total: number }`
- **Бэкенд (`internal/httpapi/httpapi.go:146`):** `{ "hits": SearchHit[] }`, поля `total` нет.
- Фолбэк: `total = hits.length` (`src/api/types.ts`, `BackendSearchResponseSchema`).
- Решение: либо бэкенд отдаёт `items`+`total`, либо спека меняется под `hits`.

## Q2 (@backend): `GET /api/backlinks/{id}` — форма ответа

- **Спека (§7.4):** `{ items: Array<{ uuid, url, title }> }`
- **Бэкенд (`httpapi.go:184`):** `{ "backlinks": [<url>, ...] }` — только URL-строки, без uuid/title.
- Фолбэк: uuid='' и title='', панель бэклинков тогда ведёт на `/graph/{url}` вместо `/page/{uuid}`
  (`src/components/BacklinksPanel.tsx`).
- Решение: бэкенд отдаёт объекты `{uuid, url, title}` (в Neo4j uuid/title резолвятся), либо спека
  меняется под строки.

## Q3 (@backend): `GET /health` — форма ответа

- **Спека (§7.7):** плоский `{ elasticsearch, neo4j, s3 }` со значениями `'ok' | 'down'`, HTTP 503.
- **Бэкенд (`httpapi.go:213`):** `{ "status": "ok"|"degraded", "checks": { "<имя>": "ok"|"down: <err>" } }`, HTTP 503.
- Фолбэк: нормализация `checks` в плоский вид, любое значение без префикса `ok` → `'down'`.
- Решение: бэкенд отдаёт плоский вид, либо спека меняется под `{status, checks}`.

## Q4 (@backend): тело ошибки

- **Спека (§7.8):** `{ code: string, message: string }`
- **Бэкенд (`httpapi.go:234`):** `{ "error": "<сообщение>" }` — только строка.
- Фолбэк в `src/api/client.ts`: `code = 'error'`, `message = error`.
- Решение: бэкенд отдаёт `{code, message}`, либо спека меняется под `{error}`.

## Подтверждено совпадающим (проверено по исходникам бэкенда)

- `GET /api/graph/{id}?k=` — точное совпадение со спекой §7.2 (nodes/edges, `resolved`, edges по url).
- `GET /api/page/{uuid}/url` — `{url}` + лишние `expires_in`/`expires_at` (игнорируются, безвредно).
- `GET /api/random` — суперсет `{uuid, url, ...}` (лишние поля отбрасываются схемой).
- `GET /stats` — точное совпадение `{pages, stubs, edges}`.
- `GET /health`, `GET /stats` живут ВНЕ префикса `/api` — как в спеке, так и в бэкенде;
  клиент `src/api/client.ts` имеет для них `bareGet`.

## Статус ручного смоука (DoD §11.4)

Полный смоук «search → graph → article → backlinks → random → theme → health» требует поднятого
стека: `sudo docker compose up -d` из корня (оператор, вне сессии агента). В сессии проверено:
`tsc --noEmit` — чисто, `npm run lint` — 0 ошибок, `npm test` — 34/34 зелёных, coverage `src/api`
99 % строк / 93 % веток, `npm run build` — без предупреждений (main 291 kB, force-graph — lazy-чанк
203 kB), `vite preview` отдаёт собранное приложение. Смоук против живого бэкенда — за оператором.

## Прочее

- `frontend/.env` намеренно не создан (запрещено спекой §3); работа ведётся против `.env.example`
  (`VITE_API_BASE=/api`). Оператор копирует `.env.example` → `.env` при необходимости.
- В списке зависимостей §4 зафиксирован ESLint+Prettier без версий; использованы ESLint 8.57 +
  legacy-конфиг в `package.json` (отдельные `eslint.config.js`/`.prettierrc` вне writable-списка §3).
  5 warnings `react-refresh/only-export-components` — намеренные экспорты-хелперы из компонентов
  (`SearchBar`: `normalizeLang`/`parseSize`/`browserDefaultLang`; `ThemeToggle`: `useThemeStore`/`applyTheme`).
