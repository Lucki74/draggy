"use strict";

/**
 * What the agent may do on a page it does not own: which sites it was let onto, which controls
 * need the user's word first, which fields it must leave to the user, and how fast it may act.
 * Pure, so each rule has a test.
 */

function originOf(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** The host alone: what the logs may keep of an address (invariant 6). */
function hostOf(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return "";
  }
}

// Words that pay, delete or publish something. Latin words match whole, since "post" is not "postcode".
const RISKY_LATIN =
  /\b(pay|payer|pagar|buy|acheter|comprar|purchase|order|commander|pedir|checkout|delete|supprimer|eliminar|borrar|remove|send|envoyer|enviar|post|publish|publier|publicar|submit|soumettre|subscribe|donate|confirm)\b/i;
const RISKY_CJK = /(支付|付款|购买|下单|删除|发送|发布|提交|订阅|捐款|确认)/;
const CLICKABLE = new Set(["button", "link", "menuitem", "checkbox", "switch", "tab", "option"]);

/** Why a click needs the user's word, or null for an ordinary one. */
function riskyAction({ role, name, inputType } = {}) {
  if (inputType === "submit") return "submits a form";
  if (!role || !CLICKABLE.has(role)) return null;
  const label = String(name || "");
  if (RISKY_LATIN.test(label) || RISKY_CJK.test(label)) return `looks like it pays, deletes, sends or posts ("${label.slice(0, 40)}")`;
  return null;
}

const SENSITIVE_NAME = /(^|[^a-z])(card|cvv|cvc|iban|ssn|passport|token|secret|api[-_ ]?key|otp|passcode|pin|password|passwd)s?([^a-z]|$)/i;
const SENSITIVE_AUTOCOMPLETE = /^(cc-|one-time-code|current-password|new-password)/i;

/** Why a field is the user's to fill in, or null. `attrs` is what the page says about the field. */
function sensitiveField(attrs) {
  if (!attrs || typeof attrs !== "object") return null;
  if (String(attrs.type || "").toLowerCase() === "password") return "a password field";
  if (SENSITIVE_AUTOCOMPLETE.test(String(attrs.autocomplete || ""))) return "a card, password or one-time code field";
  for (const key of ["name", "id", "placeholder", "label"]) {
    if (SENSITIVE_NAME.test(String(attrs[key] || ""))) return "a field for a card, ID, password or token";
  }
  return null;
}

/** Sites the agent may act on. Trusted ones are saved by the caller; a session grant is not. */
function createGrants({ trusted = [], onChange = () => {} } = {}) {
  const always = new Set(trusted);
  const session = new Set();
  const saved = () => [...always];
  return {
    status: (origin) => (always.has(origin) ? "trusted" : session.has(origin) ? "session" : "unknown"),
    allowSession: (origin) => void session.add(origin),
    trust(origin) {
      always.add(origin);
      session.delete(origin);
      onChange(saved());
    },
    revoke(origin) {
      const had = always.delete(origin);
      session.delete(origin);
      if (had) onChange(saved());
    },
    list: saved,
  };
}

/** A sliding window: at most `max` actions in any `windowMs`. */
function createRateLimit({ max = 60, windowMs = 60000, now = Date.now } = {}) {
  let stamps = [];
  return {
    take() {
      const t = now();
      stamps = stamps.filter((s) => t - s < windowMs);
      if (stamps.length >= max) return false;
      stamps.push(t);
      return true;
    },
  };
}

module.exports = { originOf, hostOf, riskyAction, sensitiveField, createGrants, createRateLimit };
