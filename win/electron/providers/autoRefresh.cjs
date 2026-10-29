/** Keeps every enabled provider's model list current without a setting: shortly after launch, then every
 * few hours, and for a local server whenever the window regains focus. New models join the menu here. */
const { planPins } = require("./autoPin.cjs");
const { log } = require("../logger.cjs");

const FIRST_MS = 30 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const FOCUS_GAP_MS = 60 * 1000;

function createAutoRefresh({ registry, models, accounts = {}, notify = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const lastIds = new Map();
  const lastFocus = new Map();
  let timer = null;
  let stopped = true;

  async function refreshOne(instance) {
    const view = registry.list().find((i) => i.id === instance.id);
    // A turn on the account is using its runtime; the next round lists instead.
    if (view?.kind === "account" && accounts[view.protocol]?.busy?.(instance.id)) return;
    const listed = await models.list(instance.id, { refresh: true }).catch(log.swallowed("providers.autorefresh", "listing failed, skipped", null));
    if (!listed) return;
    const stored = registry.get(instance.id);
    if (!stored) return;
    const ids = listed.map((m) => m.id);
    const plan = planPins({ entry: view, listed: ids, pinned: stored.pinnedModels || [], seen: stored.seenModels });
    const seenChanged = plan.seenModels.length !== (stored.seenModels || []).length || !stored.seenModels;
    if (plan.added.length) registry.update(instance.id, { pinnedModels: plan.pinnedModels, seenModels: plan.seenModels });
    else if (seenChanged) registry.update(instance.id, { seenModels: plan.seenModels });
    const before = lastIds.get(instance.id);
    lastIds.set(instance.id, ids.join("\n"));
    // The first round only seeds; later ones tell the page when the list or the menu moved.
    if (plan.added.length || (before !== undefined && before !== ids.join("\n"))) {
      log.info("providers.autorefresh", "models changed", { id: instance.id, added: plan.added.length, listed: ids.length });
      notify("providers:models-changed", { id: instance.id, added: plan.added });
    }
  }

  async function round(local) {
    for (const instance of registry.list()) {
      if (!instance.enabled || (instance.kind === "local") !== local) continue;
      await refreshOne(instance).catch(log.swallowed("providers.autorefresh", "refresh failed, skipped", null));
    }
  }

  function schedule(delay) {
    timer = setTimer(async () => {
      await round(false);
      await round(true);
      if (!stopped) schedule(EVERY_MS);
    }, delay);
    timer.unref?.();
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    schedule(FIRST_MS);
  }

  function stop() {
    stopped = true;
    if (timer) clearTimer(timer);
    timer = null;
  }

  /** A local server's models change by the user's own action, so the window coming back is the moment to look. */
  async function focused() {
    if (stopped || now() - (lastFocus.get("all") ?? -Infinity) < FOCUS_GAP_MS) return;
    lastFocus.set("all", now());
    await round(true);
  }

  return { start, stop, focused, refreshOne, round };
}

module.exports = { createAutoRefresh, FIRST_MS, EVERY_MS, FOCUS_GAP_MS };
