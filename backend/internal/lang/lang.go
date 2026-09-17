package lang

import "unicode"

const (
	RU = "ru"
	EN = "en"
)

// Detect определяет язык по первому непустому значению из аргументов.
// Эвристика по Unicode: кириллица → ru, латиница → en.
// Пустая строка, отсутствие букв или ничья → "ru" (дефолт).
//
// В проекте вызывается как Detect(page.Title, page.Description): язык
// определяется один раз и влияет только на выбор полей внутри
// Elasticsearch-репозитория.
func Detect(candidates ...string) string {
	for _, s := range candidates {
		if l, ok := detectOne(s); ok {
			return l
		}
	}
	return RU
}

// detectOne возвращает язык и признак того, что решение принято.
// ok == false означает «букв нет» — нужно смотреть следующий кандидат.
func detectOne(s string) (string, bool) {
	var cyr, lat int
	for _, r := range s {
		switch {
		case unicode.Is(unicode.Cyrillic, r):
			cyr++
		case unicode.Is(unicode.Latin, r):
			lat++
		}
	}
	if cyr == 0 && lat == 0 {
		return "", false
	}
	if lat > cyr {
		return EN, true
	}
	// Ничья при смешанном тексте трактуется в пользу дефолта.
	return RU, true
}

// Normalize приводит пришедший снаружи код языка к поддерживаемому набору.
func Normalize(s string) string {
	if s == EN {
		return EN
	}
	return RU
}
