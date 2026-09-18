# Wiki с графом страниц — backend

MVP «википедии» со связями между страницами в стиле Obsidian: поиск через
Elasticsearch, граф в Neo4j, HTML-контент в S3-совместимом хранилище.
Все три проекции связаны через `uuid`.

## Структура

```
backend/
  cmd/server/            точка входа
  internal/config/       конфиг из переменных окружения
  internal/domain/       Page, GraphResult, SearchHit, доменные ошибки
  internal/lang/         detectLanguage
  internal/repo/elastic/ проекция в поисковый индекс (+ mapping.json)
  internal/repo/graph/   проекция в Neo4j
  internal/repo/blob/    проекция в S3
  internal/service/      оркестрация трёх репозиториев
  internal/httpapi/      роутер и хендлеры
  tests/                 unit- и integration-тесты
scripts/seed.sh          заливка mock-страниц
docker-compose.yml       ES + Neo4j + MinIO для локального запуска
.env.example             контракт конфигурации
frontend/
  src/api/client.ts      типы и запросы к бэкенду
  src/store/ui.ts        zustand: тема, язык, тосты
  src/pages/             поиск, граф, просмотр страницы
  src/components/        переключатели темы и языка, тосты
  src/styles.css         токены, glass-morphism, светлая и тёмная тема
```

`mapping.json` лежит в `backend/internal/repo/elastic/mapping.json` — он
встраивается в бинарник через `go:embed`, чтобы маппинг индекса и код не
разъезжались. Индекс создаётся на старте сервиса, если его ещё нет.

## Запуск

```bash
cp .env.example .env          # и поправить под себя
docker compose up -d          # ES :9200, Neo4j :7687, MinIO :9000

cd backend
go mod tidy
set -a && source ../.env && set +a
go run ./cmd/server
```

Для работы с локальным MinIO в `.env` нужно заменить `S3_ENDPOINT` на
`http://localhost:9000`.

Обязательные переменные окружения: `INTERNAL_TOKEN`, `NEO4J_PASSWORD`,
`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Без них
сервис не стартует. Остальные имеют значения по умолчанию.

Заливка демо-данных (6 страниц, 2 из ссылок остаются заглушками):

```bash
./scripts/seed.sh
```

Фронтенд:

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Vite проксирует `/api`, `/health` и `/stats` на `localhost:8080`, так что
в разработке CORS не участвует. Для отдельного домена в проде нужно
выставить `CORS_ORIGIN` в бэкенде и `VITE_API_BASE` во фронтенде.

Экраны: поиск (строка запроса, список результатов со score), граф
(force-directed, ползунок глубины `k`, панель входящих ссылок) и просмотр
страницы (iframe с presigned-ссылкой). Залитые страницы — сплошные
вершины, незалитые — полупрозрачные; клик по незалитой показывает тост
вместо похода в S3. Тема и язык хранятся в `localStorage`, язык уходит
в `/api/search` и меняет бустеры полей.

## Тесты

Unit-тесты не требуют внешних сервисов:

```bash
cd backend
go test ./tests/...
```

Integration-тесты поднимают Elasticsearch и Neo4j через testcontainers,
поэтому им нужен доступный Docker-демон. S3 подменяется in-memory моком:

```bash
cd backend
go test -tags=integration -timeout=20m ./tests/...
```

Контейнеры поднимаются на каждый тест отдельно, так что прогон занимает
несколько минут.

Покрыто:

| Тест | Что проверяет |
| --- | --- |
| `TestDetectLanguage` | кириллица / латиница / смешанный / пустая строка |
| `TestPageUUIDIsDeterministic` | один url — всегда один и тот же uuid |
| `TestElasticsearchInsertPicksLanguageFields` | `title_ru` vs `title_en` (mock ES-клиент) |
| `TestInsertPromotesStubToPage` | заглушка повышается до `:Page`, входящее ребро выживает |
| `TestInsertOverwritesExistingPage` | перезапись полей и реконсиляция рёбер |
| `TestFindGraphRespectsDepth` | обход до k итераций, `resolved` у заглушек |
| `TestFindBacklinks` | входящие ссылки |
| `TestInsertPageFullCycle` | ES + Neo4j + S3 через `/internal/pages` |
| `TestInsertPageOverwrite` | повторная вставка перезаписывает все три хранилища |
| `TestInternalEndpointRequiresToken` | 401 и 400 на internal-эндпоинте |

## API

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/api/search?q=&lang=&size=` | поиск через ES |
| GET | `/api/graph/{uuid\|url}?k=` | граф вокруг узла, `1 ≤ k ≤ 5` |
| GET | `/api/page/{uuid}/url` | presigned URL на HTML |
| GET | `/api/backlinks/{uuid\|url}` | входящие ссылки |
| GET | `/api/random` | случайная страница |
| GET | `/health` | статус трёх хранилищ, 503 если что-то лежит |
| GET | `/stats` | количество Page / Stub / рёбер |
| POST | `/internal/pages` | вставка или перезапись страницы |

### Вставка

```bash
curl -X POST http://localhost:8080/internal/pages \
  -H 'Content-Type: application/json' \
  -H 'X-Internal-Token: dev-internal-token-change-me' \
  -d '{
    "url": "/wiki/A",
    "title": "Статья А",
    "author": "Иван Иванов",
    "description": "Краткое описание",
    "content": "<html>...</html>",
    "links": ["/wiki/B", "/wiki/C"]
  }'
```

Ответы: `201` — страница создана, `200` — существующая перезаписана,
`400` — некорректный payload, `401` — неверный токен, `500` — сбой
хранилища (в теле указано, на каком именно).

## Инварианты

1. Один `Page` — одна проекция в три хранилища, единый payload.
2. `uuid = UUIDv5(NameSpaceURL, url)`. Один url всегда даёт один uuid,
   поэтому `uuid` и `url` находятся в отношении 1:1.
3. Язык определяется один раз через `lang.Detect(Title, Description)` и
   влияет только на выбор полей в Elasticsearch.
4. Neo4j хранит `title`/`description` без языкового разделения — граф
   рендерится одним запросом, без похода в ES.
5. Рёбра идентифицируются по url. Цель ребра — `:Page` или `:Stub`.
6. Заглушка повышается до `:Page` при появлении страницы с тем же url;
   узел остаётся тем же, входящие рёбра сохраняются.
7. Рёбра идут только из `:Page`.
8. Повторная вставка того же url перезаписывает все три хранилища.
   Список `links` — полное состояние страницы: рёбра, которых в нём нет,
   удаляются, а осиротевшие заглушки подчищаются.
9. Данные пишет только internal-эндпоинт. Публичного write API нет.

## О надёжности вставки

Порядок ES → Neo4j → S3 не транзакционен: падение на втором или третьем
шаге оставляет частично записанное состояние. Это осознанный компромисс
MVP, и он терпим именно потому, что все три записи идемпотентны —
достаточно повторить тот же запрос целиком, и состояние сойдётся. Ответ
`500` содержит поле `stage` с именем упавшего хранилища.

Внутри Neo4j вся последовательность (повышение заглушки, запись полей,
реконсиляция рёбер, уборка заглушек) идёт одной транзакцией, поэтому
состояние «старые рёбра удалены, новые ещё не созданы» снаружи не видно.