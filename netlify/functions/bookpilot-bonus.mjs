// POST /api/bp-bonus — free "30 Website Prompts" PDF claim (Mastering ChatGPT).
// Emails the download link; never returns it to the browser.
// Env: RESEND_API_KEY (required for real delivery), BOOKS_MAIL_FROM (verified Resend sender).
// Without RESEND_API_KEY it runs in PREVIEW mode: validates and answers, sends nothing, stores nothing.
const PDF_PATH = "/downloads/3d37dc5bccc01a92/30-website-prompts.pdf";
const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });
  let d;
  try {
    const ct = req.headers.get("content-type") || "";
    d = ct.includes("json") ? await req.json() : Object.fromEntries(await req.formData());
  } catch { return json(400, { ok: false, error: "bad_request" }); }
  if (d.website) return json(200, { ok: true }); // honeypot
  const email = String(d.email || "").trim().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(422, { ok: false, error: "email" });
  if (d.consent !== "yes" && d.consent !== true && d.consent !== "on") return json(422, { ok: false, error: "consent" });
  const order = String(d.order || "").trim().slice(0, 40);
  const news = d.news === "yes" || d.news === "on" || d.news === true;

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[bonus] preview mode: claim accepted, no email sent", { news, hasOrder: !!order });
    return json(200, { ok: true, preview: true });
  }
  const site = process.env.BOOKPILOT_SITE_URL || "https://bookpilot.org";
  const link = site.replace(/\/$/, "") + PDF_PATH;
  const html = `<p>Hi,</p><p>Here is your free bonus for <em>Mastering ChatGPT for Website Development</em>:</p>
<p><a href="${esc(link)}"><strong>Download 30 Website Prompts (PDF)</strong></a></p>
<p>Want the full workflows? <a href="https://www.amazon.com/dp/B0HH8F3V1R">Get the book on Amazon</a>.</p>
<p>Zirlandia Milkovic · BookPilot<br><small>You received this one email because you asked for the PDF on bookpilot.org. ${news ? "You also asked for news about new books; reply STOP to opt out at any time." : "We will not email you again."} Privacy: ${site}/privacy.html</small></p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.BOOKS_MAIL_FROM || "BookPilot Books <hello@bookpilot.org>", to: [email], subject: "Your free PDF: 30 Website Prompts", html }),
  });
  if (!res.ok) { console.error("[bonus] Resend failed", res.status); return json(502, { ok: false, error: "send" }); }
  return json(200, { ok: true });
};
export const config = { path: "/api/bp-bonus" };
