(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const body = document.body;

  // mobile drawer
  const menuBtn = $(".menu-btn");
  const scrim = $(".scrim");
  const setMenu = (open) => {
    body.classList.toggle("menu-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    scrim.hidden = !open;
  };
  menuBtn?.addEventListener("click", () => setMenu(!body.classList.contains("menu-open")));
  scrim?.addEventListener("click", () => setMenu(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && body.classList.contains("menu-open")) {
      setMenu(false);
      menuBtn.focus();
    }
  });

  // the current page stays in view in a long sidebar
  const side = $(".side");
  const here = $(".side a[aria-current]");
  if (side && here) {
    const below = here.getBoundingClientRect().bottom - side.getBoundingClientRect().bottom;
    if (below > 0) side.scrollTop = below + 48;
  }

  // language menu closes on outside click
  const lang = $(".lang");
  document.addEventListener("click", (e) => {
    if (lang?.open && !lang.contains(e.target)) lang.open = false;
  });

  // copy buttons
  $$(".copy").forEach((b) =>
    b.addEventListener("click", async () => {
      const code = $("code", b.closest(".code"));
      const label = $("span", b);
      try {
        await navigator.clipboard.writeText(code.textContent);
        label.textContent = b.dataset.done;
        setTimeout(() => (label.textContent = b.dataset.copy), 1500);
      } catch {
        const r = document.createRange();
        r.selectNodeContents(code);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      }
    }),
  );

  // table of contents highlight
  const links = $$(".toc a");
  if (links.length && "IntersectionObserver" in window) {
    const map = new Map(links.map((a) => [a.hash.slice(1), a]));
    const heads = [...map.keys()].map((id) => document.getElementById(id)).filter(Boolean);
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          links.forEach((a) => a.removeAttribute("aria-current"));
          map.get(en.target.id)?.setAttribute("aria-current", "true");
        }
      },
      { rootMargin: "-88px 0px -70% 0px" },
    );
    heads.forEach((h) => io.observe(h));
  }

  // search
  const dlg = $(".search");
  const input = $(".search-input");
  const status = $(".search-status");
  const list = $(".search-results");
  const btn = $(".search-btn");
  let index = null;
  let loading = null;
  const load = () =>
    (loading ??= fetch(body.dataset.search)
      .then((r) => r.json())
      .then((d) => (index = d))
      .catch(() => (index = [])));
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const open = () => {
    load();
    if (!dlg.open) dlg.showModal();
    input.focus();
    input.select();
  };
  btn?.addEventListener("click", open);
  $$(".home-search").forEach((b) => b.addEventListener("click", open));
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      open();
    } else if (e.key === "/" && !/input|textarea/i.test(document.activeElement?.tagName || "") && !dlg.open) {
      e.preventDefault();
      open();
    }
  });
  dlg?.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });

  const snippet = (text, terms) => {
    const n = norm(text);
    let at = -1;
    for (const t of terms) {
      at = n.indexOf(t);
      if (at >= 0) break;
    }
    const start = Math.max(0, at - 40);
    return (start ? "…" : "") + text.slice(start, start + 140) + (text.length > start + 140 ? "…" : "");
  };
  const mark = (parent, text, terms) => {
    const n = norm(text);
    const hits = [];
    for (const t of terms) {
      let i = n.indexOf(t);
      while (i >= 0) {
        hits.push([i, i + t.length]);
        i = n.indexOf(t, i + t.length);
      }
    }
    hits.sort((a, b) => a[0] - b[0]);
    let pos = 0;
    for (const [a, b] of hits) {
      if (a < pos) continue;
      parent.append(text.slice(pos, a));
      const m = document.createElement("mark");
      m.textContent = text.slice(a, b);
      parent.append(m);
      pos = b;
    }
    parent.append(text.slice(pos));
  };

  const run = () => {
    const q = norm(input.value.trim());
    list.replaceChildren();
    if (!q) {
      status.textContent = body.dataset.hint;
      return;
    }
    const terms = q.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const p of index || []) {
      const title = norm(p.t);
      const text = norm(p.x);
      let score = 0;
      let ok = true;
      let hit = null;
      for (const t of terms) {
        let s = 0;
        if (title.includes(t)) s += 10;
        const h = p.h.find((x) => norm(x.t).includes(t));
        if (h) {
          s += 5;
          if (!title.includes(t)) hit ||= h;
        }
        if (text.includes(t)) s += 1;
        if (!s) ok = false;
        score += s;
      }
      if (ok) scored.push({ p, score, hit });
    }
    scored.sort((a, b) => b.score - a.score);
    status.textContent = scored.length ? "" : body.dataset.none;
    // keep best-first order, with pages of one section side by side
    const groups = new Map();
    for (const row of scored.slice(0, 8)) {
      if (!groups.has(row.p.s)) groups.set(row.p.s, []);
      groups.get(row.p.s).push(row);
    }
    for (const [label, rows] of groups) {
      const group = document.createElement("li");
      if (label) {
        const name = document.createElement("p");
        name.className = "search-group";
        name.textContent = label;
        group.append(name);
      }
      const ul = document.createElement("ul");
      for (const { p, hit } of rows) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = p.u + (hit ? `#${hit.i}` : "");
        const s = document.createElement("strong");
        mark(s, p.t, terms);
        if (hit) {
          const at = document.createElement("small");
          at.append(" / ");
          mark(at, hit.t, terms);
          s.append(at);
        }
        const d = document.createElement("span");
        mark(d, snippet(p.x, terms), terms);
        a.append(s, d);
        li.append(a);
        ul.append(li);
      }
      group.append(ul);
      list.append(group);
    }
  };
  input?.addEventListener("input", () => (index ? run() : load().then(run)));
  input?.addEventListener("keydown", (e) => {
    const items = $$("a", list);
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items.at(-1).focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      location.href = items[0].href;
    }
  });
  list?.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = $$("a", list);
    const cur = items.indexOf(document.activeElement);
    (items[cur + (e.key === "ArrowDown" ? 1 : -1)] || input).focus();
  });

  // platform picker: opens on the visitor's system and stores nothing.
  // Without this script all three panels stay visible under their names.
  const ua = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
  const mine = /mac|iphone|ipad/i.test(ua) ? "macos" : /linux|x11|android|cros/i.test(ua) ? "linux" : "windows";
  $$("[data-platforms]").forEach((box, n) => {
    const panels = $$(".platform", box);
    const bar = document.createElement("div");
    bar.className = "platform-tabs";
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", box.dataset.platforms);
    const pick = (i, focus) => {
      tabs.forEach((t, k) => {
        t.setAttribute("aria-selected", String(k === i));
        t.tabIndex = k === i ? 0 : -1;
        panels[k].hidden = k !== i;
      });
      if (focus) tabs[i].focus();
    };
    const tabs = panels.map((panel, i) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.id = `os-${n}-${panel.dataset.os}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", `${tab.id}-panel`);
      tab.textContent = $(".platform-name", panel).textContent;
      tab.addEventListener("click", () => pick(i));
      panel.id = `${tab.id}-panel`;
      panel.tabIndex = 0;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      bar.append(tab);
      return tab;
    });
    bar.addEventListener("keydown", (e) => {
      const cur = tabs.indexOf(document.activeElement);
      const to = { ArrowRight: cur + 1, ArrowLeft: cur - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      pick((to + tabs.length) % tabs.length, true);
    });
    box.prepend(bar);
    box.classList.add("is-tabbed");
    pick(Math.max(0, panels.findIndex((p) => p.dataset.os === mine)));
  });
})();
