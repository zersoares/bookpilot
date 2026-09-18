# BookPilot

**Write the book. Then sell it.**

Two halves of one product, sharing one account, one credit balance and one
database:

**Book Builder** turns an idea into a finished, designed, publication-ready
book. Positioning, structure, manuscript, figures, interior design, cover,
publication check, and files an author can actually send to a printer.

**BookPilot AI** is the advertising half: it reads the finished book, finds its
readers, writes the campaign and reports what actually sold.

```
Idea → Positioning → Blueprint → Manuscript → Figures → Design → Cover → PDF/EPUB/DOCX
                                                                            │
Book → Reader → Marketing angle → Creative → Campaign → Sale → Learning ←────┘
```

Neither half is a wrapper around a chat box. The Book Builder keeps a **Book
Bible** that every generation reads first, which is what stops chapter nine
contradicting chapter two; and the advertising side keeps every creative
attached to the hypothesis it came from.

---

## What is here

| Path | What it is |
|---|---|
| `index.html` | Public landing page |
| `app.html` | The application shell (a buildless ES-module SPA) |
| `js/core/` | Router, auth, API clients, store, metrics, formatting |
| `js/views/` | One module per screen |
| `js/views/builder/` | The Book Builder's screens |
| `js/doc/` | **The document engine** — typesetting, PDF, EPUB, DOCX, HTML |
| `js/data/` | The demo workspace: datasets and in-memory adapters |
| `assets/css/` | Design system, landing page, application shell |
| `track/bp.js` | The website tracking script authors install |
| `sql/` | Schema, RLS policies, seed data, database functions |
| `{privacy,terms,cookies}.html` | Legal pages |
| `netlify/functions/bookpilot-*.mjs` | The advertising API |
| `netlify/functions/bookbuilder-*.mjs` | The authoring API, agents and exporter |
| `netlify/functions/bookpilot-lib/` | Shared server modules (not deployed as functions) |
| `tests/` | Unit tests and structural security checks |

---

## Run it right now

The demo workspace needs no account, no database and no API keys:

```
python3 -m http.server 8899
open http://127.0.0.1:8899/app.html?demo=1#/studio    # the Book Builder
open http://127.0.0.1:8899/app.html?demo=1#/overview  # the advertising side
```

The sample book — *The 17 Principles of Human Power* — has five written
chapters, a blueprint for the rest, a Book Bible, figures, a designed interior
and a cover. **Its exports are real**: the demo runs the actual PDF, EPUB, DOCX
and HTML writers in the browser, from the same manuscript, so the file that
downloads is the file the server would have built.

Every screen works against the sample book, every mutation is real (in memory),
and every screen carries a **DEMO DATA** badge. The app also falls back to the
demo workspace automatically when it finds no database configured — an
unconfigured deployment shows a working product with an honest label rather than
an error page.

Run the tests:

```
node --test "tests/*.test.mjs"
```

144 unit tests and structural security checks, no dependencies. They cover
the layout guarantees, the container formats, the demo workspace and the row
level security on every table. There is also an end-to-end walk of the
advertising side through the demo workspace, which needs Playwright installed
somewhere:

```
python3 -m http.server 8899 &
node tests/browser/flows.mjs
```

It drives 24 flows — signup, add and edit a book, the analysis → personas →
angles sequence, the creative factory, the ten-step campaign builder,
campaign analysis, budget advice, the advisor, billing, privacy settings,
notifications, the not-found route and the demo reset — and fails on any
unexpected console error.

---

## Why there is no build step

This repository is a static site with no `package.json` and no bundler; Netlify
publishes it as-is. Introducing a build for one subdirectory would change how the
entire site deploys, so BookPilot is written to fit:

- **Front end**: plain ES modules and CSS, served directly. No framework, no
  transpile, no lockfile.
- **Back end**: Netlify Functions as plain ESM with **zero dependencies**.
  Anthropic, Stripe, Meta and Supabase are all REST APIs, called over `fetch`
  the same way the repository's existing `claude-proxy` function does.

The trade is real and worth naming: no JSX, no typed SDK clients, and HTML is
built by string templates. The mitigation for the last one is that `js/core/dom.js`
escapes every interpolated value by default, with `raw()` as the single explicit
escape hatch — and a test asserts it.

---

## The document engine

`js/doc/` is the part with no equivalent in an ad tool, so it is worth
describing properly. It sets a book — no dependency, no headless browser, no
LaTeX.

| Module | What it does |
|---|---|
| `markdown.js` | The restricted manuscript format, parsed to blocks |
| `metrics.js` | Adobe AFM widths for the PDF base-14 faces |
| `themes.js` | Eight interior designs, page geometry, margins and gutters |
| `layout.js` | Line breaking, pagination, running heads, folios, contents |
| `figures.js` | Drawn figures — diagrams, timelines, tables, checklists |
| `pdf.js` | The PDF writer: objects, xref, outline, fonts |
| `epub.js` | EPUB 3, with an EPUB 2 NCX alongside |
| `docx.js` | Office Open XML, as real Word styles |
| `zip.js` / `deflate.js` | The container, and compression |
| `render-html.js` | The same pages as HTML — the in-app previewer |

Four properties are enforced rather than hoped for, and `tests/doc-engine.test.mjs`
fails when any of them stops being true:

- **Text never overflows the measure.** Lines are broken against the same font
  metrics the reader draws with, and a word longer than the measure is broken
  rather than allowed to run off the page.
- **Text never overlaps a figure.** A figure is one atom; if it does not fit in
  what is left of the page it moves down whole.
- **No widows and no orphans.** A paragraph never leaves one line at the foot of
  a page or carries one alone to the top.
- **A page never ends on a heading.**

### Why it runs in the browser too

The engine is plain ES modules with no Node imports, so the page previewer
imports the same files the exporter does. The preview is not a picture of the
page — it is the page, drawn with a different pen. That is also why compression
is passed in rather than imported: the server hands it Node's zlib, and the
browser falls back to a stored-block DEFLATE encoder that is valid but does not
compress.

### The trade

Type is set in the PDF base-14 faces (Times and Helvetica), because a repository
with no build step has nowhere to subset a font from and no way to embed one.
That sets a book that looks like a book, and it was the honest price of shipping
an exporter that works rather than one that is promised.

---

## Setup

### 1. Database

Run the SQL in order against a Supabase (or plain PostgreSQL with
Supabase-compatible `auth` schema) project:

```
sql/001_schema.sql    -- tables, indexes, triggers
sql/002_rls.sql       -- row level security (run this; it is not optional)
sql/003_seed.sql      -- plans, credit costs, flags, settings
sql/004_functions.sql -- credit accounting, plan changes, deletion, admin stats
sql/005_hardening.sql -- search_path pinning, security_invoker view, column grants
sql/006_book_builder.sql      -- projects, chapters, versions, figures, covers, exports
sql/007_book_builder_rls.sql  -- row level security for all of the above
sql/008_book_builder_seed.sql -- design themes, templates, credit costs, flags
```

To make yourself an admin:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

### 2. Environment variables

Set these on the deployment. Only the first two are needed to sign in; everything
else degrades gracefully when absent.

| Variable | Needed for | Notes |
|---|---|---|
| `SUPABASE_URL` | Everything | Public |
| `SUPABASE_ANON_KEY` | Everything | Public by design; RLS protects the data |
| `SUPABASE_SERVICE_ROLE_KEY` | Credits, webhooks, tracking, admin | **Secret.** Bypasses RLS |
| `ANTHROPIC_API_KEY` | AI generation | **Secret** |
| `STRIPE_SECRET_KEY` | Checkout and portal | **Secret** |
| `STRIPE_WEBHOOK_SECRET` | Applying paid plans | **Secret** |
| `META_APP_ID` | Meta integration | |
| `META_APP_SECRET` | Meta integration | **Secret** |
| `META_REDIRECT_URI` | Meta integration | `https://yoursite/api/bp-meta/callback` |
| `PINTEREST_APP_ID` | Pinterest sync | |
| `PINTEREST_APP_SECRET` | Pinterest sync | **Secret** |
| `PINTEREST_REDIRECT_URI` | Pinterest sync | `https://yoursite/api/bp-pinterest/callback` |
| `TIKTOK_APP_ID` | TikTok sync | |
| `TIKTOK_APP_SECRET` | TikTok sync | **Secret** |
| `TIKTOK_AUTH_URL` | TikTok sync | The app's "Advertiser authorization URL" from the TikTok developer portal (My Apps, the app, Basic Information). It carries the app id and redirect address; only `state` is set at run time |
| `BOOKPILOT_OAUTH_STATE_SECRET` | Meta, Pinterest and TikTok | **Secret.** Random string; signs the OAuth `state` |
| `BOOKPILOT_SITE_URL` | Redirects | Defaults to Netlify's `URL` |
| `BOOKPILOT_ALLOWED_ORIGINS` | Extra origins | Comma-separated, optional |

Then set each plan's `stripe_price_id` in **Admin → Plans**, and enable the
matching feature flags. A flag without its credentials leaves the UI showing
"Connect integration" — it never enables a control that would fail.

### 3. Stripe webhook

Point a webhook at `https://yoursite/api/bp-stripe-webhook` for
`checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted` and `invoice.payment_failed`.

---

## The API

| Function | Path | Purpose |
|---|---|---|
| `bookpilot-api` | `/api/bp/*` | Books, creatives, campaigns, analytics, notifications, GDPR export and deletion |
| `bookpilot-ai` | `/api/bp-ai/*` | Analysis, personas, angles, copy, creatives, scoring, campaign analysis, budget, advisor |
| `bookpilot-meta` | `/api/bp-meta/*` | OAuth, ad accounts, campaign push, launch/pause, insights sync |
| `bookpilot-billing` | `/api/bp-billing/*` | Checkout and customer portal |
| `bookpilot-stripe-webhook` | `/api/bp-stripe-webhook` | The only place a paid plan is granted |
| `bookpilot-track` | `/api/bp-track` | Website event collector (called cross-origin) |
| `bookpilot-admin` | `/api/bp-admin/*` | Admin dashboard |
| `bookbuilder-api` | `/api/bb/*` | Book projects, blueprint, Bible, figures, covers, versions |
| `bookbuilder-ai` | `/api/bb-ai/*` | The eleven authoring agents |
| `bookbuilder-export` | `/api/bb-export/*` | PDF, EPUB, DOCX and HTML, built on request |

---

## The authoring agents

Eleven specialists rather than one prompt, each with its own system prompt,
schema and idea of what "good" means. They live in
`netlify/functions/bookpilot-lib/book-prompts.js`, and the `ai_prompts` table
overrides any of them at runtime.

| Agent | Does |
|---|---|
| Book Architect | Positioning, the blueprint, the Book Bible |
| Book Writer | Chapters, revisions, continuations |
| Editorial Director | Per-chapter review with actionable notes |
| Researcher | Separates fact from interpretation; says where to look |
| Visual Director | Which figures earn their page, and their content |
| Image Director | Prompts for the figures that need a renderer |
| Cover Designer | Complete cover specifications, and a craft review |
| Quality Controller | The publication check, over the whole book |
| Marketing Director | The campaign, written from the finished book |

Every one of them receives the Book Bible. Two rule sets exist and a prompt
inherits the one that fits what it writes: the advertising rules
(`bookpilot-lib/safety.js`) and the authoring rules (`BOOK_RULES`). The
Marketing Director inherits both, because what it produces is advertising.
`tests/security.test.mjs` fails if any prompt inherits neither.

---

## Security model

**Postgres is the access boundary, not the application.** The API talks to
PostgREST using *the caller's own JWT*, so the row-level security policies in
`002_rls.sql` decide what a request can see. A mistake in a query filter cannot
leak another account's rows, because the database would refuse to return them.

### Where the service role is used

The service-role key bypasses RLS, so its use is deliberately narrow:

| Use | Why it cannot use the caller's token |
|---|---|
| Credit accounting (`bp_consume_credits`) | Users must not be able to change their own balance |
| Stripe webhook | No user session exists on a webhook |
| Tracking collector | Authenticates a *site key*, not a signed-in user |
| Writing `performance_metrics` | Clients have SELECT only, so results can't be fabricated |
| Reading and writing `integrations` | Clients have no grant on the token table at all |
| Prompt and reference-data loading | Prompts are admin-only |
| Admin reads | Cross-account by definition; gated on `role = 'admin'` read through the caller's own token first |

### Other properties

- **OAuth tokens** live in `integrations`, which `authenticated` cannot touch.
  The UI reads connection state from a view that selects no token columns.
- **The OAuth `state` parameter is HMAC-signed**, so a third party cannot attach
  their ad account to someone else's BookPilot account.
- **The Stripe webhook verifies signatures** and rejects replays on timestamp age.
- **Credit spending is atomic** — one statement checks the balance and decrements
  it, so two concurrent generations cannot both spend the last credits. A failed
  generation is refunded automatically.
- **Every write goes through an allow-list** (`validate.js`), which is what stops
  a crafted profile update setting `role`, `plan_id` or `ai_credits`.
- **URLs are scheme-checked**; `javascript:` and `data:` never survive validation,
  because these values become links and Meta ad destinations.
- **Errors are mapped to plain language.** An `OAuthException 190` reaches the log,
  and "We couldn't connect your Meta account" reaches the author.
- **The audit log is append-only** through the client API.

---

## What the product will not do

These are product decisions, enforced in code, not marketing copy:

1. **It does not spend money on its own.** Campaigns are created paused on Meta;
   launching is a separate call with an explicit confirmation that names the daily
   figure. The advisor recommends; it never acts.
2. **It does not claim to read Amazon sales.** Amazon does not report per-ad sales
   to third-party tools. Amazon Attribution data can be imported where an author
   has an eligible account, and it stays labelled and separated from
   website-attributed sales — never summed into one number.
3. **It does not fabricate.** Every prompt inherits one set of rules: no invented
   awards, bestseller status, review quotes, sales figures, endorsements or
   guaranteed outcomes; no targeting on protected characteristics; "Insufficient
   data" instead of a plausible invention.
4. **It does not predict which ad will sell.** Creative scores are labelled
   *predicted quality* — a judgement about hook, clarity and audience fit before
   the ad runs. Only campaign data shows what sells, which is why the analytics
   and the advisor exist.
5. **It does not show a rate it doesn't know.** A rate with a zero denominator is
   `null` and renders as **N/A**; a campaign with no delivery renders "not enough
   data yet". A CTR of 0.0% on an ad with no impressions is a lie that makes an
   author pause a creative that never ran.
6. **It does not call something a winner on thin evidence.** The 🏆 badge requires
   enough delivery to mean it, and every AI judgement carries a confidence level.
7. **It does not simulate an integration.** Where credentials are missing, the API
   reports the capability as unavailable and the UI offers "Connect integration"
   or the clearly-labelled demo workspace.
8. **It does not fabricate a citation.** The Research Agent has no internet
   access and says so: it separates fact from interpretation and names the kind
   of source that would settle a claim, rather than producing a bibliography of
   plausible-looking papers. Every source it records starts `unverified`, and the
   publication check keeps asking until the author says otherwise.
9. **It does not invent the author.** No credentials, clients, results or
   endorsements. Where the book needs the author's own material, the manuscript
   carries a marked `[author: ...]` placeholder, and the publication check counts
   the ones still outstanding.
10. **It does not show artwork that does not exist.** Drawn figures are rendered
    by the layout engine and always work. An illustration with no image carries
    its art direction and its prompt, is labelled as unrendered, and is left out
    of the exported book rather than shown as an empty frame.
11. **It does not overwrite a draft.** Every content change writes the previous
    version first — including the ones the AI makes — and a revision arrives as a
    proposal beside the author's text until they accept it.
12. **It does not invent an ISBN**, a publisher or a printing history. The
    copyright page and the EPUB carry a marked placeholder.
13. **Publication readiness is an editorial judgement**, stated as one. It is not
    a claim about copyright, rights clearance, legal compliance or reception, and
    the screen that shows it says so.

---

## Known limitations

Stated plainly, because the alternative is a feature list that lies:

- **Book illustration rendering is not implemented.** Drawn figures — diagrams,
  processes, timelines, comparisons, tables, checklists, quote cards — are set by
  the layout engine and are finished work. Illustrations and conceptual images
  are not: the Image Director writes the art direction and the prompt, the figure
  is labelled as having no image, and it is left out of the export. The
  `ImageService` seam and the credit costs are in place for a renderer.
- **A figure cannot yet take an image the author already has.** Attaching artwork
  by URL is the next step and is the same validation path covers already use.
- **Type is set in the PDF base-14 faces.** See "The document engine" above for
  why, and what it would take to change.
- **Export is synchronous.** A 200-page book is well inside the function
  timeout; a 600-page one with hundreds of figures has not been measured.
- **Image and video rendering are not implemented.** BookPilot writes the copy and
  the art direction for every creative — enough to hand to a designer or an image
  model — and the UI says so rather than showing a placeholder as finished
  artwork. The credit costs and the data model are in place for it.
- **Cover uploads take a URL**, not a file. Secure file upload with type and size
  validation is the next step; a URL works today and validates the same way.
- **AI generation is synchronous.** Netlify's function timeout is the ceiling. The
  prompts are sized to fit, and effort is tunable per prompt from the admin panel;
  a queue with polling is the right answer at higher volume.
- **Amazon Attribution is imported from CSV, not connected.** Reading Attribution
  data through Amazon's API needs approved Amazon Ads API access, which BookPilot
  does not have. Instead, an author downloads a report from the Attribution console
  and imports it on the Attribution screen (`js/core/amazon-report.js` parses it in
  the browser; `bookpilot-lib/amazon.js` re-validates it on the server). Columns are
  guessed and shown for correction, totals rows are skipped, and re-importing a
  campaign-day replaces it (migration 010). Amazon-attributed figures are stored and
  reported apart from Meta and website numbers and never summed with them.
- **TikTok, Google and Pinterest Ads are a tracked link plus a report import, not
  connections.** Each platform's API needs an approved developer app or token, and
  TikTok ads also need a video file BookPilot cannot make. So an author runs the ads on the platform; BookPilot builds the
  tracked destination URL (the campaign id in `utm_campaign`, which website
  tracking credits sales to) and imports a daily campaign-level CSV report
  (`js/core/ad-report.js` holds each platform's column names; the parsing is shared
  with the Amazon import in `report-parse.js`; `bookpilot-lib/platform-report.js`
  re-validates on the server). Imports create `external_only` campaigns that no
  screen offers to launch, pause or sync. Re-importing a campaign-day replaces it
  (migrations 011, 012, 013). Reach is not imported: it cannot be summed across ad
  groups. Google's Conversions count every conversion action an account tracks, not
  only purchases, and fractional conversions are rounded per day; the screen says
  so. Analytics shows Meta, TikTok, Google and Pinterest side by side and warns that their
  conversions can overlap. Adding another platform is a row in `PLATFORMS`
  (server), `PLATFORM_REPORTS` (browser) and a migration for its source value.
- **Pinterest also has a read-only API sync, written but never run against a live
  Pinterest account.** It needs an approved Pinterest app. The client asks for one
  scope (`ads:read`) and calls only ad accounts, campaigns and campaign analytics
  by day (`bookpilot-lib/pinterest.js`, `bookpilot-pinterest.mjs`, migration 014).
  It was built from Pinterest's published OpenAPI description and tested with the
  network stubbed, so the first real sync is the real test. Each Pinterest campaign
  becomes, or is matched to, an `external_only` BookPilot campaign, by Pinterest id
  first and then by an unambiguous name (which claims a campaign a CSV import
  created rather than duplicating it). Nothing is ever written to Pinterest. The
  CSV import stays as the fallback. Pinterest only supports revoking tokens issued
  to system users, so "Disconnect" clears BookPilot's copy and the author removes
  access in their Pinterest settings.
- **TikTok has a read-only API sync too, equally unrun against a live account.** It
  needs an approved TikTok developer app whose permissions are limited to Reporting
  and Ad Account Information (`bookpilot-lib/tiktok.js`, `bookpilot-tiktok.mjs`; no
  migration, the provider was already allowed). Differences from Pinterest, all from
  TikTok's documentation: the authorization URL is generated in the developer portal
  and supplied as configuration; the callback carries `auth_code`; the access token
  is long-term (no refresh) and Disconnect really revokes it; a daily report spans at
  most 30 days, so longer pulls are windowed; and campaign names come from the report
  itself, so the broader Ads Management permission is not needed. Because campaign
  status is not requested, it is inferred from spend in the last three days.
  Purchases are `complete_payment` and their value is `total_complete_payment_rate`
  (TikTok's name for "Purchase value (website)"). Campaign matching is shared with
  Pinterest (`sync-plan.js`).
- **Meta persona targeting passes age and geography only.** Interest terms are
  carried as a note on the ad set for the operator to confirm in Ads Manager,
  rather than guessed at against Meta's interest IDs — a wrong ID spends money on
  the wrong audience silently.
- **Team members** are modelled (`organizations`, `organization_members`, and the
  RLS predicates honour them) but there is no invitation UI yet.
- **The legal pages are complete drafts with marked placeholders**, not reviewed
  legal documents. They describe what the software actually does; the operating
  entity's details and a qualified review are required before launch.

---

## Before you launch

- Fill in every highlighted placeholder in `privacy.html`, `terms.html` and
  `cookies.html`, and have them reviewed. They describe what the software
  actually does, which is the hard part; the operating entity's details and a
  qualified review are the rest.
- Set the canonical URL and `og:url` in `index.html`, and `BOOKPILOT_SITE_URL`,
  to the domain this ends up on. They were removed rather than left pointing
  at a host this repository no longer belongs to.
- Narrow `connect-src` in the CSP (in `netlify.toml`) from `https:` to your
  Supabase project URL.
- Add a `sitemap.xml` and `robots.txt` for the landing page. The app carries
  `noindex` and should stay out of both.
- Set each plan's `stripe_price_id` and enable the feature flags whose
  credentials you have configured.

## Roadmap

| Phase | Work |
|---|---|
| 1 | Book illustration rendering; author-supplied artwork for figures and covers |
| 2 | API connections for Amazon Attribution and Google Ads (the Pinterest and TikTok read-only syncs are written, awaiting approved apps) |
| 3 | AI image and video rendering, automatic creative refresh, A/B testing |
| 4 | Publisher and agency accounts, team invitations, white-label |
| 5 | Cross-platform AI marketing agent |

The database and the API are shaped for these: `platform` is a column rather than
an assumption, `integrations` is provider-keyed, and attribution sources are
separated at the row level.
