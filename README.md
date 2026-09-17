# BookPilot AI

**Your AI marketing manager for books.**

Upload your book. Find your readers. Create your ads. Launch your campaign.
Discover which ads actually sell.

BookPilot AI is an advertising platform for independent authors, KDP authors,
small publishers, coaches and digital-product creators. It is not a generic ad
tool with a book-shaped skin: the product starts by reading the book, and every
artefact downstream — persona, angle, creative, campaign, result — stays
attached to the hypothesis it came from.

```
Book → Reader → Marketing angle → Creative → Campaign → Sale → Learning → Optimisation
```

---

## What is here

| Path | What it is |
|---|---|
| `index.html` | Public landing page |
| `app.html` | The application shell (a buildless ES-module SPA) |
| `js/core/` | Router, auth, API client, store, metrics, formatting |
| `js/views/` | One module per screen |
| `js/data/` | The demo workspace: dataset and in-memory adapter |
| `assets/css/` | Design system, landing page, application shell |
| `track/bp.js` | The website tracking script authors install |
| `sql/` | Schema, RLS policies, seed data, database functions |
| `{privacy,terms,cookies}.html` | Legal pages |
| `netlify/functions/bookpilot-*.mjs` | The API |
| `netlify/functions/bookpilot-lib/` | Shared server modules (not deployed as functions) |
| `tests/` | Unit tests and structural security checks |

---

## Run it right now

The demo workspace needs no account, no database and no API keys:

```
python3 -m http.server 8899
open http://127.0.0.1:8899/app.html?demo=1
```

Every screen works against the sample book, every mutation is real (in memory),
and every screen carries a **DEMO DATA** badge. The app also falls back to the
demo workspace automatically when it finds no database configured — an
unconfigured deployment shows a working product with an honest label rather than
an error page.

Run the tests:

```
node --test "tests/*.test.mjs"
```

71 unit tests and structural security checks, no dependencies. There is
also an end-to-end walk of the product through the demo workspace, which
needs Playwright installed somewhere:

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
| `BOOKPILOT_OAUTH_STATE_SECRET` | Meta integration | **Secret.** Random string; signs the OAuth `state` |
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

---

## Known limitations

Stated plainly, because the alternative is a feature list that lies:

- **Image and video rendering are not implemented.** BookPilot writes the copy and
  the art direction for every creative — enough to hand to a designer or an image
  model — and the UI says so rather than showing a placeholder as finished
  artwork. The credit costs and the data model are in place for it.
- **Cover uploads take a URL**, not a file. Secure file upload with type and size
  validation is the next step; a URL works today and validates the same way.
- **AI generation is synchronous.** Netlify's function timeout is the ceiling. The
  prompts are sized to fit, and effort is tunable per prompt from the admin panel;
  a queue with polling is the right answer at higher volume.
- **Amazon Attribution import is not connected.** The tables, the separation in the
  analytics and the UI state exist; the connection does not.
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
| 2 | Amazon Attribution import, TikTok, Google and Pinterest ads |
| 3 | AI image and video rendering, automatic creative refresh, A/B testing |
| 4 | Publisher and agency accounts, team invitations, white-label |
| 5 | Cross-platform AI marketing agent |

The database and the API are shaped for these: `platform` is a column rather than
an assumption, `integrations` is provider-keyed, and attribution sources are
separated at the row level.
