// The Book Builder's API surface.
//
// A separate namespace from core/api.js on purpose: the authoring side
// has its own functions, its own tables and its own demo
// implementation, and keeping the two vocabularies apart is what stops
// "book" meaning two different things in one file. A BookPilot *book* is
// something being advertised; a Book Builder *project* is something
// being written.

import { api, currentAdapter, ApiError } from "./api.js";
import { accessToken } from "./auth.js";

export const BB = {
  // --- Projects -----------------------------------------------------
  projects: () => api.get("/api/bb/projects"),
  project: (id) => api.get(`/api/bb/projects/${id}`),
  createProject: (project) => api.post("/api/bb/projects", project),
  updateProject: (id, patch) => api.patch(`/api/bb/projects/${id}`, patch),
  deleteProject: (id) => api.delete(`/api/bb/projects/${id}`),
  manuscript: (id) => api.get(`/api/bb/projects/${id}/manuscript`),
  promote: (id) => api.post(`/api/bb/projects/${id}/promote`),
  duplicateProject: (id) => api.post(`/api/bb/projects/${id}/duplicate`),

  // --- Blueprint ----------------------------------------------------
  chapters: (id) => api.get(`/api/bb/projects/${id}/chapters`),
  chapter: (id, chapterId) => api.get(`/api/bb/projects/${id}/chapters/${chapterId}`),
  createChapter: (id, chapter) => api.post(`/api/bb/projects/${id}/chapters`, chapter),
  updateChapter: (id, chapterId, patch) =>
    api.patch(`/api/bb/projects/${id}/chapters/${chapterId}`, patch),
  deleteChapter: (id, chapterId) => api.delete(`/api/bb/projects/${id}/chapters/${chapterId}`),
  reorder: (id, order) => api.post(`/api/bb/projects/${id}/chapters/reorder`, { order }),
  parts: (id) => api.get(`/api/bb/projects/${id}/parts`),
  createPart: (id, part) => api.post(`/api/bb/projects/${id}/parts`, part),
  updatePart: (id, partId, patch) => api.patch(`/api/bb/projects/${id}/parts/${partId}`, patch),
  deletePart: (id, partId) => api.delete(`/api/bb/projects/${id}/parts/${partId}`),

  // --- Book Bible ---------------------------------------------------
  bible: (id) => api.get(`/api/bb/projects/${id}/bible`),
  updateBible: (id, patch) => api.patch(`/api/bb/projects/${id}/bible`, patch),

  // --- Figures, sources, covers, campaign ---------------------------
  visuals: (id) => api.get(`/api/bb/projects/${id}/visuals`),
  createVisual: (id, visual) => api.post(`/api/bb/projects/${id}/visuals`, visual),
  updateVisual: (id, visualId, patch) =>
    api.patch(`/api/bb/projects/${id}/visuals/${visualId}`, patch),
  deleteVisual: (id, visualId) => api.delete(`/api/bb/projects/${id}/visuals/${visualId}`),
  sources: (id) => api.get(`/api/bb/projects/${id}/sources`),
  createSource: (id, source) => api.post(`/api/bb/projects/${id}/sources`, source),
  updateSource: (id, sourceId, patch) =>
    api.patch(`/api/bb/projects/${id}/sources/${sourceId}`, patch),
  deleteSource: (id, sourceId) => api.delete(`/api/bb/projects/${id}/sources/${sourceId}`),
  covers: (id) => api.get(`/api/bb/projects/${id}/covers`),
  updateCover: (id, coverId, patch) => api.patch(`/api/bb/projects/${id}/covers/${coverId}`, patch),
  deleteCover: (id, coverId) => api.delete(`/api/bb/projects/${id}/covers/${coverId}`),
  marketing: (id) => api.get(`/api/bb/projects/${id}/marketing`),
  updateAsset: (id, assetId, patch) =>
    api.patch(`/api/bb/projects/${id}/marketing/${assetId}`, patch),
  deleteAsset: (id, assetId) => api.delete(`/api/bb/projects/${id}/marketing/${assetId}`),

  // --- Versions -----------------------------------------------------
  versions: (id) => api.get(`/api/bb/projects/${id}/versions`),
  saveVersion: (id, label, note) => api.post(`/api/bb/projects/${id}/versions`, { label, note }),
  restoreVersion: (id, versionId) =>
    api.post(`/api/bb/projects/${id}/versions/restore`, { version_id: versionId }),
  chapterVersions: (chapterId) => api.get(`/api/bb/chapters/${chapterId}/versions`),
  restoreChapterVersion: (chapterId, versionId) =>
    api.post(`/api/bb/chapters/${chapterId}/versions/restore`, { version_id: versionId }),

  // --- Reference data -----------------------------------------------
  themes: () => api.get("/api/bb/themes"),
  templates: () => api.get("/api/bb/templates"),
  brandKits: () => api.get("/api/bb/brand-kits"),
  createBrandKit: (kit) => api.post("/api/bb/brand-kits", kit),
  updateBrandKit: (id, patch) => api.patch(`/api/bb/brand-kits/${id}`, patch),
  deleteBrandKit: (id) => api.delete(`/api/bb/brand-kits/${id}`),

  // --- The agents ---------------------------------------------------
  generatePositioning: (projectId, notes) =>
    api.post("/api/bb-ai/positioning", { project_id: projectId, notes }),
  approvePositioning: (payload) => api.post("/api/bb-ai/approve-positioning", payload),
  generateArchitecture: (projectId) => api.post("/api/bb-ai/architecture", { project_id: projectId }),
  generateBible: (projectId, notes) => api.post("/api/bb-ai/bible", { project_id: projectId, notes }),
  writeChapter: (chapterId, notes) => api.post("/api/bb-ai/chapter", { chapter_id: chapterId, notes }),
  revise: (payload) => api.post("/api/bb-ai/revise", payload),
  continueChapter: (chapterId) => api.post("/api/bb-ai/continue", { chapter_id: chapterId }),
  frontMatter: (projectId, payload) =>
    api.post("/api/bb-ai/front-matter", { project_id: projectId, ...payload }),
  backMatter: (projectId, payload) =>
    api.post("/api/bb-ai/back-matter", { project_id: projectId, ...payload }),
  review: (chapterId) => api.post("/api/bb-ai/review", { chapter_id: chapterId }),
  research: (payload) => api.post("/api/bb-ai/research", payload),
  directVisuals: (chapterId) => api.post("/api/bb-ai/visuals", { chapter_id: chapterId }),
  imagePrompt: (payload) => api.post("/api/bb-ai/image-prompt", payload),
  generateCovers: (projectId, count) =>
    api.post("/api/bb-ai/covers", { project_id: projectId, count }),
  checkCover: (coverId) => api.post("/api/bb-ai/cover-check", { cover_id: coverId }),
  publicationCheck: (projectId) => api.post("/api/bb-ai/quality", { project_id: projectId }),
  buildCampaign: (projectId, scope, salesUrl) =>
    api.post("/api/bb-ai/marketing", { project_id: projectId, scope, sales_url: salesUrl }),
  repurpose: (projectId, format) =>
    api.post("/api/bb-ai/repurpose", { project_id: projectId, format }),
};

/**
 * Download an export.
 *
 * Not routed through `api` because the response is a file rather than
 * JSON. In the demo workspace the adapter builds the same file in the
 * page: the document engine is plain ES modules, so the browser runs
 * exactly the code the server would have run.
 */
export async function downloadExport(format, projectId) {
  const adapter = currentAdapter();
  if (adapter) return adapter.exportBook(format, projectId);

  const token = await accessToken();
  let res;
  try {
    res = await fetch(`/api/bb-export/${format}`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ project_id: projectId }),
    });
  } catch {
    throw new ApiError("offline", "We couldn't reach BookPilot to build that file.", 0);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(
      data?.error?.code || "error",
      data?.error?.message || "We couldn't build that file.",
      res.status
    );
  }

  const disposition = res.headers.get("content-disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return {
    blob: await res.blob(),
    fileName: match ? match[1] : `book.${format.startsWith("pdf") ? "pdf" : format}`,
    pages: Number(res.headers.get("x-export-pages")) || null,
    watermark: res.headers.get("x-export-watermark") === "1",
  };
}

/** Hand a blob to the browser as a download. */
export function saveFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking straight away cancels the save in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
