package tests

import (
	"testing"

	"github.com/example/wiki-graph/backend/internal/lang"
	"github.com/example/wiki-graph/backend/internal/service"
)

func TestDetectLanguage(t *testing.T) {
	cases := []struct {
		name  string
		input []string
		want  string
	}{
		{"кириллица", []string{"Статья про графы"}, lang.RU},
		{"латиница", []string{"Graph theory basics"}, lang.EN},
		{"смешанный с перевесом латиницы", []string{"Obsidian и графы knowledge base"}, lang.EN},
		{"смешанный с перевесом кириллицы", []string{"Графовая база данных Neo4j"}, lang.RU},
		{"пустая строка — дефолт ru", []string{""}, lang.RU},
		{"без букв — дефолт ru", []string{"42 :: 17 -- ???"}, lang.RU},
		{"пустой title — падаем в description", []string{"", "Distributed systems"}, lang.EN},
		{"оба пустые — дефолт ru", []string{"", ""}, lang.RU},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := lang.Detect(tc.input...); got != tc.want {
				t.Fatalf("Detect(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

// UUID должен зависеть только от url и быть стабильным между вызовами,
// иначе повторная вставка не попадёт в те же ключи ES и S3.
func TestPageUUIDIsDeterministic(t *testing.T) {
	const url = "/wiki/A"

	first := service.PageUUID(url)
	second := service.PageUUID(url)
	if first != second {
		t.Fatalf("uuid is not stable: %s != %s", first, second)
	}
	if other := service.PageUUID("/wiki/B"); other == first {
		t.Fatalf("different urls produced the same uuid: %s", other)
	}
	if len(first) != 36 {
		t.Fatalf("unexpected uuid format: %q", first)
	}
}
