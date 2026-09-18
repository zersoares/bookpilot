// The mockup engine.
//
// Turns the author's real cover and real laid-out interior pages into
// soft-studio product shots: an open hardcover, a softcover booklet, a
// standing book, a stack, a trio. It is a small 3D renderer on a 2D
// canvas — book geometry, a camera, textured quads warped through a
// perspective projection, cast shadows and paper shading — with no
// dependencies, because the app has no build step.
//
// Nothing here is a stock photograph or a PSD. The pages on the spread
// are the pages the document engine laid out, so what the author sees
// on the table is the book they are about to print. (It is not a photo
// of a printed copy, and the UI says so.)
//
// Everything is proportional to the canvas width, so a thumbnail and a
// 2400px export come from the same code path and cannot drift apart.

import { paletteOf, contrastOn } from "./cover-render.js";

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

// =====================================================================
// Curated backdrop palettes
// =====================================================================

export const PALETTES = [
  { id: "terracotta", name: "Ivory & Terracotta", top: "#f4ebe0", bottom: "#d9bfa8", glow: "#fff4e4", shadow: "#4f2c1c", dark: false, swatch: ["#f4ebe0", "#c98a6b"] },
  { id: "midnight", name: "Midnight & Gold", top: "#1c2a4d", bottom: "#090e1c", glow: "#d9b45f", shadow: "#000000", dark: true, swatch: ["#1c2a4d", "#d9b45f"] },
  { id: "forest", name: "Forest & Brass", top: "#2a4d41", bottom: "#0f221c", glow: "#c9a256", shadow: "#010806", dark: true, swatch: ["#2a4d41", "#c9a256"] },
  { id: "graphite", name: "Graphite & Rose", top: "#3d3b41", bottom: "#161519", glow: "#e6b0a8", shadow: "#000000", dark: true, swatch: ["#3d3b41", "#e6b0a8"] },
  { id: "sage", name: "Sage Linen", top: "#e9ede2", bottom: "#bfcbb4", glow: "#ffffff", shadow: "#27351f", dark: false, swatch: ["#e9ede2", "#8fa383"] },
  { id: "champagne", name: "Champagne Studio", top: "#f8f3ea", bottom: "#e4d6bd", glow: "#ffffff", shadow: "#443620", dark: false, swatch: ["#f8f3ea", "#c9b083"] },
];

export function paletteById(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
}

// =====================================================================
// Small helpers
// =====================================================================

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function rgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
}
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };

function mix(hexA, hexB, t) {
  const a = rgb(hexA), b = rgb(hexB);
  const hx = (i) => Math.round(lerp(a[i], b[i], t)).toString(16).padStart(2, "0");
  return `#${hx(0)}${hx(1)}${hx(2)}`;
}

/**
 * Fill a soft shape. ctx.filter is not available everywhere, so blur is
 * done the portable way: draw the shape far off-canvas and let its
 * shadow fall back into view.
 */
function softShape(ctx, pathFn, color, blur, alpha = 1) {
  const OFF = 60000;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = OFF;
  ctx.shadowOffsetY = 0;
  ctx.translate(-OFF, 0);
  ctx.beginPath();
  pathFn();
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
}

function polygon(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function hull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

let grainTile = null;
function grain() {
  if (grainTile) return grainTile;
  const c = canvasOf(256, 256);
  const x = c.getContext("2d");
  const img = x.createImageData(256, 256);
  // A fixed pseudo-random sequence: the same book must render the same
  // image twice, or a "regenerate" would look like a change.
  let seed = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = (seed >>> 24) & 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

// =====================================================================
// Textures: the real cover, spine, back and pages
// =====================================================================

const TYPE_STACK = {
  serif: "'Times New Roman', Georgia, serif",
  sans: "'Helvetica Neue', Arial, sans-serif",
  condensed: "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
  display: "'DM Serif Display', Georgia, serif",
};

const PDF_FAMILY = {
  "Times-Roman": "'Times New Roman', Times, serif",
  "Times-Bold": "'Times New Roman', Times, serif",
  "Times-Italic": "'Times New Roman', Times, serif",
  "Times-BoldItalic": "'Times New Roman', Times, serif",
  Helvetica: "Helvetica, Arial, sans-serif",
  "Helvetica-Bold": "Helvetica, Arial, sans-serif",
  "Helvetica-Oblique": "Helvetica, Arial, sans-serif",
  "Helvetica-BoldOblique": "Helvetica, Arial, sans-serif",
};

function wrapLines(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function letterSpaced(ctx, spacing) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
}

/** Cover-fit an image into a box, like object-fit: cover. */
function drawCovered(ctx, img, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * The front cover, drawn from the same specification the Cover Studio
 * previews — palette, type style, alignment, rule — so the mockup shows
 * the cover the author approved.
 */
export function paintCover(cover, fallback, w, h, image = null) {
  const pal = paletteOf(cover);
  const layout = cover?.layout || {};
  const c = canvasOf(w, h);
  const x = c.getContext("2d");
  x.fillStyle = pal.background;
  x.fillRect(0, 0, w, h);
  if (image) {
    x.globalAlpha = 0.86;
    drawCovered(x, image, w, h);
    x.globalAlpha = 1;
  }

  const scale = w / 220;
  const pad = w * 0.09;
  const raw = String(cover?.title_text || fallback?.title || "Untitled");
  const title = layout.title_case === "upper" ? raw.toUpperCase() : layout.title_case === "lower" ? raw.toLowerCase() : raw;
  const align = layout.title_align || "center";
  const stack = TYPE_STACK[layout.type_style] || TYPE_STACK.serif;
  const titleSize = (raw.length > 34 ? 19 : raw.length > 20 ? 23 : 28) * scale;
  const weight = layout.type_style === "display" ? 400 : 600;
  const maxW = w - pad * 2;

  x.textBaseline = "alphabetic";
  x.font = `${weight} ${titleSize}px ${stack}`;
  const titleLines = wrapLines(x, title, maxW);
  const titleH = titleLines.length * titleSize * 1.12;

  const subSize = 10 * scale;
  x.font = `400 ${subSize}px ${stack}`;
  const subLines = cover?.subtitle_text ? wrapLines(x, cover.subtitle_text, maxW) : [];
  const ruleBlock = layout.rule ? 2 * scale + 2 * (w * 0.07 * 0.55) : 0;
  const blockH = titleH + ruleBlock + (subLines.length ? subLines.length * subSize * 1.34 + w * 0.05 : 0);

  const position = layout.title_position;
  let top;
  if (position === "top" || position === "upper") top = pad;
  else if (position === "lower" || position === "bottom") top = h - pad - w * 0.16 - blockH;
  else top = (h - blockH) / 2;

  const anchor = align === "left" ? pad : align === "right" ? w - pad : w / 2;
  x.textAlign = align === "left" ? "left" : align === "right" ? "right" : "center";

  let y = top;
  x.fillStyle = pal.title;
  x.font = `${weight} ${titleSize}px ${stack}`;
  letterSpacing0(x);
  for (const line of titleLines) {
    y += titleSize * 1.12;
    x.fillText(line, anchor, y - titleSize * 0.22);
  }
  if (layout.rule) {
    y += w * 0.07 * 0.55;
    const rw = maxW * 0.34;
    const rx = align === "left" ? pad : align === "right" ? w - pad - rw : (w - rw) / 2;
    x.fillStyle = pal.accent;
    x.fillRect(rx, y, rw, Math.max(2, 2 * scale));
    y += Math.max(2, 2 * scale) + w * 0.07 * 0.55;
  }
  if (subLines.length) {
    y += w * 0.03;
    x.fillStyle = pal.subtitle;
    x.globalAlpha = 0.88;
    x.font = `400 ${subSize}px ${stack}`;
    for (const line of subLines) { y += subSize * 1.34; x.fillText(line, anchor, y - subSize * 0.3); }
    x.globalAlpha = 1;
  }

  if (cover?.author_text) {
    const authorSize = 11 * scale;
    x.font = `400 ${authorSize}px ${stack}`;
    x.fillStyle = pal.author;
    x.globalAlpha = 0.9;
    letterSpaced(x, authorSize * 0.06);
    x.textAlign = align === "left" ? "left" : align === "right" ? "right" : "center";
    x.fillText(String(cover.author_text).toUpperCase(), anchor, h - pad);
    letterSpacing0(x);
    x.globalAlpha = 1;
  }
  return c;
}

function letterSpacing0(ctx) { if ("letterSpacing" in ctx) ctx.letterSpacing = "0px"; }

/** The spine: accent ground, title reading top to bottom. */
export function paintSpine(cover, fallback, w, h) {
  const pal = paletteOf(cover);
  const c = canvasOf(w, h);
  const x = c.getContext("2d");
  x.fillStyle = pal.accent;
  x.fillRect(0, 0, w, h);
  const ink = contrastOn(pal.accent);
  const label = String(cover?.spine_text || cover?.title_text || fallback?.title || "").toUpperCase();
  x.save();
  x.translate(w / 2, h / 2);
  x.rotate(Math.PI / 2);
  x.fillStyle = ink;
  x.textAlign = "center";
  x.textBaseline = "middle";
  let size = Math.min(w * 0.42, 60);
  x.font = `600 ${size}px ${TYPE_STACK.sans}`;
  letterSpaced(x, size * 0.1);
  const maxLen = h * 0.84;
  while (x.measureText(label).width > maxLen && size > 8) {
    size -= 1;
    x.font = `600 ${size}px ${TYPE_STACK.sans}`;
    letterSpaced(x, size * 0.1);
  }
  x.fillText(label, 0, 0);
  x.restore();
  return c;
}

/** The back cover: ground colour and the blurb. */
export function paintBack(cover, fallback, w, h) {
  const pal = paletteOf(cover);
  const c = canvasOf(w, h);
  const x = c.getContext("2d");
  x.fillStyle = pal.background;
  x.fillRect(0, 0, w, h);
  const pad = w * 0.11;
  const size = w * 0.038;
  x.fillStyle = pal.subtitle;
  x.globalAlpha = 0.92;
  x.font = `400 ${size}px ${TYPE_STACK.serif}`;
  x.textBaseline = "alphabetic";
  const lines = wrapLines(x, cover?.back_blurb || "", w - pad * 2).slice(0, 18);
  let y = h * 0.12;
  for (const line of lines) { x.fillText(line, pad, y); y += size * 1.5; }
  x.globalAlpha = 1;
  return c;
}

const PAPER = "#fbf8f1";

/** One interior page, drawn from the layout engine's own drawing ops. */
export function paintPage(page, trim, width) {
  const s = width / trim.width;
  const c = canvasOf(width, trim.height * s);
  const x = c.getContext("2d");
  x.fillStyle = PAPER;
  x.fillRect(0, 0, c.width, c.height);
  if (!page) return c;
  x.textBaseline = "alphabetic";
  const col = (v, fallback = "rgb(30,30,34)") =>
    v ? `rgb(${Math.round(v[0] * 255)},${Math.round(v[1] * 255)},${Math.round(v[2] * 255)})` : fallback;
  for (const op of page.items || []) {
    if (op.op === "rect") {
      x.fillStyle = col(op.fill);
      x.fillRect(op.x * s, op.y * s, op.w * s, op.h * s);
    } else if (op.op === "line") {
      x.strokeStyle = col(op.color);
      x.lineWidth = Math.max(0.5, (op.width || 0.6) * s);
      x.beginPath(); x.moveTo(op.x1 * s, op.y1 * s); x.lineTo(op.x2 * s, op.y2 * s); x.stroke();
    } else if (op.op === "text" && op.text) {
      const bold = /Bold/.test(op.font);
      const italic = /Italic|Oblique/.test(op.font);
      x.font = `${italic ? "italic " : ""}${bold ? "700 " : "400 "}${op.size * s}px ${PDF_FAMILY[op.font] || PDF_FAMILY["Times-Roman"]}`;
      x.fillStyle = col(op.color);
      if ("wordSpacing" in x) x.wordSpacing = `${(op.wordSpacing || 0) * s}px`;
      x.fillText(op.text, op.x * s, op.y * s);
    }
    // Images inside pages are left out: a cross-origin picture would
    // taint the canvas and make every export fail.
  }
  if ("wordSpacing" in x) x.wordSpacing = "0px";
  return c;
}

/** Stacked paper edges: boards at either end, fine page lines between. */
function paintEdge(length, thick, boardFrac, boardColor) {
  const c = canvasOf(thick, length);
  const x = c.getContext("2d");
  x.fillStyle = "#efe7d6";
  x.fillRect(0, 0, thick, length);
  const boardW = thick * boardFrac;
  // Page lines are a hint, not a pattern: fine stripes on a face seen
  // almost edge-on break into moiré dashes, so keep them broad and faint.
  x.fillStyle = "rgba(120,100,70,0.05)";
  for (let px = boardW; px < thick - boardW; px += 8) x.fillRect(px, 0, 3, length);
  x.fillStyle = boardColor;
  x.fillRect(0, 0, boardW, length);
  x.fillRect(thick - boardW, 0, boardW, length);
  return c;
}

// =====================================================================
// Camera and textured-quad warping
// =====================================================================

function makeCamera({ W, H, yaw = 0, pitch = 60, f = 5200, zoom = 1, cx = W / 2, cy = H / 2 }) {
  const th = (90 - pitch) * DEG;
  const ct = Math.cos(th), st = Math.sin(th);
  const cyw = Math.cos(yaw * DEG), syw = Math.sin(yaw * DEG);
  const view = (p) => {
    const X = p[0] * cyw - p[1] * syw;
    const Y = p[0] * syw + p[1] * cyw;
    return [X, Y * ct + p[2] * st, -Y * st + p[2] * ct];
  };
  return {
    project(p) {
      const [vx, vy, vd] = view(p);
      const s = (f / (f - vd)) * zoom;
      return [cx + vx * s, cy - vy * s, vd];
    },
    /** Is a face with this outward normal turned toward the lens? */
    facing(n) { return view([n[0], n[1], n[2]])[2] > 0.001; },
    /** Depth of a point, for painter's ordering. */
    depth(p) { return view(p)[2]; },
  };
}

function drawTexTriangle(ctx, img, s0, s1, s2, d0, d1, d2) {
  const det = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (Math.abs(det) < 1e-9) return;
  const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / det;
  const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / det;
  const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / det;
  const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / det;
  const e = d0[0] - a * s0[0] - c * s0[1];
  const f = d0[1] - b * s0[0] - d * s0[1];

  // Grow the clip a hair so neighbouring triangles overlap; otherwise
  // anti-aliasing leaves a visible seam along every mesh edge.
  const cxm = (d0[0] + d1[0] + d2[0]) / 3, cym = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (p) => {
    const dx = p[0] - cxm, dy = p[1] - cym;
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / len) * 1.6, p[1] + (dy / len) * 1.6];
  };
  const g0 = grow(d0), g1 = grow(d1), g2 = grow(d2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * Draw a texture over a parametric 3D surface.
 * `surf(u, v)` returns a world point; u runs left→right across the
 * texture and v top→bottom. Returns the projected outline.
 */
function warp(ctx, cam, tex, surf, nu = 10, nv = 10) {
  const grid = [];
  for (let j = 0; j <= nv; j++) {
    const row = [];
    for (let i = 0; i <= nu; i++) row.push(cam.project(surf(i / nu, j / nv)));
    grid.push(row);
  }
  const outline = [];
  for (let i = 0; i <= nu; i++) outline.push(grid[0][i]);
  for (let j = 1; j <= nv; j++) outline.push(grid[j][nu]);
  for (let i = nu - 1; i >= 0; i--) outline.push(grid[nv][i]);
  for (let j = nv - 1; j >= 1; j--) outline.push(grid[j][0]);

  // Clip to the true outline: the triangles overlap generously to hide
  // seams, and this is what stops that overlap showing as a ragged edge.
  ctx.save();
  ctx.beginPath();
  polygon(ctx, outline);
  ctx.clip();
  const tw = tex.width, th = tex.height;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const p00 = grid[j][i], p10 = grid[j][i + 1], p01 = grid[j + 1][i], p11 = grid[j + 1][i + 1];
      const t00 = [(i / nu) * tw, (j / nv) * th], t10 = [((i + 1) / nu) * tw, (j / nv) * th];
      const t01 = [(i / nu) * tw, ((j + 1) / nv) * th], t11 = [((i + 1) / nu) * tw, ((j + 1) / nv) * th];
      drawTexTriangle(ctx, tex, t00, t10, t01, p00, p10, p01);
      drawTexTriangle(ctx, tex, t10, t11, t01, p10, p11, p01);
    }
  }
  ctx.restore();
  return outline;
}

// =====================================================================
// Backdrop, light and shadow
// =====================================================================

function paintBackdrop(ctx, W, H, pal) {
  const g = ctx.createLinearGradient(0, 0, W * 0.25, H);
  g.addColorStop(0, pal.top);
  g.addColorStop(1, pal.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // The key light: a broad pool, high and to the left.
  const pool = ctx.createRadialGradient(W * 0.3, H * 0.22, 0, W * 0.3, H * 0.22, W * 0.8);
  pool.addColorStop(0, rgba(pal.glow, pal.dark ? 0.34 : 0.62));
  pool.addColorStop(0.5, rgba(pal.glow, pal.dark ? 0.08 : 0.16));
  pool.addColorStop(1, rgba(pal.glow, 0));
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, W, H);

  // A second, tighter pool behind the subject. It is what keeps a navy
  // cover from disappearing into a navy backdrop.
  const spot = ctx.createRadialGradient(W * 0.5, H * 0.52, 0, W * 0.5, H * 0.52, W * 0.42);
  spot.addColorStop(0, rgba(pal.glow, pal.dark ? 0.2 : 0.22));
  spot.addColorStop(1, rgba(pal.glow, 0));
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);

  // Window light: soft diagonal bands, the thing that makes a table
  // read as a room and not a gradient.
  const bands = [[0.36, 0.13], [0.53, 0.06], [0.66, 0.09]];
  for (const [at, width] of bands) {
    softShape(ctx, () => polygon(ctx, [
      [W * at, -H * 0.1], [W * (at + width), -H * 0.1],
      [W * (at + width - 0.42), H * 1.1], [W * (at - 0.42), H * 1.1],
    ]), pal.dark ? rgba(pal.glow, 0.5) : "#ffffff", W * 0.03, pal.dark ? 0.11 : 0.3);
  }

  // Vignette.
  const v = ctx.createRadialGradient(W / 2, H / 2, W * 0.32, W / 2, H / 2, W * 0.78);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, rgba(pal.shadow, pal.dark ? 0.55 : 0.26));
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  // Grain, so the surface has tooth rather than plastic smoothness.
  ctx.save();
  ctx.globalAlpha = pal.dark ? 0.05 : 0.035;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(grain(), "repeat");
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Ground shadow of a set of 3D points lit from the upper left. */
function groundShadow(ctx, cam, pal, pts, S, spread = 1) {
  // Light falls from front-left, so shadows run back and to the right,
  // longer the higher the point above the table.
  const foot = pts.map((p) => cam.project([p[0], p[1], 0]));
  const cast = pts.map((p) => cam.project([p[0] + 0.5 * p[2] * spread, p[1] + 0.32 * p[2] * spread, 0]));
  softShape(ctx, () => polygon(ctx, hull(foot.concat(cast))), pal.shadow, 70 * S, pal.dark ? 0.6 : 0.4);
  softShape(ctx, () => polygon(ctx, hull(foot)), pal.shadow, 22 * S, pal.dark ? 0.75 : 0.62);
}

// =====================================================================
// Objects
// =====================================================================

const LIGHT = (() => { const v = [-0.42, -0.5, 0.76]; const l = Math.hypot(...v); return v.map((n) => n / l); })();

function shadeOverlay(ctx, outline, normal) {
  const k = normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2];
  ctx.save();
  ctx.beginPath();
  polygon(ctx, outline);
  if (k < 0.62) { ctx.fillStyle = `rgba(8,6,4,${clamp((0.62 - k) * 0.85, 0, 0.6)})`; ctx.fill(); }
  else if (k > 0.8) { ctx.fillStyle = `rgba(255,252,244,${clamp((k - 0.8) * 0.5, 0, 0.16)})`; ctx.fill(); }
  ctx.restore();
}

/**
 * A closed book, built from six faces in its own coordinates: centred
 * on x and y, standing on z = 0, front cover toward −y. `pose` moves it
 * into the world — lying flat, turned, placed.
 */
function closedBook(ctx, cam, a, spec) {
  const { w, h, d, lay = "upright", yaw = 0, at = [0, 0], lift = 0, pal, S } = spec;
  const bt = Math.min(d * 0.16, 9 * S);
  const yawR = yaw * DEG, cy = Math.cos(yawR), sy = Math.sin(yawR);

  const tilt = lay === "flat" ? -90 * DEG : 0;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const rotateN = (n) => {
    const y1 = n[1] * ct - n[2] * st, z1 = n[1] * st + n[2] * ct;
    return [n[0] * cy - y1 * sy, n[0] * sy + y1 * cy, z1];
  };
  const pose = (p) => {
    const y1 = p[1] * ct - p[2] * st - (lay === "flat" ? h / 2 : 0), z1 = p[1] * st + p[2] * ct;
    const z2 = z1 + (lay === "flat" ? d / 2 : 0) + lift;
    return [p[0] * cy - y1 * sy + at[0], p[0] * sy + y1 * cy + at[1], z2];
  };

  const hw = w / 2, hd = d / 2;
  const cornersLocal = [[-hw, -hd, 0], [hw, -hd, 0], [hw, hd, 0], [-hw, hd, 0]];
  const topLocal = cornersLocal.map((p) => [p[0], p[1], h]);
  groundShadow(ctx, cam, pal, cornersLocal.concat(topLocal).map(pose), S, lay === "flat" ? 1.4 : 0.9);
  if (lay === "upright") {
    // A thin footprint all but vanishes at a low camera angle, so give
    // the book a soft pool of contact shadow to stand in.
    const ex = w * 0.16, ey = Math.max(d * 1.2, w * 0.1);
    const pool = [[-hw - ex, -hd - ey], [hw + ex, -hd - ey], [hw + ex, hd + ey * 1.6], [-hw - ex, hd + ey * 1.6]]
      .map(([px, py]) => cam.project(pose([px, py, 0])));
    softShape(ctx, () => polygon(ctx, pool), pal.shadow, 46 * S, pal.dark ? 0.75 : 0.5);
  }

  const boardColor = a.boardColor;
  const edgeThick = paintEdge(Math.round(h), Math.round(d * 2), bt / d, boardColor);
  const edgeAcross = paintEdge(Math.round(w), Math.round(d * 2), bt / d, boardColor);

  const faces = [
    { n: [0, -1, 0], tex: a.cover, c: (u, v) => [lerp(-hw, hw, u), -hd, lerp(h, 0, v)] },
    { n: [0, 1, 0], tex: a.back, c: (u, v) => [lerp(hw, -hw, u), hd, lerp(h, 0, v)] },
    { n: [-1, 0, 0], tex: a.spine, c: (u, v) => [-hw, lerp(hd, -hd, u), lerp(h, 0, v)] },
    { n: [1, 0, 0], tex: edgeThick, c: (u, v) => [hw, lerp(-hd, hd, u), lerp(h, 0, v)] },
    { n: [0, 0, 1], tex: edgeAcross, c: (u, v) => [lerp(-hw, hw, v), lerp(-hd, hd, u), h] },
    { n: [0, 0, -1], tex: edgeAcross, c: (u, v) => [lerp(-hw, hw, v), lerp(-hd, hd, u), 0] },
  ].map((face) => {
    const centre = pose(face.c(0.5, 0.5));
    return { ...face, wn: rotateN(face.n), depth: cam.depth(centre) };
  }).filter((face) => cam.facing(face.wn));

  faces.sort((p, q) => p.depth - q.depth);
  for (const face of faces) {
    const isEdge = face.tex === edgeThick || face.tex === edgeAcross;
    let outline;
    if (isEdge && isSliver([face.c(0, 0), face.c(1, 0), face.c(1, 1), face.c(0, 1)].map((p) => cam.project(pose(p))), S)) {
      // A page edge seen almost edge-on is a line, not a surface:
      // texturing it only produces dashes. Fill it flat.
      outline = [face.c(0, 0), face.c(1, 0), face.c(1, 1), face.c(0, 1)].map((p) => cam.project(pose(p)));
      ctx.beginPath();
      polygon(ctx, outline);
      ctx.fillStyle = "#e6dcc6";
      ctx.fill();
    } else {
      outline = warp(ctx, cam, face.tex, (u, v) => pose(face.c(u, v)), 12, 12);
    }
    shadeOverlay(ctx, outline, face.wn);
    if (face.tex === a.cover) coverFinish(ctx, cam, pose, face, outline, { hw, hd, h });
  }
}

/** Is a projected quad so thin that it reads as a line? */
function isSliver(pts, S) {
  let area = 0, perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
    perimeter += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return Math.abs(area) / 2 < perimeter * 7 * S;
}

/** The hinge groove and a faint sheen on a cover, so it reads as board. */
function coverFinish(ctx, cam, pose, face, outline, { hw, hd, h }) {
  const at = (u) => face.c(u, 0.5);
  const groove = (u, alpha) => {
    const top = cam.project(pose(face.c(u, 0))), bottom = cam.project(pose(face.c(u, 1)));
    ctx.save();
    ctx.beginPath();
    polygon(ctx, outline);
    ctx.clip();
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.lineWidth = Math.max(1, Math.abs(bottom[1] - top[1]) * 0.004);
    ctx.beginPath();
    ctx.moveTo(top[0], top[1]);
    ctx.lineTo(bottom[0], bottom[1]);
    ctx.stroke();
    ctx.restore();
  };
  groove(0.045, 0.34);
  groove(0.05, 0.1);
  const c0 = cam.project(pose(face.c(0, 0))), c1 = cam.project(pose(face.c(1, 1)));
  const g = ctx.createLinearGradient(c0[0], c0[1], c1[0], c1[1]);
  g.addColorStop(0, "rgba(255,255,255,0.13)");
  g.addColorStop(0.45, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.save();
  ctx.beginPath();
  polygon(ctx, outline);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  void at; void hw; void hd; void h;
}

/**
 * A flat rectangular prop — a card, a swatch, a bookmark — lying on the
 * table with its own soft shadow.
 */
function flatCard(ctx, cam, spec) {
  const { at, yaw = 0, w, h, fill, edge, pal, S, z = 1.5 } = spec;
  const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG);
  const corner = (x, y, zz) => cam.project([x * cy - y * sy + at[0], x * sy + y * cy + at[1], zz]);
  const quad = (zz) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => corner(x, y, zz));
  const foot = quad(0), top = quad(z);
  const cast = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([x, y]) => corner(x + 9 * S, y + 7 * S, 0));
  softShape(ctx, () => polygon(ctx, hull(foot.concat(cast))), pal.shadow, 26 * S, pal.dark ? 0.6 : 0.4);
  softShape(ctx, () => polygon(ctx, foot), pal.shadow, 7 * S, pal.dark ? 0.7 : 0.5);
  ctx.beginPath();
  polygon(ctx, top);
  const g = ctx.createLinearGradient(top[0][0], top[0][1], top[2][0], top[2][1]);
  g.addColorStop(0, mix(fill, "#ffffff", 0.12));
  g.addColorStop(1, mix(fill, "#000000", 0.1));
  ctx.fillStyle = g;
  ctx.fill();
  if (edge) {
    ctx.lineWidth = Math.max(1, 1.4 * S);
    ctx.strokeStyle = edge;
    ctx.stroke();
  }
}

/** A pen lying on the table: barrel, cap band, clip and a fine tip. */
function pen(ctx, cam, spec) {
  const { at, yaw = 0, len, color, band, pal, S } = spec;
  const r = 12 * S;
  const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG);
  const pt = (x, y, zz) => cam.project([x * cy - y * sy + at[0], x * sy + y * cy + at[1], zz]);
  const along = (x0, x1, half, zz) => [pt(x0, -half, zz), pt(x1, -half, zz), pt(x1, half, zz), pt(x0, half, zz)];
  const L0 = -len / 2, tip = len * 0.5, body = len * 0.42;

  const shadowBody = along(L0 + 12 * S, tip, r, 0).map((p) => [p[0] + 12 * S, p[1] + 14 * S]);
  softShape(ctx, () => polygon(ctx, shadowBody), pal.shadow, 16 * S, pal.dark ? 0.6 : 0.42);

  const barrel = along(L0, body, r, 2 * S);
  const a = barrel[0], b = barrel[3];
  const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
  g.addColorStop(0, mix(color, "#000000", 0.38));
  g.addColorStop(0.35, mix(color, "#ffffff", 0.32));
  g.addColorStop(0.7, color);
  g.addColorStop(1, mix(color, "#000000", 0.5));
  ctx.beginPath(); polygon(ctx, barrel); ctx.fillStyle = g; ctx.fill();

  // Cap band and the metal grip section.
  const gripEnd = len * 0.47;
  const grip = along(body, gripEnd, r * 0.86, 2 * S);
  const gg = ctx.createLinearGradient(grip[0][0], grip[0][1], grip[3][0], grip[3][1]);
  gg.addColorStop(0, "#8c7a52"); gg.addColorStop(0.4, "#f1dea3"); gg.addColorStop(1, "#6b5b38");
  ctx.beginPath(); polygon(ctx, grip); ctx.fillStyle = gg; ctx.fill();
  const bandQuad = along(L0 + len * 0.06, L0 + len * 0.09, r * 1.02, 2.2 * S);
  ctx.beginPath(); polygon(ctx, bandQuad); ctx.fillStyle = band; ctx.fill();

  // Tip.
  const t0 = pt(gripEnd, -r * 0.5, 2 * S), t1 = pt(gripEnd, r * 0.5, 2 * S), t2 = pt(tip + 9 * S, 0, 2 * S);
  ctx.beginPath(); polygon(ctx, [t0, t1, t2]); ctx.fillStyle = "#2b2b2e"; ctx.fill();

  // A clip along the top of the barrel.
  const clip = along(L0 + len * 0.02, L0 + len * 0.3, r * 0.16, 3.4 * S);
  const cg = ctx.createLinearGradient(clip[0][0], clip[0][1], clip[1][0], clip[1][1]);
  cg.addColorStop(0, "#d9c58a"); cg.addColorStop(1, "#8c7a52");
  ctx.beginPath(); polygon(ctx, clip); ctx.fillStyle = cg; ctx.fill();
}

/**
 * An open book lying on the table, seen from above at an angle. The
 * pages rise out of the gutter, dip toward the binding, and show the
 * edge of the block.
 */
function openBook(ctx, cam, a, spec) {
  const { w, h, thick, board, at = [0, 0], yaw = 0, pal, S, soft = false } = spec;
  const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG);
  const place = (p) => [p[0] * cy - p[1] * sy + at[0], p[0] * sy + p[1] * cy + at[1], p[2]];
  const T = thick;
  const hh = h / 2;
  const lift = (d) => {
    const t = clamp(d / w, 0, 1);
    return T * (1 - 0.3 * Math.exp(-t / 0.16)) + T * 0.07 * Math.pow(Math.max(0, (t - 0.86) / 0.14), 2);
  };
  const z = (x) => lift(Math.abs(x));
  const margin = soft ? 6 * S : w * 0.035;

  // Shadow first: the whole open book, sitting on the table.
  const spreadBase = [[-w - margin, -hh - margin, -board], [w + margin, -hh - margin, -board], [w + margin, hh + margin, -board], [-w - margin, hh + margin, -board]].map(place);
  const spreadTop = spreadBase.map((p) => [p[0], p[1], T]);
  groundShadow(ctx, cam, pal, spreadBase.concat(spreadTop), S, 1.6);

  // Boards (or, for a softcover, the wrap of the card cover).
  const boardTop = (x, y) => place([x, y, 0]);
  const boardOutline = [[-w - margin, -hh - margin], [w + margin, -hh - margin], [w + margin, hh + margin], [-w - margin, hh + margin]]
    .map(([x, y]) => cam.project(boardTop(x, y)));
  const boardBottom = (x, y) => place([x, y, -board]);
  if (cam.facing([0, -1, 0])) {
    const front = [[-w - margin, -hh - margin, 0], [w + margin, -hh - margin, 0], [w + margin, -hh - margin, -board], [-w - margin, -hh - margin, -board]]
      .map((p) => cam.project(place(p)));
    ctx.beginPath(); polygon(ctx, front); ctx.fillStyle = mix(a.boardColor, "#000000", 0.32); ctx.fill();
  }
  void boardBottom;
  ctx.beginPath();
  polygon(ctx, boardOutline);
  const bg = ctx.createLinearGradient(boardOutline[0][0], boardOutline[0][1], boardOutline[2][0], boardOutline[2][1]);
  bg.addColorStop(0, mix(a.boardColor, "#ffffff", 0.1));
  bg.addColorStop(1, mix(a.boardColor, "#000000", 0.18));
  ctx.fillStyle = bg;
  ctx.fill();

  // The edges of the page block, front and outer sides.
  const N = 26;
  const edgeStrip = (fn, fill) => {
    const top = [], bottom = [];
    for (let i = 0; i <= N; i++) {
      const [x, y, zz] = fn(i / N);
      top.push(cam.project(place([x, y, zz])));
      bottom.push(cam.project(place([x, y, 0])));
    }
    ctx.beginPath();
    polygon(ctx, top.concat(bottom.reverse()));
    ctx.fillStyle = fill;
    ctx.fill();
    return top;
  };
  const frontVisible = cam.facing([0, -1, 0]);
  if (frontVisible) {
    const frontEdge = (t) => { const x = lerp(-w, w, t); return [x, -hh, z(x)]; };
    const stripFill = ctx.createLinearGradient(0, boardOutline[0][1] - 40, 0, boardOutline[0][1] + 10);
    stripFill.addColorStop(0, "#f1e9d8"); stripFill.addColorStop(1, "#d9cdb4");
    edgeStrip(frontEdge, stripFill);
    // Page lines on the front edge.
    const lines = 12;
    ctx.save();
    ctx.strokeStyle = "rgba(90,70,40,0.16)";
    ctx.lineWidth = Math.max(1, S * 1.2);
    for (let k = 1; k < lines; k++) {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const x = lerp(-w, w, i / N);
        const p = cam.project(place([x, -hh, z(x) * (k / lines)]));
        if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const side of [-1, 1]) {
    if (!cam.facing([side, 0, 0])) continue;
    const sideEdge = (t) => [side * w, lerp(-hh, hh, t), z(side * w)];
    edgeStrip(sideEdge, "#e6dcc6");
  }

  // The two pages.
  const pageSurf = (side) => (u, v) => {
    const d = (side < 0 ? 1 - u : u) * w;
    const x = side * d;
    return place([x, lerp(hh, -hh, v), z(x)]);
  };
  const left = warp(ctx, cam, a.pageL, pageSurf(-1), 28, 14);
  const right = warp(ctx, cam, a.pageR, pageSurf(1), 28, 14);

  // Page shading: the gutter is deep, the outer edges catch the light.
  const gut = cam.project(place([0, 0, z(0)]));
  const shadePage = (outline, side) => {
    const outer = cam.project(place([side * w, 0, z(side * w)]));
    const g = ctx.createLinearGradient(gut[0], gut[1], outer[0], outer[1]);
    g.addColorStop(0, "rgba(28,20,10,0.62)");
    g.addColorStop(0.07, "rgba(28,20,10,0.3)");
    g.addColorStop(0.32, "rgba(28,20,10,0.03)");
    g.addColorStop(0.9, "rgba(255,252,240,0.05)");
    g.addColorStop(1, "rgba(28,20,10,0.06)");
    ctx.save();
    ctx.beginPath();
    polygon(ctx, outline);
    ctx.fillStyle = g;
    ctx.fill();
    // A broad light falloff across the whole spread.
    const lg = ctx.createLinearGradient(outline[0][0], outline[0][1], outline[Math.floor(outline.length / 2)][0], outline[Math.floor(outline.length / 2)][1]);
    lg.addColorStop(0, "rgba(255,250,235,0.1)");
    lg.addColorStop(1, "rgba(30,20,8,0.1)");
    ctx.fillStyle = lg;
    ctx.fill();
    ctx.restore();
  };
  shadePage(left, -1);
  shadePage(right, 1);

  // A ribbon marker falling out of the gutter: the small detail that
  // reads as a made object rather than a diagram.
  if (spec.ribbon) {
    const rib = [];
    const r0 = -hh * 0.9, r1 = -hh - w * 0.16;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const y = lerp(r0, r1, t);
      rib.push(cam.project(place([w * 0.02 + Math.sin(t * 2.4) * w * 0.012, y, z(w * 0.02) + 1.5 * S])));
    }
    const ribW = w * 0.011;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(rib[0][0] - ribW, rib[0][1]);
    for (const p of rib) ctx.lineTo(p[0] - ribW * 0.9, p[1]);
    for (const p of rib.slice().reverse()) ctx.lineTo(p[0] + ribW * 0.9, p[1]);
    ctx.closePath();
    ctx.fillStyle = spec.ribbon;
    ctx.fill();
    ctx.restore();
  }
}

// =====================================================================
// Scenes
// =====================================================================

function thicknessFor(pageCount) {
  // Same figure the wrap uses: 0.18pt of spine per page.
  return Math.max(9, pageCount * 0.18);
}

export const SCENES = [
  {
    id: "hardcover-spread",
    name: "Open hardcover",
    blurb: "The signature shot: an open hardcover in soft window light, the real pages on show.",
    needs: "pages",
    paint(ctx, W, H, a, pal) {
      const S = W / 2400;
      const w = W * 0.365, k = w / a.trim.width, h = a.trim.height * k;
      const cam = makeCamera({ W, H, yaw: -6, pitch: 58, cy: H * 0.5, zoom: 0.98 });
      openBook(ctx, cam, a, { w, h, thick: thicknessFor(a.pageCount) * k * 0.55, board: 12 * S, pal, S, ribbon: a.accent });
    },
  },
  {
    id: "interior-closeup",
    name: "Interior close-up",
    blurb: "In tight on the spread, cropped by the frame: the typography and layout, up close.",
    needs: "pages",
    paint(ctx, W, H, a, pal) {
      const S = W / 2400;
      const w = W * 0.46, k = w / a.trim.width, h = a.trim.height * k;
      const cam = makeCamera({ W, H, yaw: 4, pitch: 50, cx: W * 0.5, cy: H * 0.62, zoom: 1 });
      openBook(ctx, cam, a, { w, h, thick: thicknessFor(a.pageCount) * k * 0.55, board: 16 * S, pal, S, ribbon: a.accent });
    },
  },
  {
    id: "softcover-booklet",
    name: "Softcover & spread",
    blurb: "A softcover open beside its own cover: the booklet look, close to top-down.",
    needs: "pages",
    paint(ctx, W, H, a, pal) {
      const S = W / 2400;
      const w = W * 0.255, k = w / a.trim.width, h = a.trim.height * k;
      const cam = makeCamera({ W, H, yaw: 0, pitch: 72, cx: W * 0.5, cy: H * 0.5, zoom: 0.94 });
      const d = thicknessFor(a.pageCount) * k * 0.6;
      openBook(ctx, cam, a, { w, h, thick: d * 0.35, board: 4 * S, pal, S, at: [w * 0.9, 20 * S], yaw: 3, soft: true });
      closedBook(ctx, cam, a, { w, h, d: d * 0.8, lay: "flat", yaw: -8, at: [-w * 1.38, 0], pal, S });
    },
  },
  {
    id: "standing-hero",
    name: "Standing hero",
    blurb: "One book, upright, turned to show cover and spine. The sales-page image.",
    needs: "cover",
    paint(ctx, W, H, a, pal) {
      const S = W / 2400;
      const h = H * 0.76, k = h / a.trim.height, w = a.trim.width * k;
      const d = thicknessFor(a.pageCount) * k;
      const cam = makeCamera({ W, H, yaw: 26, pitch: 17, cx: W * 0.5, cy: H * 0.84, zoom: 1 });
      closedBook(ctx, cam, a, { w, h, d, lay: "upright", yaw: 0, at: [0, 0], pal, S });
    },
  },
  {
    id: "flat-lay",
    name: "Flat-lay",
    blurb: "Straight down: the open pages, a closed copy, a pen and a card. The editorial desk shot.",
    needs: "pages",
    paint(ctx, W, H, a, pal) {
      const S = W / 2400;
      const w = W * 0.215, k = w / a.trim.width, h = a.trim.height * k;
      const cam = makeCamera({ W, H, yaw: 0, pitch: 90, cx: W * 0.5, cy: H * 0.5, zoom: 1 });
      const d = thicknessFor(a.pageCount) * k * 0.7;

      // A swatch card, half hidden under the spread.
      flatCard(ctx, cam, {
        at: [-W * 0.335, H * 0.2], yaw: -14, w: W * 0.13, h: W * 0.19,
        fill: pal.dark ? "#ece4d3" : "#fbf7ee", edge: rgba(a.accent, 0.5), pal, S,
      });
      openBook(ctx, cam, a, { w, h, thick: d * 0.4, board: 8 * S, pal, S, at: [-W * 0.12, 0], yaw: -5, ribbon: a.accent });
      closedBook(ctx, cam, a, { w, h, d, lay: "flat", yaw: 11, at: [W * 0.3, -H * 0.02], pal, S });
      pen(ctx, cam, { at: [W * 0.06, -H * 0.36], yaw: 14, len: W * 0.23, color: mix(a.boardColor, "#000000", 0.25), band: a.accent, pal, S });
    },
  },
  {
    id: "lying-cover",
    name: "Cover, lying flat",
    blurb: "The book on the table at a three-quarter angle, spine and page edge in view.",
    needs: "cover",
    paint(ctx, W, H, a, pal) {
      const S = W / 2400;
      const h = H * 0.74, k = h / a.trim.height, w = a.trim.width * k;
      const d = thicknessFor(a.pageCount) * k;
      const cam = makeCamera({ W, H, yaw: 0, pitch: 52, cx: W * 0.5, cy: H * 0.5, zoom: 1 });
      closedBook(ctx, cam, a, { w, h, d, lay: "flat", yaw: 14, at: [0, 20 * S], pal, S });
    },
  },
  {
    id: "stack",
    name: "The stack",
    blurb: "Three copies stacked and turned, cover on top. Volume, abundance, a real print run.",
    needs: "cover",
    paint(ctx, W, H, a, pal) {
      const S = W / 2400;
      const h = H * 0.74, k = h / a.trim.height, w = a.trim.width * k;
      const d = thicknessFor(a.pageCount) * k * 0.9;
      const cam = makeCamera({ W, H, yaw: 0, pitch: 46, cx: W * 0.5, cy: H * 0.52, zoom: 1 });
      const layers = [
        { yaw: -12, at: [-w * 0.05, -h * 0.03], lift: 0 },
        { yaw: 9, at: [w * 0.06, h * 0.02], lift: d },
        { yaw: -3, at: [0, 0], lift: d * 2 },
      ];
      // Shadows accumulate from the base only; each layer is drawn over
      // the one below it, bottom to top.
      layers.forEach((layer) => closedBook(ctx, cam, a, { w, h, d, lay: "flat", ...layer, pal, S }));
    },
  },
  {
    id: "trio",
    name: "Three-up",
    blurb: "Three copies standing at different angles: the shelf-and-display shot.",
    needs: "cover",
    paint(ctx, W, H, a, pal) {
      const S = W / 2400;
      const h = H * 0.6, k = h / a.trim.height, w = a.trim.width * k;
      const d = thicknessFor(a.pageCount) * k;
      const cam = makeCamera({ W, H, yaw: 0, pitch: 15, cx: W * 0.5, cy: H * 0.8, zoom: 1 });
      const items = [
        { at: [-w * 1.28, h * 0.3], yaw: 24 },
        { at: [w * 1.28, h * 0.3], yaw: -24 },
        { at: [0, -h * 0.18], yaw: 0 },
      ];
      // Far to near, so the front copy overlaps the two behind it.
      items.sort((p, q) => q.at[1] - p.at[1]);
      items.forEach((item) => closedBook(ctx, cam, a, { w, h, d, lay: "upright", ...item, pal, S }));
    },
  },
];

// =====================================================================
// Public entry point
// =====================================================================

/**
 * Prepare the textures once per book, so switching scene or palette
 * only repaints the scene and never re-typesets a page.
 *
 * @param {object} input { cover, project, trim, pageCount, pageLeft, pageRight, image }
 */
export function prepareAssets({ cover, project, trim, pageCount = 200, pageLeft = null, pageRight = null, image = null }) {
  const palette = paletteOf(cover);
  const coverW = 720, coverH = Math.round(720 * (trim.height / trim.width));
  const d = thicknessFor(pageCount);
  return {
    trim,
    pageCount,
    cover: paintCover(cover, project, coverW, coverH, image),
    back: paintBack(cover, project, coverW, coverH),
    spine: paintSpine(cover, project, Math.round(coverW * (d / trim.width)) + 24, coverH),
    pageL: paintPage(pageLeft, trim, 900),
    pageR: paintPage(pageRight, trim, 900),
    boardColor: palette.background,
    accent: palette.accent,
  };
}

/**
 * Render one scene to a new canvas.
 */
export function renderScene(sceneId, paletteId, assets, { width = 1200 } = {}) {
  const scene = SCENES.find((s) => s.id === sceneId) || SCENES[0];
  const pal = paletteById(paletteId);
  const W = Math.round(width), H = Math.round(width * (2 / 3));
  const canvas = canvasOf(W, H);
  const ctx = canvas.getContext("2d");
  paintBackdrop(ctx, W, H, pal);
  scene.paint(ctx, W, H, assets, pal);
  return canvas;
}
