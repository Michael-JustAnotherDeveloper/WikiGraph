Проект: «Википедия с графами страниц like Obsidian» (MVP)

Цель проекта

Реализовать MVP википедии с графовыми связями между страницами (в стиле Obsidian): пользователь ищет статьи, видит граф связей, кликает по вершине и открывает HTML-страницу из объектного хранилища.

Асинхронный backend на Go + фронтенд на React. Проект — единый репозиторий, backend-часть — монолитная.

---

Стек

· Backend: Go 1.22+, асинхронный HTTP-сервер.
· Frontend: React 18 + Vite + TypeScript.
· Elasticsearch 8.x — поисковый индекс.
· Neo4j 5.x — граф связей + денормализованные поля для рендера.
· Selectel S3 — HTML-контент страниц по ключу uuid (S3-совместимое API, использовать aws-sdk-go-v2 с кастомным endpoint).

Все три БД связаны через uuid.

---

Доменная модель

Единый объект Page, который проходит через все три репозитория:

```go
type Page struct {
    UUID string // генерируется бэкендом при вставке
    URL string
    Title string // любой язык — что прислал разработчик
    Author string // любой язык
    Description string // любой язык
    Content []byte // html
    Links []string // исходящие url (присылает разработчик)
}
```

Ключевые правила:

1. UUID генерируется бэкендом при вставке. Клиент/internal-разработчик UUID не присылает.
2. Язык определяется один раз через detectLanguage(Page.Title) (fallback — Page.Description, дефолт — "ru"). Результат используется только внутри ElasticsearchRepo для выбора полей title_ru/title_en, author_ru/author_en, description_ru/description_en.
3. Neo4jRepo не думает о языке — пишет Title/Description как есть, одним полем.
4. S3Repo не думает о языке — кладёт Content по ключу UUID.
5. Репозитории не знают друг о друге. Каждый делает свою проекцию одного и того же Page.

detectLanguage() — эвристика по Unicode (кириллица → ru, латиница → en) либо библиотека lingua-go. Определяем по Title; если пусто/неоднозначно — ru.

---

Repository-слой

1. ElasticsearchRepo

Маппинг индекса (mapping.json):

```json
{
  "properties": {
    "uuid": { "type": "keyword" },
    "url": { "type": "text" },
    "title_ru": { "type": "text", "analyzer": "russian" },
    "author_ru": { "type": "text", "analyzer": "russian" },
    "description_ru": { "type": "text", "analyzer": "russian" },
    "title_en": { "type": "text", "analyzer": "english" },
    "author_en": { "type": "text", "analyzer": "english" },
    "description_en": { "type": "text", "analyzer": "english" }
  }
}
```

Методы:

· Insert(ctx, page Page) error — определяет язык, заполняет только соответствующие ru/en-поля, остальные оставляет пустыми. _id документа = uuid.
· Search(ctx, query string, lang string) ([]SearchHit, error) — мультиязычный поиск.

Логика поиска:

· Если lang == "ru": бустеры title_ru^3.0, author_ru^2.0, description_ru^1.0, title_en^1.0, author_en^0.5, description_en^0.25.
· Если lang == "en": зеркально — title_en^3.0, author_en^2.0, description_en^1.0, title_ru^1.0, author_ru^0.5, description_ru^0.25.
· Язык поискового запроса определяется через detectLanguage(query).
· Результат: список {uuid, url, title, author, description, score} с релевантностью.

2. Neo4jRepo

Схема графа:

```cypher
// Залитая страница
(:Page {
  uuid: string (UNIQUE),
  url: string (UNIQUE),
  title: string,
  description: string
})

// Заглушка: url, на который ссылаются, но страница ещё не залита
(:Stub {
  url: string (UNIQUE)
})

// Направленное ребро, идёт только из Page
(:Page)-[:LINKS_TO]->(:Page|:Stub)
```

Ограничения:

```cypher
CREATE CONSTRAINT page_uuid_unique IF NOT EXISTS
FOR (n:Page) REQUIRE n.uuid IS UNIQUE;

CREATE CONSTRAINT page_url_unique IF NOT EXISTS
FOR (n:Page) REQUIRE n.url IS UNIQUE;

CREATE CONSTRAINT stub_url_unique IF NOT EXISTS
FOR (n:Stub) REQUIRE n.url IS UNIQUE;
```

Методы:

· Insert(ctx, page Page) error:
  1. Проверить, существует ли :Page с таким uuid или url → вернуть ошибку (ErrAlreadyExists).
  2. Если существует :Stub с таким url → повысить до :Page (добавить uuid, title, description), входящие рёбра сохраняются.
  3. Иначе создать (:Page {uuid, url, title, description}).
  4. Для каждого link из page.Links:
     · если существует :Page или :Stub с таким url — используем его;
     · иначе создаём :Stub {url};
     · создаём ребро (page)-[:LINKS_TO]->(target) (если такого ребра ещё нет).
· FindGraph(ctx, uuid string, k int) (GraphResult, error):
  · Находит :Page по uuid (или по url — метод принимает оба варианта).
  · Обходит LINKS_TO рекурсивно до k итераций в исходящем направлении.
  · Возвращает flat-словарь:

```go
type GraphNode struct {
    UUID *string // null для Stub
    URL string
    Title *string // null для Stub
    Description *string // null для Stub
    Resolved bool // false для Stub
}

type GraphEdge struct {
    From string // url источника
    To string // url цели
}

type GraphResult struct {
    Nodes []GraphNode
    Edges []GraphEdge
}
```

Ограничения k: 1 ≤ k ≤ 5 (валидировать на входе).

Дополнительный метод:

· FindBacklinks(ctx, uuid string) ([]string, error) — список url, которые ссылаются на данный узел:
  ```cypher
  MATCH (src)-[:LINKS_TO]->(t {uuid: $uuid}) RETURN src.url
  ```

3. S3Repo (Selectel)

Ключ — uuid. Значение — HTML-контент.

Методы:

· Put(ctx, uuid string, content []byte, contentType string) error — contentType по умолчанию text/html; charset=utf-8.
· PresignedURL(ctx, uuid string, ttl time.Duration) (string, error) — presigned GET-URL с TTL из конфига.

---

Путь запроса клиента (чтение)

1. Поиск. GET /api/search?q=<query>&lang=<ru|en> → ElasticsearchRepo.Search. Возвращает []SearchHit (список uuid + метаданные).
2. Граф. Для выбранного uuid — GET /api/graph/{uuid}?k=<N> → Neo4jRepo.FindGraph. Возвращает flat-словарь с nodes и edges — без дополнительных запросов в ES, потому что title/description уже лежат в Neo4j.
3. Рендер графа. Фронт рисует граф с физикой (react-force-graph-2d):
   · :Page — обычная вершина, при hover показывается description.
   · :Stub — полупрозрачная серая вершина, при hover показывается url.
4. Клик по вершине.
   · Если resolved == true: фронт вызывает GET /api/page/{uuid}/url → бэк генерирует presigned URL S3 → браузер скачивает и открывает .html.
   · Если resolved == false (Stub): фронт показывает «страница ещё не залита», S3 не дёргается.

---

Путь вставки данных (internal endpoint)

Клиент данные не пишет. Только разработчик через internal endpoint.

POST /internal/pages

Заголовки:

```
X-Internal-Token: <INTERNAL_TOKEN из .env>
Content-Type: application/json
```

Payload:

```json
{
  "url": "/wiki/A",
  "title": "Статья А",
  "author": "Иван Иванов",
  "description": "Краткое описание статьи",
  "content": "<html>...</html>",
  "links": ["/wiki/B", "/wiki/C"]
}
```

Обработка:

1. Проверить X-Internal-Token.
2. Сгенерировать uuid.
3. Собрать Page{UUID, URL, Title, Author, Description, Content, Links}.
4. Последовательно: ElasticsearchRepo.Insert → Neo4jRepo.Insert → S3Repo.Put.
5. При ошибке любого шага — вернуть 500 с указанием, где упало. Повторный вызов с тем же url возвращает 409 Conflict (апдейты в MVP не поддерживаются).

Ответы:

· 201 Created — {"uuid": "..."}
· 409 Conflict — страница с таким url уже существует
· 400 Bad Request — некорректный payload
· 401 Unauthorized — неверный internal token
· 500 Internal Server Error — сбой одного из хранилищ

---

API-эндпоинты

Публичные:

Метод Путь Назначение
GET /api/search?q=&lang= Поиск через ES
GET /api/graph/{uuid}?k= Граф вокруг узла до k итераций
GET /api/page/{uuid}/url Presigned URL на S3
GET /api/backlinks/{uuid} Входящие ссылки
GET /api/random Случайная страница из ES
GET /health Healthcheck всех трёх БД
GET /stats Кол-во Page / Stub / рёбер

Internal:

Метод Путь Назначение
POST /internal/pages Вставка страницы

---

Frontend

· Стек: React 18 + Vite + TypeScript, react-force-graph-2d, react-router, zustand (стейт), @tanstack/react-query (запросы).
· Стиль: glass-morphism, светлая / тёмная тема (переключатель, состояние в localStorage).
· Экраны:
  1. Поиск — строка ввода, список результатов (title, author, description, score), кнопка «Показать граф».
  2. Граф — force-directed граф. Page — обычные узлы, Stub — полупрозрачные. Hover показывает description (или url для Stub). Клик по Page → открытие страницы, клик по Stub → тост «страница ещё не залита».
  3. Просмотр страницы — iframe/новая вкладка с presigned URL.
· Ветка lang: берётся из локали браузера или из UI-переключателя, уходит в /api/search.

---

Тесты

Отдельная папка backend/tests/. Покрываем только самое главное:

1. Unit: detectLanguage — кириллица / латиница / смешанный / пустая строка.
2. Unit: ElasticsearchRepo.Insert — правильно выбирает title_ru vs title_en в зависимости от языка payload (mock ES-клиент).
3. Unit: Neo4jRepo.Insert — Stub повышается до Page; повторная вставка uuid/url → ошибка (testcontainers с Neo4j).
4. Integration: Neo4jRepo.FindGraph — обход до k итераций, корректный состав nodes/edges, resolved для Stub (testcontainers).
5. Integration: полный цикл вставки через /internal/pages — ES + Neo4j + S3 (mock S3): Page виден в поиске, граф содержит рёбра, presigned URL генерируется.

---

Артефакты, которые нужно предоставить

· Исходный код бэкенда (Go).
· Исходный код фронтенда (React + TS).
· Тесты в backend/tests/.
· mapping.json — маппинг Elasticsearch-индекса.
· .env.example — контракт конфигурации с mock-значениями и комментариями.
· scripts/seed.sh — bash-скрипт с curl-запросами на /internal/pages для заливки 5–6 mock-страниц (создающих связный граф с 1–2 Stub'ами).
· README.md — короткая инструкция: как запустить тесты, какие сервисы (ES, Neo4j, S3) должны быть доступны, какие переменные окружения обязательны.

---

Конфигурация (.env)

```env
# Backend
BACKEND_PORT=8080
INTERNAL_TOKEN=dev-internal-token-change-me
GRAPH_MAX_K=5

# Elasticsearch
ES_URL=http://localhost:9200
ES_INDEX=wiki_pages
ES_USERNAME=
ES_PASSWORD=

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=neo4j_password

# S3 (Selectel)
S3_ENDPOINT=https://s3.selcdn.ru
S3_REGION=ru-1
S3_BUCKET=wiki-content
S3_ACCESS_KEY=test_access_key
S3_SECRET_KEY=test_secret_key
S3_PRESIGNED_TTL=15m

# Frontend
VITE_API_BASE=/api
```

---

Итоговые инварианты

1. Один Page — одна проекция в три хранилища, единый payload, UUID генерирует бэкенд.
2. Язык определяется один раз, влияет только на ES.
3. Neo4j хранит title/description без языкового разделения — граф рендерится одним запросом.
4. Рёбра — по url. Целевые узлы: :Page (залитые) или :Stub (заглушки).
5. Stub повышается до Page при появлении страницы с тем же url.
6. Рёбра идут только из :Page (контент Stub не парсится).
7. Вставка: ES → Neo4j → S3, при ошибке — 500, повторный вызов с тем же url → 409 (апдейты в MVP не поддерживаются).
8. Данные пишет только разработчик через /internal/pages. Публичного write API нет.
