#!/usr/bin/env bash
# Заливает 5-6 mock-страниц через internal-эндпоинт.
# Граф получается связным, с двумя незалитыми url — они останутся :Stub.
#
#   ./scripts/seed.sh
#   BACKEND_URL=http://localhost:8080 INTERNAL_TOKEN=... ./scripts/seed.sh
#
# Скрипт идемпотентен: повторный запуск перезапишет те же страницы
# (uuid детерминирован от url), первый прогон вернёт 201, следующие — 200.

set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"
INTERNAL_TOKEN="${INTERNAL_TOKEN:-dev-internal-token-change-me}"

post_page() {
  local payload="$1"
  local url
  url=$(printf '%s' "$payload" | sed -n 's/.*"url": *"\([^"]*\)".*/\1/p' | head -n1)

  local status
  status=$(curl -sS -o /tmp/seed_response.json -w '%{http_code}' \
    -X POST "${BACKEND_URL}/internal/pages" \
    -H 'Content-Type: application/json' \
    -H "X-Internal-Token: ${INTERNAL_TOKEN}" \
    -d "$payload")

  case "$status" in
    201) echo "  created    ${url}  $(cat /tmp/seed_response.json)" ;;
    200) echo "  overwritten ${url}  $(cat /tmp/seed_response.json)" ;;
    *)
      echo "  FAILED     ${url}  HTTP ${status}  $(cat /tmp/seed_response.json)" >&2
      exit 1
      ;;
  esac
}

echo "Seeding ${BACKEND_URL} ..."

post_page '{
  "url": "/wiki/graph-databases",
  "title": "Графовые базы данных",
  "author": "Иван Иванов",
  "description": "Обзор графовых СУБД и их применения в связанных данных",
  "content": "<html><body><h1>Графовые базы данных</h1><p>Хранят данные как вершины и рёбра.</p></body></html>",
  "links": ["/wiki/neo4j", "/wiki/cypher", "/wiki/knowledge-graph"]
}'

post_page '{
  "url": "/wiki/neo4j",
  "title": "Neo4j",
  "author": "Иван Иванов",
  "description": "Популярная графовая СУБД с языком запросов Cypher",
  "content": "<html><body><h1>Neo4j</h1><p>Графовая СУБД.</p></body></html>",
  "links": ["/wiki/cypher", "/wiki/graph-databases", "/wiki/acid"]
}'

post_page '{
  "url": "/wiki/cypher",
  "title": "Cypher",
  "author": "Мария Петрова",
  "description": "Декларативный язык запросов к графу",
  "content": "<html><body><h1>Cypher</h1><p>MATCH, MERGE, CREATE.</p></body></html>",
  "links": ["/wiki/neo4j", "/wiki/pattern-matching"]
}'

post_page '{
  "url": "/wiki/full-text-search",
  "title": "Full-text search",
  "author": "John Doe",
  "description": "Inverted indexes, analyzers and relevance scoring",
  "content": "<html><body><h1>Full-text search</h1><p>Inverted index basics.</p></body></html>",
  "links": ["/wiki/elasticsearch", "/wiki/graph-databases"]
}'

post_page '{
  "url": "/wiki/elasticsearch",
  "title": "Elasticsearch",
  "author": "John Doe",
  "description": "Distributed search engine built on top of Lucene",
  "content": "<html><body><h1>Elasticsearch</h1><p>Search engine.</p></body></html>",
  "links": ["/wiki/full-text-search", "/wiki/knowledge-graph"]
}'

post_page '{
  "url": "/wiki/knowledge-graph",
  "title": "Knowledge graph",
  "author": "Мария Петрова",
  "description": "Связанные сущности и отношения между ними",
  "content": "<html><body><h1>Knowledge graph</h1><p>Entities and relations.</p></body></html>",
  "links": ["/wiki/graph-databases", "/wiki/pattern-matching"]
}'

# Незалитыми остались /wiki/acid и /wiki/pattern-matching — они видны
# в графе как полупрозрачные :Stub.
echo
echo "Done. Stats:"
curl -sS "${BACKEND_URL}/stats"
echo