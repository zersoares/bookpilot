import { normalizeAxeResults, type RawAxeResults, type RawAxeRule } from "../scan/normalize";
import type { ScanResult } from "../scan/types";

/**
 * Demo-Daten – NUR für die Entwicklung (siehe isDemoAvailable).
 * Die Struktur entspricht echter axe-core-Ausgabe und läuft durch dieselbe
 * Normalisierung wie ein echter Scan. Inhalt und Zahlen sind erfunden.
 */
export const DEMO_URL = "https://demo-shop.example/";

export function isDemoAvailable(): boolean {
  return process.env.NODE_ENV !== "production";
}

const rule = (r: Partial<RawAxeRule> & Pick<RawAxeRule, "id" | "tags" | "nodes">): RawAxeRule => ({
  help: r.id,
  helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${r.id}`,
  ...r,
});

const stub = (id: string): RawAxeRule => ({ id, tags: [], nodes: [] });

const RAW: RawAxeResults = {
  violations: [
    rule({
      id: "image-alt",
      impact: "critical",
      help: "Images must have alternative text",
      tags: ["cat.text-alternatives", "wcag2a", "wcag111", "section508"],
      nodes: [
        { target: [".product-grid > li:nth-child(1) > a > img"], html: '<img src="/media/sneaker-01.jpg" class="product-img">', failureSummary: "Fix any of the following: Element does not have an alt attribute" },
        { target: [".product-grid > li:nth-child(2) > a > img"], html: '<img src="/media/sneaker-02.jpg" class="product-img">' },
        { target: [".product-grid > li:nth-child(3) > a > img"], html: '<img src="/media/sneaker-03.jpg" class="product-img">' },
        { target: ["footer .payment-logos img"], html: '<img src="/media/paypal.svg" width="48">' },
      ],
    }),
    rule({
      id: "button-name",
      impact: "critical",
      help: "Buttons must have discernible text",
      tags: ["cat.name-role-value", "wcag2a", "wcag412", "section508"],
      nodes: [
        { target: ["header .cart-toggle"], html: '<button class="cart-toggle"><svg class="icon" aria-hidden="true"></svg></button>' },
        { target: ["header .search-open"], html: '<button class="search-open"><svg class="icon"></svg></button>' },
      ],
    }),
    rule({
      id: "label",
      impact: "critical",
      help: "Form elements must have labels",
      tags: ["cat.forms", "wcag2a", "wcag412", "wcag131", "section508"],
      nodes: [
        { target: ["#newsletter-email"], html: '<input type="email" id="newsletter-email" placeholder="E-Mail-Adresse">' },
        { target: ["#coupon"], html: '<input type="text" id="coupon" placeholder="Gutscheincode">' },
      ],
    }),
    rule({
      id: "color-contrast",
      impact: "serious",
      help: "Elements must meet minimum color contrast ratio thresholds",
      tags: ["cat.color", "wcag2aa", "wcag143"],
      nodes: [
        { target: [".hero .subline"], html: '<p class="subline">Kostenloser Versand ab 50 €</p>', failureSummary: "Element has insufficient color contrast of 2.9 (foreground color: #9aa5b8, background color: #ffffff, font size: 14.0pt, font weight: normal). Expected contrast ratio of 4.5:1" },
        { target: [".price-old"], html: '<span class="price-old">89,90 €</span>' },
        { target: [".product-grid .badge-sale"], html: '<span class="badge-sale">-20 %</span>' },
        { target: ["footer .legal a"], html: '<a href="/impressum">Impressum</a>' },
        { target: ["footer .legal a:nth-child(2)"], html: '<a href="/datenschutz">Datenschutz</a>' },
      ],
    }),
    rule({
      id: "link-name",
      impact: "serious",
      help: "Links must have discernible text",
      tags: ["cat.name-role-value", "wcag2a", "wcag244", "wcag412"],
      nodes: [
        { target: ["footer .social a:nth-child(1)"], html: '<a href="https://instagram.com/demo"><svg class="icon"></svg></a>' },
        { target: ["footer .social a:nth-child(2)"], html: '<a href="https://facebook.com/demo"><svg class="icon"></svg></a>' },
      ],
    }),
    rule({
      id: "aria-hidden-focus",
      impact: "serious",
      help: "ARIA hidden element must not be focusable or contain focusable elements",
      tags: ["cat.name-role-value", "wcag2a", "wcag412", "wcag131"],
      nodes: [{ target: ["#mobile-menu"], html: '<div id="mobile-menu" aria-hidden="true"><a href="/damen">Damen</a>…</div>' }],
    }),
    rule({
      id: "html-has-lang",
      impact: "serious",
      help: "<html> element must have a lang attribute",
      tags: ["cat.language", "wcag2a", "wcag311"],
      nodes: [{ target: ["html"], html: "<html>" }],
    }),
    rule({
      id: "heading-order",
      impact: "moderate",
      help: "Heading levels should only increase by one",
      tags: ["cat.semantics", "best-practice"],
      nodes: [
        { target: [".category-teaser h4"], html: "<h4>Neuheiten</h4>" },
        { target: [".newsletter h5"], html: "<h5>Newsletter</h5>" },
      ],
    }),
    rule({
      id: "region",
      impact: "moderate",
      help: "All page content should be contained by landmarks",
      tags: ["cat.keyboard", "best-practice"],
      nodes: [{ target: [".cookie-banner"], html: '<div class="cookie-banner">Wir verwenden Cookies …</div>' }],
    }),
  ],
  incomplete: [
    rule({
      id: "color-contrast",
      impact: undefined,
      help: "Elements must meet minimum color contrast ratio thresholds",
      tags: ["cat.color", "wcag2aa", "wcag143"],
      nodes: [{ target: [".hero h1"], html: '<h1 class="hero-title">Sommer-Kollektion</h1>', failureSummary: "Element's background color could not be determined because it overlaps a background image", impact: null }],
    }),
    rule({
      id: "video-caption",
      impact: "critical",
      help: "<video> elements must have captions",
      tags: ["cat.text-alternatives", "wcag2a", "wcag122", "section508"],
      nodes: [{ target: [".promo video"], html: '<video src="/media/promo.mp4" controls></video>' }],
    }),
  ],
  passes: [
    "document-title", "meta-viewport", "bypass", "duplicate-id-aria", "aria-valid-attr", "aria-valid-attr-value", "aria-roles",
    "aria-allowed-attr", "aria-required-attr", "tabindex", "valid-lang", "list", "listitem", "landmark-unique", "frame-title",
    "select-name", "input-button-name", "page-has-heading-one", "empty-heading", "nested-interactive", "link-in-text-block",
  ].map(stub),
  inapplicable: [
    "area-alt", "object-alt", "marquee", "blink", "meta-refresh", "server-side-image-map", "dlitem", "definition-list",
    "td-has-header", "th-has-data-cells", "scope-attr-valid", "input-image-alt", "accesskeys", "no-autoplay-audio",
  ].map(stub),
};

export function buildDemoScan(now: Date = new Date()): ScanResult {
  return normalizeAxeResults(RAW, {
    url: DEMO_URL,
    finalUrl: DEMO_URL,
    scannedAt: now.toISOString(),
    axeVersion: "demo",
    ruleset: "Demo-Daten",
    viewport: { width: 1280, height: 800 },
    pageTitle: "Demo-Shop – Startseite",
    pageLang: "",
    isDemo: true,
    areaBySelector: new Map([
      [".product-grid > li:nth-child(1) > a > img", "main"],
      [".product-grid > li:nth-child(2) > a > img", "main"],
      [".product-grid > li:nth-child(3) > a > img", "main"],
      ["footer .payment-logos img", "footer"],
      ["header .cart-toggle", "header"],
      ["header .search-open", "header"],
      ["#newsletter-email", "form"],
      ["#coupon", "form"],
      [".hero .subline", "main"],
      [".price-old", "main"],
      [".product-grid .badge-sale", "main"],
      ["footer .legal a", "footer"],
      ["footer .legal a:nth-child(2)", "footer"],
      ["footer .social a:nth-child(1)", "footer"],
      ["footer .social a:nth-child(2)", "footer"],
      ["#mobile-menu", "nav"],
      ["html", "page"],
      [".category-teaser h4", "main"],
      [".newsletter h5", "footer"],
      [".cookie-banner", "dialog"],
      [".hero h1", "main"],
      [".promo video", "main"],
    ]),
  });
}
