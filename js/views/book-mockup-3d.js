// Turns a flat cover image into a proper standing 3D hardcover render —
// the same treatment the curated MOCKUP_3D books in post-image.js get,
// computed live for any book instead. A flat rectangle with a CSS drop
// shadow reads as a thumbnail; this is what "premium" actually needs —
// perspective, board thickness, a spine, real light — and it means every
// book gets it, not just the ones someone hand-rendered ahead of time.
//
// Built on the Book Builder's own 3D engine (mockup-engine.js) so the
// geometry, lighting and shadow are the same code path as everywhere else
// in the app that draws a book in 3D, not a second implementation of it.

import { closedBook, makeCamera, canvasOf, drawCovered } from "./builder/mockup-engine.js";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The cover image didn't load."));
    img.src = src;
  });
}

function solidCanvas(w, h, hex) {
  const c = canvasOf(w, h);
  const x = c.getContext("2d");
  x.fillStyle = hex;
  x.fillRect(0, 0, w, h);
  return c;
}

/** Trim a canvas to the bounding box of its non-transparent pixels. */
function trim(canvas, pad = 14) {
  const ctx = canvas.getContext("2d");
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return canvas; // nothing opaque — hand back the original rather than a zero-size crop
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = canvasOf(w, h);
  out.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return out;
}

/** The dominant colour along a cover's spine edge, for the board/back/spine faces. */
function edgeColor(img) {
  const probe = canvasOf(1, 1);
  probe.getContext("2d").drawImage(img, 0, 0, img.naturalWidth || img.width, 1, 0, 0, 1, 1);
  const [r, g, b] = probe.getContext("2d").getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const resolved = new Map(); // coverUrl -> data URL, once rendered at the default angle
const inflight = new Map(); // coverUrl -> Promise, while rendering
const assets = new Map(); // coverUrl -> { cover, back, spine, boardColor } — the textures, built once

const DEFAULT_YAW = 30;

/** A cached render, if one already finished — for callers that can't await (sync markup builders). */
export function getMockup3D(coverUrl) {
  return resolved.get(coverUrl) || null;
}

/** The book's textures, if `renderMockup3D`/`ensureBookMockup3D` has already built them — for rotation. */
export function getBookAsset(coverUrl) {
  return assets.get(coverUrl) || null;
}

/**
 * Paint `asset`'s standing hardcover at `yaw` degrees and hand back a data
 * URL — this is the part that's cheap enough to run on every tick of a
 * rotate slider (no image loading: the cover/back/spine textures are
 * already canvases). Yaw 0 is face-on; `renderMockup3D`'s default (30) is
 * the "displayed, not flat" angle everything opens on.
 */
export function paintMockupAtYaw(asset, yaw) {
  const W = 1000, H = 1200;
  const canvas = canvasOf(W, H);
  const ctx = canvas.getContext("2d");
  const bh = H * 0.72, k = bh / 1080, bw = 720 * k;
  const d = 40 * k;
  const cam = makeCamera({ W, H, yaw, pitch: 15, cx: W * 0.5, cy: H * 0.86, zoom: 1 });
  closedBook(ctx, cam, asset, { w: bw, h: bh, d, lay: "upright", yaw: 0, at: [0, 0], pal: { shadow: "#1a1410", dark: false }, S: 1 });

  // A soft diagonal key-light sweep over the book's own pixels only — the
  // difference between a flat render and one that reads as lit. Fixed to
  // the frame, not the book, the way a room's own light would be.
  const sweep = ctx.createLinearGradient(0, 0, W * 0.7, H);
  sweep.addColorStop(0, "rgba(255,255,255,0.16)");
  sweep.addColorStop(0.35, "rgba(255,255,255,0.03)");
  sweep.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  return trim(canvas).toDataURL("image/png");
}

/**
 * Render `coverUrl` as a standing 3D hardcover on a transparent, tightly
 * cropped canvas, and cache the result (by URL) for every future call.
 * Safe to call more than once for the same cover — later calls await the
 * same in-flight render rather than starting a second one. Also caches the
 * underlying textures (`getBookAsset`) so a rotate control can repaint at
 * a different angle without reloading the cover image.
 */
export async function renderMockup3D(coverUrl) {
  if (resolved.has(coverUrl)) return resolved.get(coverUrl);
  if (inflight.has(coverUrl)) return inflight.get(coverUrl);

  const promise = (async () => {
    const img = await loadImage(coverUrl);
    const w = 720, h = 1080;
    const cover = canvasOf(w, h);
    drawCovered(cover.getContext("2d"), img, w, h);
    const hex = edgeColor(img);
    const asset = { cover, back: solidCanvas(w, h, hex), spine: solidCanvas(120, h, hex), boardColor: hex };
    assets.set(coverUrl, asset);
    // A touch more dynamic than a flat product shot: real spine in view,
    // the way a held or displayed book actually turns.
    return paintMockupAtYaw(asset, DEFAULT_YAW);
  })();

  inflight.set(coverUrl, promise);
  try {
    const dataUrl = await promise;
    resolved.set(coverUrl, dataUrl);
    return dataUrl;
  } finally {
    inflight.delete(coverUrl);
  }
}
