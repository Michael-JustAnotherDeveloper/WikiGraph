# WikiGraph  (demo)

Википедия со связями между страницами: поиск через Elasticsearch, граф — в
Neo4j, HTML-контент — в S3. Все три хранилища связаны через `uuid`,
детерминированный от `url`.

# Зачем нужен проект
- Для развития как DevOps инженер
- Расширить свой стек
- Научиться строить инфру

# Запуск
Nginx пока что слушает на 80 http, админ 8000
```bash
sudo docker compose up -d   # в корне
```

## Архитектура

```mermaid
flowchart LR
    User((Пользователь))
    Dev((Admin Panel))

    subgraph Frontend["Frontend — React + Vite"]
        Search[Поиск]
        Graph[Граф]
        Viewer[Просмотр страницы]
    end

    subgraph Backend["Backend — Go"]
        API[HTTP API]
        Svc[Service layer]
    end

    ES[(Elasticsearch<br/>поиск)]
    Neo[(Neo4j<br/>граф связей)]
    S3[(S3 / Selectel<br/>HTML-контент)]

    User --> Search --> API
    User --> Graph --> API
    User --> Viewer --> API
    Dev -- "POST /internal/pages" --> API

    API --> Svc
    Svc --> ES
    Svc --> Neo
    Svc --> S3
```
---

Идемпотентность вставки:

```mermaid
flowchart LR
    Start["POST /internal/pages"] --> UUID["uuid = UUIDv5(url)"]
    UUID --> Check{"url уже есть?"}
    Check -- "нет" --> Create["создать в ES, Neo4j, S3<br/>→ 201"]
    Check -- "да" --> Overwrite["перезаписать в ES, Neo4j, S3<br/>→ 200"]
    Create --> Done
    Overwrite --> Done["готово"]
```
---

# Что дальше

- в будущем будет создан CI/CD пайплайн
- Улучшу IaC часть
- Добавлю нагрузочное тестирование
- Внедрение sec
- Доведу проект до production-ready + подробная документация
