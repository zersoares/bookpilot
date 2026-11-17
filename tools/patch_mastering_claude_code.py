#!/usr/bin/env python3
"""Make books/mastering-claude-code/ readable without JavaScript.

That page is a compiled React app: the served HTML is an empty
<div id="root"></div> plus a 500 KB script, so any crawler, link
preview or AI assistant that does not run JavaScript sees about eleven
words. This script adds, without touching the app:

  * a static copy of the page's content inside #root (headline, the
    editions, all 24 chapter titles, the FAQ). React replaces it the
    moment the app mounts, so visitors never see it,
  * the missing og:image / twitter:card / icon tags in <head>,
  * Book and breadcrumb structured data.

The chapter titles and FAQ are read out of the compiled bundle itself,
so re-running this after the page is rebuilt keeps the static copy in
step. If the app's data layout ever changes the script stops with an
error instead of writing something wrong.

    python3 tools/patch_mastering_claude_code.py

Idempotent: it replaces its own marked blocks and nothing else.
"""
from __future__ import annotations

import datetime
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "books" / "mastering-claude-code" / "index.html"
SITE = "https://bookpilot.org"
URL = f"{SITE}/books/mastering-claude-code/"
TODAY = datetime.date.today().isoformat()

AMAZON_2026 = "https://www.amazon.com/dp/B0HFXYGLXD"
AMAZON_BEGINNERS = "https://www.amazon.com/dp/B0HLYCJ3TL"

HEAD_START, HEAD_END = "<!-- bp:seo-head:start -->", "<!-- bp:seo-head:end -->"
BODY_START, BODY_END = "<!-- bp:static-fallback:start -->", "<!-- bp:static-fallback:end -->"


def fail(msg: str) -> None:
    sys.exit(f"patch_mastering_claude_code: {msg}")


def read_bundle(page: str) -> tuple[list[dict], list[tuple[str, str]]]:
    parts = []
    for num, title, items in re.findall(
        r'\{part:(\d+),title:("(?:[^"\\]|\\.)*"),range:"[^"]*",tag:"[^"]*",color:"[^"]*",items:(\[.*?\])\}',
        page,
        re.S,
    ):
        parts.append({"part": int(num), "title": json.loads(title), "items": json.loads(items)})
    faq = [
        (json.loads(q), json.loads(a))
        for q, a in re.findall(r'\{q:("(?:[^"\\]|\\.)*"),a:("(?:[^"\\]|\\.)*")\}', page)
    ]
    if len(parts) != 6 or sum(len(p["items"]) for p in parts) != 24:
        fail(f"expected 6 parts / 24 chapters in the bundle, found {len(parts)} / "
             f"{sum(len(p['items']) for p in parts)}")
    if len(faq) < 4:
        fail(f"expected the FAQ in the bundle, found {len(faq)} entries")
    return parts, faq


def meta_description(page: str) -> str:
    m = re.search(r'<meta name="description" content="(.*?)">', page, re.S)
    if not m:
        fail("no meta description found")
    return html.unescape(m.group(1))


def head_block(description: str) -> str:
    share = ROOT / "books" / "assets" / "share" / "claude-code-2.jpg"
    if not share.is_file():
        fail("books/assets/share/claude-code-2.jpg is missing")
    book = {
        "@type": "Book",
        "@id": URL + "#book",
        "name": "Mastering Claude Code",
        "url": URL,
        "description": description,
        "author": {"@type": "Person", "name": "Zirlandia Milkovic"},
        "publisher": {"@type": "Organization", "name": "GDPRgard Publishing"},
        "inLanguage": "en",
        "genre": "AI & Tech",
        "image": f"{SITE}/books/assets/covers/claude-code-2.jpg",
        "workExample": [
            {
                "@type": "Book",
                "name": "Mastering Claude Code, 2026 Edition",
                "bookEdition": "2026 Edition",
                "bookFormat": "https://schema.org/Paperback",
                "numberOfPages": 350,
                "url": AMAZON_2026,
            },
            {
                "@type": "Book",
                "name": "Mastering Claude Code, 2nd Edition",
                "bookEdition": "2nd Edition",
                "numberOfPages": 423,
            },
        ],
    }
    crumbs = {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Books", "item": SITE + "/books/"},
            {"@type": "ListItem", "position": 3, "name": "Mastering Claude Code", "item": URL},
        ],
    }
    schema = json.dumps({"@context": "https://schema.org", "@graph": [book, crumbs]},
                        ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return f"""{HEAD_START}
  <meta property="og:image" content="{SITE}/books/assets/share/claude-code-2.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <script type="application/ld+json">{schema}</script>
  {HEAD_END}"""


def body_block(description: str, parts: list[dict], faq: list[tuple[str, str]]) -> str:
    e = html.escape
    chapters = "\n".join(
        f"<h3>Part {p['part']}: {e(p['title'])}</h3>\n<ul>"
        + "".join(f"<li>{e(i)}</li>" for i in p["items"])
        + "</ul>"
        for p in parts
    )
    questions = "\n".join(f"<h3>{e(q)}</h3>\n<p>{e(a)}</p>" for q, a in faq)
    return f"""{BODY_START}
<style>.bp-static{{max-width:760px;margin:0 auto;padding:32px 20px 64px;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1a1c}}.bp-static a{{color:#3f3aa8}}.bp-static h1{{font-size:2rem;line-height:1.2}}.bp-static h2{{margin-top:2em}}</style>
<main class="bp-static">
<h1>Mastering Claude Code, 2nd Edition</h1>
<p>By Zirlandia Milkovic. {e(description)}</p>
<h2>Choose your edition</h2>
<ul>
<li><strong>Claude Code for Beginners</strong>: start from zero, from installing and signing in to your first website. <a href="{AMAZON_BEGINNERS}" rel="noopener sponsored">Buy on Amazon</a></li>
<li><strong>Mastering Claude Code, 2026 Edition</strong>: the original 20-chapter edition (August 2026) with 100 prompt templates and CLAUDE.md, rules, skill and hook templates. Paperback, hardcover and Kindle. <a href="{AMAZON_2026}" rel="noopener sponsored">Buy on Amazon</a></li>
<li><strong>Mastering Claude Code, 2nd Edition</strong>: 24 chapters and 423 pages, updated for the Claude 5.5 family and Claude Code 2.1, with a new Part VI on agent fleets, goals and routines, artifacts, and auto mode. Coming soon to Amazon.</li>
</ul>
<h2>What is inside the book</h2>
<p>Twenty-four chapters in six parts, from installing Claude Code to running a fleet of agents. Every chapter ends with exercises, a challenge project and a quiz. A bonus section holds 100 Claude Code prompts, and an appendix holds config templates and a cheat sheet.</p>
{chapters}
<h2>Frequently asked questions</h2>
{questions}
<p><a href="/books/">All books by Zirlandia Milkovic</a> &middot; <a href="/">BookPilot AI</a></p>
</main>
{BODY_END}"""


def swap(page: str, start: str, end: str, block: str, old: str, new: str) -> str:
    """Replace our own marked block if present, else insert it by replacing `old` with `new`."""
    pat = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if pat.search(page):
        return pat.sub(lambda _m: block, page, count=1)
    if page.count(old) != 1:
        fail(f"expected exactly one {old!r}, found {page.count(old)}")
    return page.replace(old, new, 1)


def main() -> int:
    page = PAGE.read_text(encoding="utf-8")
    parts, faq = read_bundle(page)
    description = meta_description(page)

    head = head_block(description)
    page = swap(page, HEAD_START, HEAD_END, head, "</head>", head + "\n</head>")
    body = body_block(description, parts, faq)
    page = swap(page, BODY_START, BODY_END, body, '<div id="root"></div>', '<div id="root">' + body + "</div>")

    PAGE.write_text(page, encoding="utf-8", newline="\n")

    sm = ROOT / "sitemap-pages.xml"
    xml = sm.read_text(encoding="utf-8")
    new = re.sub(r"(<loc>" + re.escape(URL) + r"</loc><lastmod>)[^<]*(</lastmod>)", rf"\g<1>{TODAY}\g<2>", xml)
    if new != xml:
        sm.write_text(new, encoding="utf-8", newline="\n")
    print(f"static content added: {len(parts)} parts, {sum(len(p['items']) for p in parts)} chapters, {len(faq)} FAQ entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
