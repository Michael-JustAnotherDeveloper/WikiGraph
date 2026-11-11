"""
ETL pipeline: Wikipedia -> WikiGraph backend.

Sources:
  - HTML статьи:  https://en.wikipedia.org/w/rest.php/v1/page/{title}/html
  - Метаданные:   https://en.wikipedia.org/api/rest_v1/page/summary/{title}
  - Цель:         BACKEND_URL (env), авторизация через A-Internal-Token

Совет: установите `lxml` — парсинг станет в 3–5 раз быстрее, если
заменить "html.parser" на "lxml" в transform_html().
"""

import json
import logging
import os
import time
from collections import Counter
from typing import List

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

load_dotenv()
log = logging.getLogger("wiki_etl")

BACKEND_URL = os.getenv("BACKEND_URL")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")
if not BACKEND_URL or not INTERNAL_TOKEN:
    raise RuntimeError(
        "BACKEND_URL and INTERNAL_TOKEN must be set in environment (.env)"
    )

WIKI_HTML = "https://en.wikipedia.org/w/rest.php/v1/page/{title}/html"
WIKI_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
WIKI_PAGE = "https://en.wikipedia.org/wiki/{title}"
USER_AGENT = (
    "WikiGraph-ETL/1.0 "
    "(https://github.com/Michael-JustAnotherDeveloper/WikiGraph)"
)
HTTP_TIMEOUT = 15.0
BACKEND_TIMEOUT = 10.0
DESCRIPTION_MAX_LEN = 300

class Vertex(BaseModel):
    source: str
    links: List[str] = Field(default_factory=list)


class PagePayload(BaseModel):
    url: str
    title: str
    author: str
    description: str
    content: str
    links: List[str]



def read_vertexes(path: str = "vertex.json") -> List[Vertex]:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    try:
        return [Vertex.model_validate(v) for v in raw]
    except ValidationError as e:
        log.error("vertex.json не проходит валидацию: %s", e)
        raise


PLACEHOLDER_SVG = (
    "data:image/svg+xml;charset=UTF-8,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='150' "
    "viewBox='0 0 200 150'%3E"
    "%3Crect width='100%25' height='100%25' fill='%23eaecf0'/%3E"
    "%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='14' "
    "fill='%2372777d' text-anchor='middle' dy='.3em'%3EImage%3C/text%3E"
    "%3C/svg%3E"
)

CUSTOM_CSS = """
/* Скрываем служебные элементы */
.mw-editsection, .navbox, .vertical-navbox, .metadata,
.sistersitebox, #toc, .mw-jump, .printfooter, .mw-indicators,
.ambox, .hatnote, .rellink, .mw-empty-elt {
    display: none !important;
}

body {
    background: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                 Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: #202122;
    margin: 0;
}
.mw-parser-output {
    max-width: 820px;
    margin: 0 auto;
    padding: 24px 20px 60px;
}
.infobox {
    float: right;
    clear: right;
    margin: 0 0 1em 1em;
    background: #f8f9fa;
    border: 1px solid #a2a9b1;
    padding: 10px;
    font-size: 0.9em;
    border-radius: 4px;
    max-width: 320px;
}
h1, h2, h3, h4, h5, h6 {
    font-family: "Linux Libertine", Georgia, Times, serif;
    font-weight: normal;
    border-bottom: 1px solid #a2a9b1;
    padding-bottom: 4px;
    margin-top: 1.5em;
}
.placeholder-img {
    border: 1px dashed #c8ccd1;
    background-color: #f8f9fa;
    opacity: 0.85;
    object-fit: contain;
    max-width: 100%;
    height: auto;
}
table.wikitable {
    border-collapse: collapse;
    margin: 1em 0;
}
table.wikitable th, table.wikitable td {
    border: 1px solid #a2a9b1;
    padding: 6px 10px;
}
a { color: #3366cc; text-decoration: none; }
a:hover { text-decoration: underline; }
"""


def transform_html(html_content: str, title: str = "Wikipedia Article") -> str:
    """
    Превращает сырой HTML из Wikipedia REST API в автономный
    стилизованный документ с SVG-заглушками вместо картинок.
    """
    soup = BeautifulSoup(html_content, "html.parser")

    if not soup.html:
        new_html = soup.new_tag("html")
        new_html.append(soup)
        soup = BeautifulSoup(str(new_html), "html.parser")

    head = soup.head
    if not head:
        head = soup.new_tag("head")
        soup.html.insert(0, head)

    if not head.title:
        title_tag = soup.new_tag("title")
        title_tag.string = title
        head.append(title_tag)

    wiki_css = soup.new_tag("link", rel="stylesheet")
    wiki_css["href"] = (
        "https://en.wikipedia.org/w/load.php?"
        "debug=false&lang=en&modules="
        "mediawiki.legacy.commonPrint%2Cshared%7Cskins.vector.styles"
        "&only=styles&skin=vector&*"
    )
    head.append(wiki_css)

    custom_css = soup.new_tag("style")
    custom_css.string = CUSTOM_CSS
    head.append(custom_css)

    # Замена всех <img> на встроенный SVG-заглушку
    for img in soup.find_all("img"):
        alt = img.get("alt", "")
        img["src"] = PLACEHOLDER_SVG
        img["alt"] = alt or "Image placeholder"
        img["class"] = img.get("class", []) + ["placeholder-img"]
        for attr in (
            "srcset",
            "sizes",
            "data-file-width",
            "data-file-height",
            "data-file-type",
        ):
            img.attrs.pop(attr, None)

    return str(soup)



@retry(
    retry=retry_if_exception_type(requests.HTTPError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
def fetch_text(session: requests.Session, url: str) -> str:
    r = session.get(url, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    return r.text


@retry(
    retry=retry_if_exception_type(requests.HTTPError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
def fetch_json(session: requests.Session, url: str) -> dict:
    r = session.get(url, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    return r.json()


def post_payload(payload: PagePayload) -> None:
    r = requests.post(
        BACKEND_URL,
        json=payload.model_dump(),
        headers={
            "Content-Type": "application/json",
            "X-Internal-Token": INTERNAL_TOKEN,
        },
        timeout=BACKEND_TIMEOUT,
    )
    r.raise_for_status()


def build_payload(
    vertex: Vertex, html: str, summary: dict
) -> PagePayload:
    title = vertex.source
    description = (
        summary.get("extract")
        or summary.get("description")
        or ""
    )[:DESCRIPTION_MAX_LEN]

    return PagePayload(
        url=WIKI_PAGE.format(title=title.replace(" ", "_")),
        title=title,
        author="Wikipedia community",
        description=description,
        content=transform_html(html, title),
        links=[
            WIKI_PAGE.format(title=t.replace(" ", "_"))
            for t in vertex.links
        ],
    )


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    )

    stats: Counter = Counter()
    start = time.perf_counter()

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    for vertex in read_vertexes():
        stats["total"] += 1
        title = vertex.source


        try:
            html = fetch_text(
                session, WIKI_HTML.format(title=title)
            )
        except requests.HTTPError as e:
            stats["html_failed"] += 1
            log.error("html fetch failed for %s: %s", title, e)
            continue

        if not html.strip():
            stats["html_empty"] += 1
            log.warning("empty html for %s, skipping", title)
            continue

        try:
            summary = fetch_json(
                session, WIKI_SUMMARY.format(title=title)
            )
        except requests.HTTPError as e:
            stats["summary_failed"] += 1
            log.warning(
                "summary fetch failed for %s: %s (using defaults)",
                title, e,
            )
            summary = {}

        payload = build_payload(vertex, html, summary)
        try:
            post_payload(payload)
            stats["loaded"] += 1
        except requests.HTTPError as e:
            stats["load_failed"] += 1
            log.error("load failed for %s: %s", title, e)

    elapsed = time.perf_counter() - start
    log.info("done in %.1fs | %s", elapsed, dict(stats))


if __name__ == "__main__":
    main()