#!/usr/bin/env python3
"""Build one real, indexable page per book from the catalogue.

books/index.html is the single source of truth: every card carries a
<template> with the full description of its book. Until now each
books/<slug>/index.html was a stub that redirected to the catalogue
(/books/#b-<slug>), so search engines could never rank a single book.

This script turns each card into a static page at books/<slug>/ with a
heading, the full description, buy buttons, Book structured data and
links to related titles. It also:

  * links each catalogue card title to its page,
  * gives the catalogue a canonical URL,
  * lists every book page in sitemap-pages.xml.

Run it again after every catalogue rebuild:

    python3 tools/build_book_pages.py

It is idempotent, has no dependencies, and never touches a book folder
that has no card in the catalogue (e.g. books/mastering-claude-code/).
"""
from __future__ import annotations

import datetime
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOKS = ROOT / "books"
SITE = "https://bookpilot.org"
TODAY = datetime.date.today().isoformat()

LANG_CODES = {
    "English": "en",
    "German": "de",
    "Deutsch": "de",
    "Português": "pt",
    "Portuguese": "pt",
    "Hrvatski": "hr",
    "Croatian": "hr",
    "Español": "es",
    "Spanish": "es",
    "Français": "fr",
    "French": "fr",
    "Italiano": "it",
    "Italian": "it",
}
RELATED_COUNT = 4

# Books that also have a hand-built landing page. The generated page links
# to it so visitors (and search engines) find the fuller page.
LANDING_PAGES = {
    "claude-code": "/books/mastering-claude-code/",
    "claude-code-2": "/books/mastering-claude-code/",
}
DEFAULT_AUTHOR = "Zirlandia Milkovic"

CARD_RE = re.compile(
    r'<article class="card[^"]*" id="b-([a-z0-9-]+)"([^>]*)>(.*?)</article>', re.S
)


def text(fragment: str) -> str:
    """Plain text of an HTML fragment."""
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def first(pattern: str, haystack: str, default: str = "") -> str:
    m = re.search(pattern, haystack, re.S)
    return m.group(1).strip() if m else default


def clip(s: str, limit: int = 155) -> str:
    """Shorten to a meta-description length on a word boundary."""
    s = " ".join(s.split())
    if len(s) <= limit:
        return s
    cut = s[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:—-")
    return cut + "…"


def attr(s: str) -> str:
    return html.escape(s, quote=True)


def parse_cards(catalogue: str) -> list[dict]:
    cards = []
    for slug, attrs, body in CARD_RE.findall(catalogue):
        start, end = body.find("<template>"), body.rfind("</template>")
        if start < 0 or end < 0:
            continue
        detail = body[start + len("<template>") : end].strip()
        facts = dict(
            (text(k), text(v))
            for k, v in re.findall(r"<dt>(.*?)</dt><dd>(.*?)</dd>", detail, re.S)
        )
        actions = first(r'<div class="actions">(.*?)</div>', detail)
        price = None
        for href, label in re.findall(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', actions, re.S):
            m = re.search(r"(€|\$|£)\s?(\d+(?:[.,]\d{1,2})?)", text(label))
            if m:
                currency = {"€": "EUR", "$": "USD", "£": "GBP"}[m.group(1)]
                price = (href, m.group(2).replace(",", "."), currency)
                break
        cards.append(
            {
                "slug": slug,
                "cat": first(r'data-cat="([^"]*)"', attrs),
                "detail": detail,
                "title": text(first(r'<h2 class="detail__title"[^>]*>(.*?)</h2>', detail)),
                "sub": text(first(r'<p class="detail__sub">(.*?)</p>', detail)),
                "blurb": text(first(r'<p class="detail__blurb">(.*?)</p>', detail)),
                "cover": first(r'<img src="assets/covers/([^"]+)"', detail),
                "cover_w": first(r'<img src="assets/covers/[^"]+" width="(\d+)"', detail),
                "cover_h": first(r'<img src="assets/covers/[^"]+" width="\d+" height="(\d+)"', detail),
                "facts": facts,
                "price": price,
                "first_buy": first(r'<a[^>]*href="([^"]+)"', actions),
            }
        )
    return cards


def page_title(card: dict) -> tuple[str, str]:
    """(title tag, author). Keeps the title the folder already carries."""
    existing = BOOKS / card["slug"] / "index.html"
    title = ""
    if existing.is_file():
        title = html.unescape(first(r"<title>(.*?)</title>", existing.read_text(encoding="utf-8")))
    if not title:
        title = f'{card["title"]} by {DEFAULT_AUTHOR}'
    author = title.rsplit(" by ", 1)[1].strip() if " by " in title else DEFAULT_AUTHOR
    return title, author


def book_schema(card: dict, author: str, lang: str, url: str) -> dict:
    book = {
        "@type": "Book",
        "@id": url + "#book",
        "name": card["title"],
        "url": url,
        "author": {"@type": "Person", "name": author},
        "inLanguage": lang,
        "image": f'{SITE}/books/assets/covers/{card["cover"]}',
    }
    if card["sub"]:
        book["alternativeHeadline"] = card["sub"]
    if card["blurb"]:
        book["description"] = card["blurb"]
    pages = re.search(r"(\d+)\s+pages", card["facts"].get("Length", ""))
    if pages:
        book["numberOfPages"] = int(pages.group(1))
    if card["facts"].get("Category"):
        book["genre"] = card["facts"]["Category"]
    if card["price"]:
        href, amount, currency = card["price"]
        book["offers"] = {
            "@type": "Offer",
            "price": amount,
            "priceCurrency": currency,
            "url": href,
            "availability": "https://schema.org/InStock",
        }
    crumbs = {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Books", "item": SITE + "/books/"},
            {"@type": "ListItem", "position": 3, "name": card["title"], "item": url},
        ],
    }
    return {"@context": "https://schema.org", "@graph": [book, crumbs]}


def detail_markup(card: dict) -> str:
    """The catalogue's detail block, adapted to stand as a page of its own."""
    d = card["detail"]
    d = re.sub(r'<h2 class="detail__title"[^>]*>(.*?)</h2>', r'<h1 class="detail__title">\1</h1>', d, flags=re.S)
    d = d.replace('<h3 class="detail__h">', '<h2 class="detail__h">')
    d = re.sub(r'(<h2 class="detail__h">.*?)</h3>', r"\1</h2>", d, flags=re.S)
    d = re.sub(r'(src|href)="assets/', r'\1="/books/assets/', d)
    # The cover is the largest thing on the page: load it first, not lazily.
    d = d.replace(' loading="lazy" decoding="async"', ' fetchpriority="high" decoding="async"', 1)
    landing = LANDING_PAGES.get(card["slug"])
    if landing:
        note = (f'<p class="detail__more">Want the chapter list and FAQ? '
                f'<a href="{landing}">See the full Mastering Claude Code page</a>.</p>')
        d = re.sub(r"(\s*</div>\s*</div>\s*)$", lambda m: "\n      " + note + m.group(1), d, count=1)
    return d


def related_markup(card: dict, cards: list[dict]) -> str:
    same = [c for c in cards if c["cat"] == card["cat"]]
    if len(same) < 2:
        same = cards
    i = next(n for n, c in enumerate(same) if c["slug"] == card["slug"])
    picks = [same[(i + k) % len(same)] for k in range(1, len(same))][:RELATED_COUNT]
    if not picks:
        return ""
    items = "\n".join(
        f'      <li><a class="rel" href="/books/{p["slug"]}/">'
        f'<img src="/books/assets/covers/{attr(p["cover"])}" width="{p["cover_w"]}" height="{p["cover_h"]}" '
        f'alt="" loading="lazy" decoding="async">'
        f'<span class="rel__title">{html.escape(p["title"])}</span>'
        f'<span class="rel__sub">{html.escape(p["sub"])}</span></a></li>'
        for p in picks
    )
    label = card["facts"].get("Category", "")
    heading = f"More in {html.escape(label)}" if label else "More books"
    return f"""<section class="related" aria-labelledby="related-h">
  <div class="wrap">
    <h2 id="related-h">{heading}</h2>
    <ul class="related__grid">
{items}
    </ul>
    <p class="related__all"><a class="btn btn--ghost" href="/books/">Browse all books</a></p>
  </div>
</section>"""


def build_page(card: dict, cards: list[dict]) -> str:
    slug = card["slug"]
    url = f"{SITE}/books/{slug}/"
    title, author = page_title(card)
    lang = LANG_CODES.get(card["facts"].get("Language", "English"), "en")
    description = clip(card["blurb"] or card["sub"] or title)
    share = BOOKS / "assets" / "share" / f"{slug}.jpg"
    if share.is_file():
        og_image, og_w, og_h = f"{SITE}/books/assets/share/{slug}.jpg", "1200", "630"
    else:
        og_image, og_w, og_h = f'{SITE}/books/assets/covers/{card["cover"]}', card["cover_w"], card["cover_h"]
    schema = json.dumps(book_schema(card, author, lang, url), ensure_ascii=False, separators=(",", ":"))
    schema = schema.replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{attr(description)}">
<link rel="canonical" href="{url}">
<meta name="theme-color" content="#15132f">
<meta property="og:type" content="book">
<meta property="og:title" content="{attr(title)}">
<meta property="og:description" content="{attr(description)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{og_image}">
<meta property="og:image:width" content="{og_w}">
<meta property="og:image:height" content="{og_h}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/icon-96.png" sizes="96x96" type="image/png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/books/styles.css">
<link rel="stylesheet" href="/books/book-page.css">
<script type="application/ld+json">{schema}</script>
</head>
<body class="bookpage">
<a class="skip" href="#book">Skip to the book</a>

<header class="top" id="top">
  <div class="wrap top__in">
    <a class="brand" href="/" aria-label="BookPilot AI — home">
      <img src="/books/assets/bookpilot-logo.svg" width="166" height="32" alt="BookPilot AI">
    </a>
    <nav class="nav" aria-label="Main">
      <a href="/books/">All books</a>
      <a href="/blog/">Blog</a>
      <a href="/">Home</a>
    </nav>
    <a class="btn btn--primary btn--sm top__cta" href="/books/">Browse books</a>
  </div>
</header>

<main id="book">
  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <a href="/books/">Books</a> <span aria-hidden="true">›</span> <span aria-current="page">{html.escape(card["title"])}</span></nav>
    <article class="bookpage__card" lang="{lang}">
  {detail_markup(card)}
    </article>
  </div>
  {related_markup(card, cards)}
</main>

<footer class="foot">
  <div class="wrap foot__in">
    <p><a class="bp-brandlogo bp-brandlogo--light" href="/" aria-label="BookPilot AI — home"><img src="/assets/brand/logo-mark.svg" width="26" height="26" alt=""><span>BookPilot <span class="bp-brandlogo__ai">AI</span></span></a> <span class="foot__copy">&middot; &copy; 2026. All rights reserved.</span></p>
    <p class="foot__small">The books and guides on this site are educational and are not legal, financial, medical or psychological advice. This page sets no cookies and loads nothing from third-party servers; links to Amazon, Stripe, Gumroad and gdprgard.eu open their own sites.</p>
    <p class="foot__small"><a href="/books/">All books</a> &middot; <a href="/book-auditor/">Book Quality Auditor</a> &middot; <a href="/blog/">Blog</a> &middot; <a href="/sell-your-book/">Sell your book</a> &middot; <a href="/privacy.html">Privacy</a> &middot; <a href="/terms.html">Terms</a> &middot; <a href="/cookies.html">Cookies</a> &middot; <a href="/contact/">Contact</a></p>
  </div>
</footer>
<script src="/assets/chat/book-chat.js" defer></script>
</body>
</html>
"""


def link_catalogue(catalogue: str) -> str:
    """Link each card title to its page and give the catalogue a canonical."""

    def card(m: re.Match) -> str:
        slug, attrs, body = m.group(1), m.group(2), m.group(3)
        body = re.sub(
            r'<h3 class="card__title">(?!<a )(.*?)</h3>',
            lambda t: f'<h3 class="card__title"><a href="{slug}/">{t.group(1)}</a></h3>',
            body,
            count=1,
            flags=re.S,
        )
        opening = m.group(0)[: m.group(0).index(">") + 1]
        return f"{opening}{body}</article>"

    catalogue = CARD_RE.sub(card, catalogue)
    if 'rel="canonical"' not in catalogue:
        catalogue = catalogue.replace(
            '<meta name="theme-color"',
            f'<link rel="canonical" href="{SITE}/books/">\n<meta name="theme-color"',
            1,
        )
    return catalogue


def update_sitemap(slugs: list[str]) -> int:
    path = ROOT / "sitemap-pages.xml"
    xml = path.read_text(encoding="utf-8")
    listed = set(re.findall(r"<loc>(.*?)</loc>", xml))
    new = [
        f"  <url><loc>{SITE}/books/{s}/</loc><lastmod>{TODAY}</lastmod></url>"
        for s in slugs
        if f"{SITE}/books/{s}/" not in listed
    ]
    if new:
        xml = xml.replace("</urlset>", "\n".join(new) + "\n</urlset>")
        path.write_text(xml, encoding="utf-8", newline="\n")
        index = ROOT / "sitemap.xml"
        idx = index.read_text(encoding="utf-8")
        idx = re.sub(
            r"(sitemap-pages\.xml</loc><lastmod>)[^<]*(</lastmod>)", rf"\g<1>{TODAY}\g<2>", idx
        )
        index.write_text(idx, encoding="utf-8", newline="\n")
    return len(new)


def main() -> int:
    catalogue_path = BOOKS / "index.html"
    catalogue = catalogue_path.read_text(encoding="utf-8")
    cards = parse_cards(catalogue)
    if not cards:
        print("No cards found in books/index.html — nothing written.", file=sys.stderr)
        return 1
    for card in cards:
        out = BOOKS / card["slug"] / "index.html"
        out.parent.mkdir(exist_ok=True)
        out.write_text(build_page(card, cards), encoding="utf-8", newline="\n")
    linked = link_catalogue(catalogue)
    if linked != catalogue:
        catalogue_path.write_text(linked, encoding="utf-8", newline="\n")
    added = update_sitemap([c["slug"] for c in cards])
    print(f"{len(cards)} book pages written, {added} URLs added to sitemap-pages.xml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
