//! Minimal scriptlets for `##+js(...)` filters, written here rather than bundled from uBlock Origin.
//! Each body is a template: `{{1}}`, `{{2}}` are the filter's arguments, substituted as plain text.

use adblock::resources::{PermissionMask, Resource, ResourceType};
use base64::{Engine as _, engine::general_purpose::STANDARD};

/// Name, body. Each is published as `<name>.js` with `<name>` as an alias, which is how filters name it.
const SCRIPTLETS: [(&str, &str); 4] = [
    (
        "set-constant",
        r#"(() => {
  const path = '{{1}}'.split('.');
  const raw = '{{2}}';
  const value = raw === 'undefined' ? undefined : raw === 'false' ? false : raw === 'true' ? true
    : raw === 'null' ? null : raw === 'emptyStr' ? '' : raw === 'noopFunc' ? () => {}
    : raw === 'trueFunc' ? () => true : raw === 'falseFunc' ? () => false
    : /^-?\d+$/.test(raw) ? Number(raw) : undefined;
  const define = (owner, index) => {
    const key = path[index];
    if (index === path.length - 1) {
      try { Object.defineProperty(owner, key, { configurable: true, get: () => value, set: () => {} }); } catch (_) {}
      return;
    }
    let stored = owner[key];
    try {
      Object.defineProperty(owner, key, {
        configurable: true,
        get: () => stored,
        set: (next) => { stored = next; if (next && typeof next === 'object') define(next, index + 1); },
      });
    } catch (_) {}
    if (stored && typeof stored === 'object') define(stored, index + 1);
  };
  define(window, 0);
})();"#,
    ),
    (
        "abort-on-property-read",
        r#"(() => {
  const path = '{{1}}'.split('.');
  const last = path.pop();
  let owner = window;
  for (const key of path) owner = owner && owner[key];
  if (!owner || typeof owner !== 'object') return;
  try {
    Object.defineProperty(owner, last, {
      configurable: true,
      get() { throw new ReferenceError('{{1}}'); },
      set() {},
    });
  } catch (_) {}
})();"#,
    ),
    (
        "no-setTimeout-if",
        r#"(() => {
  const needle = '{{1}}';
  const delay = '{{2}}';
  const hasDelay = !/^\{\{\d\}\}$/.test(delay);
  const native = window.setTimeout;
  window.setTimeout = function (callback, ms, ...rest) {
    const text = typeof callback === 'function' ? Function.prototype.toString.call(callback) : String(callback);
    const delayMatches = !hasDelay || String(ms) === delay;
    if (text.indexOf(needle) !== -1 && delayMatches) return 0;
    return native.call(window, callback, ms, ...rest);
  };
})();"#,
    ),
    (
        "json-prune",
        r#"(() => {
  const prune = '{{1}}'.split(' ').filter(Boolean);
  const needles = '{{2}}'.split(' ').filter(Boolean);
  const nativeParse = JSON.parse;
  const has = (obj, path) => {
    let o = obj;
    for (const key of path.split('.')) {
      if (!o || typeof o !== 'object' || !(key in o)) return false;
      o = o[key];
    }
    return true;
  };
  const drop = (obj, path) => {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      o = o && typeof o === 'object' ? o[keys[i]] : undefined;
    }
    if (o && typeof o === 'object') delete o[keys[keys.length - 1]];
  };
  JSON.parse = function (text, reviver) {
    const obj = nativeParse.call(this, text, reviver);
    if (!obj || typeof obj !== 'object') return obj;
    if (needles.length && !needles.every((path) => has(obj, path))) return obj;
    for (const path of prune) drop(obj, path);
    return obj;
  };
})();"#,
    ),
];

/// The scriptlets as engine resources, ready for `Engine::use_resources`.
pub fn resources() -> Vec<Resource> {
    SCRIPTLETS
        .iter()
        .map(|(name, body)| Resource {
            name: format!("{name}.js"),
            aliases: vec![(*name).to_owned()],
            kind: ResourceType::Template,
            content: STANDARD.encode(body),
            dependencies: Vec::new(),
            permission: PermissionMask::default(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use adblock::Engine;
    use adblock::lists::{FilterSet, ParseOptions};

    use super::*;

    #[test]
    fn every_scriptlet_is_a_template_with_placeholders() {
        let resources = resources();
        assert_eq!(resources.len(), SCRIPTLETS.len());
        for (resource, (name, body)) in resources.iter().zip(SCRIPTLETS.iter()) {
            assert_eq!(resource.name, format!("{name}.js"));
            assert!(matches!(resource.kind, ResourceType::Template));
            assert!(body.contains("{{1}}"));
            let decoded = STANDARD.decode(&resource.content).expect("base64");
            assert_eq!(decoded, body.as_bytes());
        }
    }

    #[test]
    fn a_filter_injects_its_scriptlet_with_arguments() {
        let mut set = FilterSet::new(false);
        set.add_filter_list(
            "example.test##+js(set-constant, player.ads, true)\n".to_owned(),
            ParseOptions::default(),
        );
        let mut engine = Engine::new_with_filter_set(set);
        engine.use_resources(resources());
        let injected = engine
            .url_cosmetic_resources("https://example.test/watch")
            .injected_script;
        assert!(injected.contains("player.ads"), "{injected}");
        assert!(injected.contains("Object.defineProperty"));
        assert!(!injected.contains("{{1}}"));
    }

    #[test]
    fn a_page_without_the_filter_gets_no_scriptlet() {
        let mut set = FilterSet::new(false);
        set.add_filter_list(
            "example.test##+js(json-prune, ads)\n".to_owned(),
            ParseOptions::default(),
        );
        let mut engine = Engine::new_with_filter_set(set);
        engine.use_resources(resources());
        let injected = engine
            .url_cosmetic_resources("https://other.test/")
            .injected_script;
        assert!(injected.is_empty());
    }
}
