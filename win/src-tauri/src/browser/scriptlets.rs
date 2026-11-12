//! Minimal scriptlets for `##+js(...)` filters, written here rather than bundled from uBlock Origin.
//! Each body is a template: `{{1}}`, `{{2}}` are the filter's arguments, substituted as plain text.

use adblock::resources::{PermissionMask, Resource, ResourceType};
use base64::{Engine as _, engine::general_purpose::STANDARD};

/// Name, body. Each is published as `<name>.js` with `<name>` as an alias, which is how filters name it.
const SCRIPTLETS: [(&str, &str); 4] = [
    (
        "set-constant",
        r#"(() => {
  const unq = (s) => s.split(String.fromCharCode(92, 117, 48, 48, 50, 55)).join("'");
  const path = unq('{{1}}').split('.');
  const raw = unq('{{2}}');
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
  const unq = (s) => s.split(String.fromCharCode(92, 117, 48, 48, 50, 55)).join("'");
  const path = unq('{{1}}').split('.');
  const last = path.pop();
  let owner = window;
  for (const key of path) owner = owner && owner[key];
  if (!owner || typeof owner !== 'object') return;
  try {
    Object.defineProperty(owner, last, {
      configurable: true,
      get() { throw new ReferenceError(unq('{{1}}')); },
      set() {},
    });
  } catch (_) {}
})();"#,
    ),
    (
        "no-setTimeout-if",
        r#"(() => {
  const unq = (s) => s.split(String.fromCharCode(92, 117, 48, 48, 50, 55)).join("'");
  const needle = unq('{{1}}');
  const delay = unq('{{2}}');
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
  const unq = (s) => s.split(String.fromCharCode(92, 117, 48, 48, 50, 55)).join("'");
  const prune = unq('{{1}}').split(' ').filter(Boolean);
  const needles = unq('{{2}}').split(' ').filter(Boolean);
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

/// Rewrites the arguments of every `##+js(...)` filter so that, once the engine pastes them into a
/// template, they are safe inside a JS string literal: quotes and backslashes become `\uXXXX`.
pub fn escape_args(list: &str) -> String {
    let mut out = String::with_capacity(list.len());
    for line in list.split_inclusive('\n') {
        match line.find("##+js(") {
            Some(start) if line.trim_end().ends_with(')') => {
                let open = start + "##+js(".len();
                let close = line.trim_end().len() - 1;
                out.push_str(&line[..open]);
                out.push_str(&rewrite_args(&line[open..close]));
                out.push_str(&line[close..]);
            }
            _ => out.push_str(line),
        }
    }
    out
}

/// Splits on unescaped commas, undoes filter escapes, then writes each value back with quotes
/// and backslashes as `\uXXXX` escapes that the filter syntax leaves alone.
fn rewrite_args(args: &str) -> String {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = args.chars();
    while let Some(c) = chars.next() {
        if c == BACKSLASH {
            if let Some(next) = chars.next() {
                current.push(next);
            }
        } else if c == ',' {
            parts.push(std::mem::take(&mut current));
        } else {
            current.push(c);
        }
    }
    parts.push(current);
    parts
        .iter()
        .map(|part| encode_arg(part.trim_start()))
        .collect::<Vec<_>>()
        .join(", ")
}

const BACKSLASH: char = '\u{5c}';
const SINGLE_QUOTE: char = '\u{27}';

/// A single quote becomes a text escape for the templates to decode. Backslashes are left alone,
/// since the engine JSON-escapes each argument itself.
fn encode_arg(value: &str) -> String {
    let mut out = String::new();
    for c in value.chars() {
        if c == SINGLE_QUOTE {
            out.push(BACKSLASH);
            out.push_str("u0027");
        } else if c == ',' || c == ')' {
            out.push(BACKSLASH);
            out.push(c);
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod escape_tests {
    use adblock::Engine;
    use adblock::lists::{FilterSet, ParseOptions};

    use super::*;

    #[test]
    fn quote_and_backslash_arguments_stay_inside_the_literal() {
        let list =
            format!("example.test##+js(json-prune, a{SINGLE_QUOTE}b{BACKSLASH}{BACKSLASH}c)\n");
        let mut set = FilterSet::new(false);
        set.add_filter_list(escape_args(&list), ParseOptions::default());
        let mut engine = Engine::new_with_filter_set(set);
        engine.use_resources(resources());
        let injected = engine
            .url_cosmetic_resources("https://example.test/")
            .injected_script;
        let expected = format!("'a{BACKSLASH}{BACKSLASH}u0027b{BACKSLASH}{BACKSLASH}c'");
        assert!(injected.contains(&expected), "{injected}");
        assert!(!injected.contains("'a'b"), "{injected}");
    }
}
