/**
 * POST /api/macos-waitlist: adds an email to the Resend "macOS waitlist" segment and sends one confirmation.
 * The answer is the same whether the address is new or already listed, so the route cannot be used to test
 * who signed up. Needs RESEND_API_KEY, RESEND_SEGMENT_ID and RESEND_EMAIL_DOMAIN.
 */
const RESEND = "https://api.resend.com";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 5;
const hits = new Map();

/** Best effort per instance: a cold start resets it, which is fine for a signup form. */
export function limited(ip, now = Date.now()) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

export function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value.trim());
}

async function resend(path, key, body) {
  return fetch(`${RESEND}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false });
  }

  const form = !String(req.headers["content-type"] || "").includes("application/json");
  const done = (status) =>
    form ? res.redirect(303, "/download#macos") : res.status(status).json({ ok: status === 200 });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return done(429);

  const email = req.body?.email;
  if (!validEmail(email)) return done(400);

  const { RESEND_API_KEY: key, RESEND_SEGMENT_ID: segment, RESEND_EMAIL_DOMAIN: domain } = process.env;
  if (!key || !segment || !domain) return done(503);
  const from = `Draggy <hello@${domain}>`;

  const address = email.trim().toLowerCase();
  try {
    const added = await resend("/contacts", key, { email: address, unsubscribed: false, segments: [{ id: segment }] });
    if (added.ok) {
      await resend("/emails", key, {
        from,
        to: [address],
        subject: "You're on the Draggy macOS list",
        text: "Thanks for signing up. We'll send one email when Draggy for macOS is back.\n\nIf this wasn't you, ignore this message and you won't hear from us again.",
      });
    }
  } catch {
    return done(502);
  }
  return done(200);
}
