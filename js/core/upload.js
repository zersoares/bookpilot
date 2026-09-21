// Upload a brand image and get back the address to save.
//
// The picture is shrunk and re-encoded in the browser first (see
// image-plan.js for why), then sent straight to Supabase Storage with the
// person's own session token. There is no server function in the middle:
// the bucket's policies decide who may write where (sql/018).
//
// The demo has no storage. There the image stays in the page as a data URL,
// which is honest about what it is: it lives in this tab and nowhere else.

import { isDemo } from "./api.js";
import { accessToken, currentUser, storageConfig } from "./auth.js";
import {
  BUCKET, ACCEPTED_TYPES, KINDS, MAX_SOURCE_BYTES, MAX_UPLOAD_BYTES, DEMO_MAX_EDGE,
  fitWithin, storagePath, publicUrl, uploadErrorMessage,
} from "./image-plan.js";

export class UploadError extends Error {}

async function shrink(file, kind, edge) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UploadError("That file couldn't be read as an image.");
  }
  const spec = KINDS[kind];
  try {
    // A few passes at smaller sizes if the first result is still over the limit.
    for (let pass = 0; pass < 4; pass += 1) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, edge);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (spec.type === "image/jpeg") {
        ctx.fillStyle = "#fff"; // JPEG has no transparency; don't let it go black.
        ctx.fillRect(0, 0, width, height);
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, spec.type, spec.quality));
      if (!blob) throw new UploadError("That image couldn't be prepared for upload.");
      if (blob.size <= MAX_UPLOAD_BYTES) return { blob, width, height };
      edge = Math.round(edge * 0.7);
    }
  } finally {
    bitmap.close?.();
  }
  throw new UploadError(uploadErrorMessage(413));
}

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new UploadError("That image couldn't be read."));
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {File} file
 * @param {"logo"|"photo"|"cover"} kind
 * @returns {Promise<{url: string, width: number, height: number, bytes: number, demo: boolean}>}
 */
export async function uploadImage(file, kind) {
  if (!KINDS[kind]) throw new UploadError(`Unknown image kind: ${kind}`);
  if (!ACCEPTED_TYPES.includes(file.type)) throw new UploadError("Use a PNG, JPG or WebP image.");
  if (file.size > MAX_SOURCE_BYTES) throw new UploadError("That file is over 15 MB. Pick a smaller one.");

  if (isDemo()) {
    const { blob, width, height } = await shrink(file, kind, DEMO_MAX_EDGE);
    return { url: await toDataUrl(blob), width, height, bytes: blob.size, demo: true };
  }

  const user = currentUser();
  const token = await accessToken();
  const { url: base, anonKey } = storageConfig();
  if (!user || !token || !base) throw new UploadError("Sign in to upload an image.");

  const { blob, width, height } = await shrink(file, kind, KINDS[kind].maxEdge);
  let path;
  try {
    path = storagePath(user.id, kind, Date.now().toString(36), Math.random().toString(36).slice(2, 10));
  } catch (err) {
    throw new UploadError(err.message);
  }

  let res;
  try {
    res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": blob.type,
        "Cache-Control": "max-age=31536000",
        "x-upsert": "false",
      },
      body: blob,
    });
  } catch {
    throw new UploadError("Couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new UploadError(uploadErrorMessage(res.status, body));
  }
  return { url: publicUrl(base, path), width, height, bytes: blob.size, demo: false };
}
