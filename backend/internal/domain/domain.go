package domain

import "errors"

// Page — единый объект, который проходит через все три репозитория.
// Каждый репозиторий делает свою проекцию одного и того же Page и ничего
// не знает об остальных.
type Page struct {
	UUID        string // детерминированный UUIDv5 от URL, считается бэкендом
	URL         string
	Title       string // любой язык
	Author      string // любой язык
	Description string // любой язык
	Content     []byte // html
	Links       []string
}

// SearchHit — результат поиска из Elasticsearch.
type SearchHit struct {
	UUID        string  `json:"uuid"`
	URL         string  `json:"url"`
	Title       string  `json:"title"`
	Author      string  `json:"author"`
	Description string  `json:"description"`
	Score       float64 `json:"score"`
}

// GraphNode — вершина графа. Для :Stub uuid/title/description равны null,
// resolved == false.
type GraphNode struct {
	UUID        *string `json:"uuid"`
	URL         string  `json:"url"`
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Resolved    bool    `json:"resolved"`
}

// GraphEdge — направленное ребро LINKS_TO, идентифицируется по url.
type GraphEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// GraphResult — flat-словарь для рендера на фронте одним запросом.
type GraphResult struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// Stats — счётчики для /stats.
type Stats struct {
	Pages int64 `json:"pages"`
	Stubs int64 `json:"stubs"`
	Edges int64 `json:"edges"`
}

var (
	// ErrNotFound — узел/страница не найдены.
	ErrNotFound = errors.New("not found")
	// ErrInvalidArgument — некорректный вход (например, k вне [1;5]).
	ErrInvalidArgument = errors.New("invalid argument")
)
