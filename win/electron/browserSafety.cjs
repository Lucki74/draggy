"use strict";

/**
 * What the agent may do on a page it does not own: which sites it was let onto, which controls
 * need the user's word first, which fields it must leave to the user, and how fast it may act.
 * Pure, so each rule has a test. Decisions are logged as categories only, never labels or values.
 */

const { log } = require("./logger.cjs");

const SCOPE = "browser.safety";

function originOf(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch (error) {
    log.swallow(SCOPE, error, "not a web address");
    return null;
  }
}

/** The host alone: what the logs may keep of an address (invariant 6). */
function hostOf(url) {
  try {
    return new URL(String(url)).hostname;
  } catch (error) {
    log.swallow(SCOPE, error, "not a web address, host left blank");
    return "";
  }
}

// Words that pay, delete or publish something. Latin words match whole, since "post" is not "postcode".
const RISKY_LATIN =
  /\b(pay|payer|pagar|buy|acheter|comprar|purchase|order|commander|pedir|checkout|delete|supprimer|eliminar|borrar|remove|send|envoyer|enviar|post|publish|publier|publicar|submit|soumettre|subscribe|donate|confirm)\b/i;
const RISKY_CJK = /(оплат|купить|заказ|удал|отправ|опублик|подать|подписа|пожертв|подтверд)/i;
const CLICKABLE = new Set(["button", "link", "menuitem", "checkbox", "switch", "tab", "option"]);

/** Why a click needs the user's word, or null for an ordinary one. */
function riskyAction({ role, name, inputType } = {}) {
  if (inputType === "submit") {
    log.debug(SCOPE, "click needs user word", { category: "form-submit", role: role || "none" });
    return "submits a form";
  }
  if (!role || !CLICKABLE.has(role)) return null;
  const label = String(name || "");
  if (RISKY_LATIN.test(label) || RISKY_CJK.test(label)) {
    log.debug(SCOPE, "click needs user word", { category: "pays-deletes-sends-posts", role });
    return `looks like it pays, deletes, sends or posts ("${label.slice(0, 40)}")`;
  }
  return null;
}

const SENSITIVE_NAME = /(^|[^a-z])(card|cvv|cvc|iban|ssn|passport|token|secret|api[-_ ]?key|otp|passcode|pin|password|passwd)s?([^a-z]|$)/i;
const SENSITIVE_AUTOCOMPLETE = /^(cc-|one-time-code|current-password|new-password)/i;

/** Why a field is the user's to fill in, or null. `attrs` is what the page says about the field. */
function sensitiveField(attrs) {
  if (!attrs || typeof attrs !== "object") return null;
  if (String(attrs.type || "").toLowerCase() === "password") return fieldDecision("password");
  if (SENSITIVE_AUTOCOMPLETE.test(String(attrs.autocomplete || ""))) return fieldDecision("autocomplete");
  for (const key of ["name", "id", "placeholder", "label"]) {
    if (SENSITIVE_NAME.test(String(attrs[key] || ""))) return fieldDecision(`attr-${key}`);
  }
  return null;
}

/** Logs which rule kept the user's hands on a field, then returns the message the agent sees. */
function fieldDecision(rule) {
  log.debug(SCOPE, "field left to user", { rule });
  return rule === "password"
    ? "a password field"
    : rule === "autocomplete"
      ? "a card, password or one-time code field"
      : "a field for a card, ID, password or token";
}

/** Sites the agent may act on. Trusted ones are saved by the caller; a session grant is not. */
function createGrants({ trusted = [], onChange = () => {} } = {}) {
  const always = new Set(trusted);
  const session = new Set();
  const saved = () => [...always];
  return {
    status: (origin) => (always.has(origin) ? "trusted" : session.has(origin) ? "session" : "unknown"),
    allowSession(origin) {
      session.add(origin);
      log.info(SCOPE, "site allowed for session", { host: hostOf(origin) });
    },
    trust(origin) {
      always.add(origin);
      session.delete(origin);
      log.info(SCOPE, "site trusted", { host: hostOf(origin) });
      onChange(saved());
    },
    revoke(origin) {
      const had = always.delete(origin);
      session.delete(origin);
      log.info(SCOPE, "site revoked", { host: hostOf(origin), wasTrusted: had });
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
      if (stamps.length >= max) {
        log.limited("browser.safety.rate", "WARN", SCOPE, "rate limit reached", { max, windowMs });
        return false;
      }
      stamps.push(t);
      return true;
    },
  };
}

module.exports = { originOf, hostOf, riskyAction, sensitiveField, createGrants, createRateLimit };
