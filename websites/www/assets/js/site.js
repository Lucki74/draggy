/*
 * Small jobs, all of them enhancements: every page reads correctly with none
 * of this. Copy a command or a checksum, share a link on a phone, remember a
 * language, mark the header once the page moves and play the recorded clips.
 *
 * Nothing here talks to another server. The version, the file names and the
 * checksums are written into the pages by the build.
 */

/*
 * Written into every page by tools/build.mjs: the strings this file puts on
 * screen, translated.
 */
function readStrings() {
  try {
    return JSON.parse(document.getElementById("draggy-strings").textContent);
  } catch {
    return {};
  }
}

const { copy = "Copy", copied = "Copied", shareText = "", languageName = "" } = readStrings();

/* ---------- which system is this ---------- */

/*
 * The system the visitor is on, or null for a phone, a tablet or anything
 * unknown. Phones and tablets are checked first: an iPhone or an iPad says
 * "Mac OS X" in its user agent, and an iPad that asks for the desktop site
 * says "Macintosh", but a Mac never has a touch screen, so touch means iPad.
 */
function detectOs() {
  const from = navigator.userAgentData?.platform || navigator.platform || "";
  const agent = `${from} ${navigator.userAgent}`.toLowerCase();

  if (/android|iphone|ipad|ipod|mobile/.test(agent)) return null;
  if (agent.includes("mac")) return navigator.maxTouchPoints > 1 ? null : "macos";
  if (agent.includes("linux")) return "linux";
  if (agent.includes("win")) return "windows";
  return null;
}

const OS_NAMES = { windows: "Windows", macos: "macOS", linux: "Linux" };

function markOwnSystem(os) {
  if (!os) return;

  // First launch is written out for all three, open. Somebody who knows their system does not need the other two.
  for (const details of document.querySelectorAll("details.step[data-os]")) {
    if (details.dataset.os !== os) details.open = false;
  }

  for (const label of document.querySelectorAll("[data-os-name]")) {
    label.textContent = OS_NAMES[os];
  }
}

/*
 * The download card for the visitor's own system goes first in the page's order too, not only on screen,
 * so a screen reader reads it first. The stylesheet already puts it first before this runs. The system is
 * the one the head script wrote, which is set before the first paint.
 */
function putOwnSystemFirst(os) {
  const card = os ? document.getElementById(os) : null;
  const cards = card?.parentElement;
  if (!card?.classList.contains("dl") || !cards?.classList.contains("dl-cards")) return;
  cards.prepend(card);
}

/* ---------- copying a command or a checksum ---------- */

/** An <svg><use> pointing into the sprite, built without parsing any markup. */
function icon(href) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", href);
  svg.append(use);
  return svg;
}

function setUpCopy() {
  if (!navigator.clipboard) return;

  // Read out, never shown. No stylesheet defines sr-only, so the hiding is done here.
  const say = document.createElement("span");
  say.className = "sr-only";
  say.setAttribute("role", "status");
  Object.assign(say.style, {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  });
  document.body.append(say);

  for (const code of document.querySelectorAll("code[data-copy], [data-copyable] code, .wiki-body pre code")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.title = copy;
    button.setAttribute("aria-label", copy);
    button.append(icon("#i-copy"));

    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent.trim());
      } catch {
        return;
      }

      button.querySelector("use").setAttribute("href", "#i-check");
      say.textContent = copied;

      setTimeout(() => {
        button.querySelector("use").setAttribute("href", "#i-copy");
        say.textContent = "";
      }, 1800);
    });

    if (code.parentElement?.tagName === "PRE") {
      code.parentElement.append(button);
    } else {
      code.after(button);
    }
  }
}

/* ---------- the language the visitor picked ---------- */

/*
 * middleware.js decides which language somebody lands in, from the country
 * their address is in. Choosing one from the menu has to outrank that guess,
 * so the choice is written where the edge can read it on the next visit.
 */
function rememberLanguage() {
  for (const link of document.querySelectorAll(".lang li a, .langlist a")) {
    link.addEventListener("click", () => {
      const code = link.getAttribute("lang");
      if (!code) return;

      // A year, across the whole site. It is read by the edge on the way in
      // and by nothing else; there is no server here but the one handing out
      // files.
      document.cookie = `draggy-lang=${code}; path=/; max-age=31536000; samesite=lax`;
    });
  }
}

/*
 * The menu's accessible name is "Language: English", so a voice user who says
 * the visible name can activate it (WCAG 2.5.3). The name is written here from
 * the translated pattern, because the visible name is only known once the page
 * is built.
 */
function setUpLanguageMenu() {
  for (const menu of document.querySelectorAll("details.lang")) {
    const summary = menu.querySelector("summary");
    if (summary && languageName) {
      summary.setAttribute("aria-label", languageName.replace("{name}", summary.textContent.trim()));
    }
  }

  // Escape shuts the open menu and hands the focus back to the button that opened it.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const menu of document.querySelectorAll("details.lang[open]")) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
  });
}

/* ---------- wiki ---------- */

/* Shares or copies the site link on phones where no installer runs. */
function setUpShareLink() {
  const button = document.querySelector("[data-share-link]");
  if (!button) return;

  button.addEventListener("click", async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Draggy",
          text: shareText || undefined,
          url: window.location.href,
        });
        return;
      } catch (error) {
        // Closing the sheet rejects with AbortError. The visitor chose not to share, so the link is not copied behind their back.
        if (error?.name === "AbortError") return;
        /* the sheet refused for another reason: copy the link instead */
      }
    }
    try {
      await navigator.clipboard.writeText(window.location.href);
      const span = button.querySelector("span");
      if (span) {
        const orig = span.textContent;
        span.textContent = copied;
        setTimeout(() => {
          span.textContent = orig;
        }, 1800);
      }
    } catch {
      /* no clipboard here: the address bar still has the link */
    }
  });
}

/* ---------- the system the download button is for ---------- */

/*
 * The head script sets html[data-os] from the visitor's system before the first paint, and the CSS shows the download for it.
 * The switch beside the button sets the same attribute, so the label, the file and the size change together. The switch is
 * in the first paint already, so it does not move the page when this runs. Without script the head hides it.
 */
function setUpOsSwitch() {
  const switches = [...document.querySelectorAll("[data-os-switch]")];
  if (!switches.length) return;
  const root = document.documentElement;

  const show = () => {
    for (const control of switches) {
      for (const button of control.querySelectorAll("[data-os-pick]")) {
        button.setAttribute("aria-pressed", String(button.dataset.osPick === root.dataset.os));
      }
    }
  };

  for (const control of switches) {
    control.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-os-pick]");
      if (!button || !control.contains(button)) return;
      root.dataset.os = button.dataset.osPick;
      show();
    });
  }
  show();
}

/* ---------- the clips ---------- */

/*
 * Each clip is a light and a dark <video>, and the CSS shows one. One clip plays at a time: the one most
 * in view, and only while at least half of it is. Clips start only after the page has loaded, and only if
 * the visitor has not asked for less motion. A clip that leaves the view
 * stops. Its play button always works, and so does expand, which opens the shown take at full size in one
 * shared <dialog>.
 */
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const clips = [];
const ratios = new Map();
const near = new Set();
let loaded = document.readyState === "complete";
let dialog = null;

/** A clip plays only while at least this much of it is in view. */
const HALF = 0.5;

/** The watch observer reports every 5% of a clip coming into view, so the ratios it keeps stay close to true. */
const STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

/** A clip fades in from white or black over its first half second. Stopped inside that, it shows its poster, not the blank frame. */
const FADE_IN = 0.5;

/** Autoplay waits for the load, and stays off under reduced motion. */
const mayAutoplay = () => loaded && !calm.matches;

/** The take the system theme shows: the one that is not display: none. */
const shown = (clip) => clip.videos.find((video) => video.offsetParent !== null) ?? clip.videos[0];

/** Safari before 14 has no addEventListener on a MediaQueryList, only the older addListener. */
function onChange(query, listener) {
  if (query.addEventListener) query.addEventListener("change", listener);
  else query.addListener(listener);
}

/**
 * The candidate to play: the most in view, of those at least half visible. A tie goes to the one nearest
 * the middle of the screen, the smaller gap. Each candidate is { clip, ratio, gap }. Returns the candidate, or null.
 */
function mostVisible(candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (candidate.ratio < HALF) continue;
    if (!best || candidate.ratio > best.ratio || (candidate.ratio === best.ratio && candidate.gap < best.gap)) {
      best = candidate;
    }
  }
  return best;
}

/** How far the middle of a clip is from the middle of the screen, in pixels. */
function gapTo(clip) {
  const box = clip.frame.getBoundingClientRect();
  return Math.abs(box.top + box.height / 2 - innerHeight / 2);
}

function setToggle(clip, playing) {
  const toggle = clip.toggle;
  if (!toggle) return;
  toggle.querySelector("use")?.setAttribute("href", playing ? "#i-pause" : "#i-play");
  toggle.setAttribute("aria-label", playing ? toggle.dataset.pause : toggle.dataset.play);
}

function stop(clip) {
  for (const video of clip.videos) {
    video.pause();
    // Stopped inside the fade-in, a video keeps its blank frame. load() puts the poster back. A take that has
    // never played has readyState 0 and nothing to reset.
    if (video.readyState > 0 && video.currentTime < FADE_IN) video.load();
  }
  setToggle(clip, false);
}

function start(clip) {
  for (const other of clips) if (other !== clip) stop(other);

  const playing = shown(clip).play();
  setToggle(clip, true);
  playing?.catch(() => setToggle(clip, false));
}

/**
 * Decides what plays. Of the clips the visitor wants playing, the most visible one plays and the rest stop.
 * It runs whenever what is in view changes. While autoplay is off, only clips that have left the view stop.
 */
function settle() {
  if (dialog?.open) return;

  if (!mayAutoplay()) {
    for (const clip of clips) if ((ratios.get(clip) ?? 0) < HALF) stop(clip);
    return;
  }

  const best = mostVisible(
    clips.filter((clip) => clip.wanted).map((clip) => ({ clip, ratio: ratios.get(clip) ?? 0, gap: gapTo(clip) })),
  );
  for (const clip of clips) if (clip !== best?.clip) stop(clip);
  if (best && shown(best.clip).paused) start(best.clip);
}

function buildDialog() {
  const el = document.createElement("dialog");
  el.className = "clip-dialog";

  const bar = document.createElement("form");
  bar.method = "dialog";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "clip-toggle";
  close.setAttribute("aria-label", document.querySelector("[data-clip-close]")?.dataset.close || "Close");
  close.append(icon("#i-x"));
  close.addEventListener("click", () => el.close());
  bar.append(close);
  el.append(bar);

  el.addEventListener("close", () => {
    el.querySelector("video")?.remove();
    settle();
  });

  document.body.append(el);
  return el;
}

function expand(clip) {
  const source = shown(clip);
  if (!dialog) dialog = buildDialog();

  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.controls = true;
  video.poster = source.poster || source.dataset.poster || "";
  video.setAttribute("aria-label", source.getAttribute("aria-label") || "");
  for (const sourceTag of source.querySelectorAll("source")) video.append(sourceTag.cloneNode());

  for (const other of clips) stop(other);
  dialog.append(video);
  dialog.showModal?.();
  video.play()?.catch(() => {});
}

/** Set the poster of the take on show, once. A hidden take keeps none, so it fetches none. */
function givePoster(clip) {
  const video = shown(clip);
  if (video.offsetParent !== null && !video.poster && video.dataset.poster) video.poster = video.dataset.poster;
}

function setUpClips() {
  for (const figure of document.querySelectorAll("figure.clip[data-clip]")) {
    const clip = {
      frame: figure.querySelector(".clip-frame"),
      videos: [...figure.querySelectorAll("video")],
      toggle: figure.querySelector(".clip-toggle"),
      expand: figure.querySelector(".clip-expand"),
      wanted: true,
    };
    if (!clip.frame || !clip.videos.length) continue;
    clips.push(clip);
    setToggle(clip, false);

    clip.toggle?.addEventListener("click", () => {
      if (shown(clip).paused) {
        clip.wanted = true;
        start(clip);
      } else {
        clip.wanted = false;
        stop(clip);
      }
    });
    clip.expand?.addEventListener("click", () => expand(clip));
  }

  if (!clips.length || !("IntersectionObserver" in window)) return;

  // Posters load late: only the take on show, and only once its clip is within a screen of the view.
  const posters = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const clip = clips.find((item) => item.frame === entry.target);
        if (clip) {
          near.add(clip);
          givePoster(clip);
        }
      }
    },
    { rootMargin: "300px 0px" },
  );
  for (const clip of clips) posters.observe(clip.frame);

  // Every entry of a batch updates its clip's ratio first, then the choice is made once from all of them.
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const clip = clips.find((item) => item.frame === entry.target);
        if (clip) ratios.set(clip, entry.intersectionRatio);
      }
      settle();
    },
    { threshold: STEPS },
  );
  for (const clip of clips) watch.observe(clip.frame);

  addEventListener("load", () => {
    loaded = true;
    settle();
  });
}

/**
 * After the take on show has changed: a playing clip stops, a clip near the view gets the poster of the new take,
 * and the most visible clip plays again. The take is chosen by CSS from the theme, so only the playback is redone here.
 */
function retakeClips() {
  for (const clip of clips) stop(clip);
  for (const clip of near) givePoster(clip);
  settle();
}

/*
 * Without script the five features stack, each with its clip. With script they become one tabbed panel: a tablist of their
 * titles, arrow keys (Home and End too) to move between them, and only the chosen feature shown. A hidden clip is out of
 * view, so it never starts, and a clip that is hidden stops at once rather than waiting for the next scroll.
 */
function setUpFeatureTabs() {
  const section = document.querySelector("#features");
  const panels = section ? [...section.querySelectorAll(".feature")] : [];
  if (panels.length < 2) return;

  const list = document.createElement("div");
  list.className = "feature-tabs";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", section.querySelector("h2")?.textContent.trim() ?? "");
  const ind = document.createElement("i");
  ind.className = "ind";
  ind.setAttribute("aria-hidden", "true");
  list.append(ind);

  const tabs = panels.map((panel) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = `${panel.id}-tab`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    tab.textContent = panel.querySelector("h3")?.textContent.trim() ?? "";
    list.append(tab);

    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    return tab;
  });

  const place = (index) => {
    const tab = tabs[index];
    if (!tab.offsetWidth) return;
    ind.style.width = `${tab.offsetWidth}px`;
    ind.style.height = `${tab.offsetHeight}px`;
    ind.style.transform = `translate(${tab.offsetLeft}px, ${tab.offsetTop}px)`;
  };
  let current = 0;

  /* The chosen tab paints its own fill once the indicator has landed under it, so its text always sits on its colour. */
  let settle = 0;
  const settled = () => tabs.forEach((tab, i) => tab.classList.toggle("settled", i === current));
  const land = () => {
    tabs.forEach((tab) => tab.classList.remove("settled"));
    clearTimeout(settle);
    if (!list.classList.contains("ready")) settled();
    else settle = setTimeout(settled, 560);
  };

  const select = (index) => {
    current = index;
    place(index);
    land();
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
      if (!on) {
        for (const clip of clips) {
          if (panels[i].contains(clip.frame)) {
            stop(clip);
            ratios.set(clip, 0);
          }
        }
      }
    });
  };

  tabs.forEach((tab, index) => tab.addEventListener("click", () => select(index)));

  list.addEventListener("keydown", (event) => {
    const at = tabs.indexOf(event.target);
    if (at < 0) return;
    const last = tabs.length - 1;
    const to = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    select(to);
    tabs[to].focus();
  });

  panels[0].before(list);
  select(0);
  section.dataset.tabs = "";
  place(0);
  requestAnimationFrame(() => list.classList.add("ready"));
  const snap = () => {
    list.classList.remove("ready");
    place(current);
    list.offsetWidth;
    settled();
    requestAnimationFrame(() => list.classList.add("ready"));
  };
  window.addEventListener("resize", snap);
  document.fonts?.ready.then(snap);
}

/* ---------- the theme ---------- */

/* The theme is the system's alone. CSS picks the colours and the take; a change in the system retakes the clips. */
function setUpTheme() {
  onChange(matchMedia("(prefers-color-scheme: dark)"), retakeClips);
}

/* ---------- the home page ---------- */

/** The provider logos run in a random order each visit, twice over so the loop has no gap. The second run is hidden from readers. */
function setUpMarquee() {
  const track = document.querySelector("[data-marquee]");
  if (!track) return;

  const logos = [...track.children];
  for (let i = logos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [logos[i], logos[j]] = [logos[j], logos[i]];
  }
  track.append(...logos);

  for (const logo of logos) {
    const copy = logo.cloneNode(true);
    copy.removeAttribute("role");
    copy.removeAttribute("aria-label");
    copy.setAttribute("aria-hidden", "true");
    track.append(copy);
  }
  track.dataset.running = "";
}

/** The headline arrives a word at a time. Each word keeps its place in the text, so it reads the same without the motion. */
function setUpWordReveal() {
  for (const heading of document.querySelectorAll("[data-words]")) {
    let n = 0;
    const wrap = (node) => {
      const span = document.createElement("span");
      span.className = "w";
      span.style.setProperty("--i", String(n++));
      node.replaceWith(span);
      span.append(node);
    };
    for (const node of [...heading.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        wrap(node);
        continue;
      }
      const parts = node.textContent.split(/(\s+)/);
      const pieces = parts.map((part) => {
        if (!part.trim()) return document.createTextNode(part);
        const span = document.createElement("span");
        span.className = "w";
        span.style.setProperty("--i", String(n++));
        span.textContent = part;
        return span;
      });
      node.replaceWith(...pieces);
    }
    heading.dataset.revealed = "";
  }
}

/** The three sentences hold the screen while the page scrolls under them. The one in turn is marked, and CSS does the rest. */
function setUpStage() {
  const stage = document.querySelector("[data-stage]");
  if (!stage || calm.matches) return;
  const lines = [...stage.querySelectorAll(".stage-line")];
  stage.dataset.live = "";

  let waiting = false;
  const update = () => {
    waiting = false;
    const box = stage.getBoundingClientRect();
    const run = box.height - innerHeight;
    const p = run > 0 ? Math.min(1, Math.max(0, -box.top / run)) : 0;
    const active = Math.min(lines.length - 1, Math.floor(p * lines.length));
    stage.style.setProperty("--p", p.toFixed(3));
    lines.forEach((line, i) => line.toggleAttribute("data-on", i === active));
  };
  addEventListener(
    "scroll",
    () => {
      if (waiting) return;
      waiting = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );
  update();
}

/** A question opens and closes with a slide of its height and a rise of its answer. Only one is open at a time. Under reduced motion it just toggles. */
function setUpFaq() {
  const items = [...document.querySelectorAll(".faq-list details")];
  const toggles = new Map();
  for (const item of items) {
    const summary = item.querySelector("summary");
    const answer = item.querySelector(":scope > :not(summary)");
    if (!summary || !answer) continue;
    let motion = null;

    const toggle = (opening) => {
      motion?.cancel();
      if (calm.matches) {
        item.open = opening;
        return;
      }

      const from = item.offsetHeight;
      if (opening) item.open = true;
      const to = opening ? item.offsetHeight : summary.offsetHeight;
      item.style.overflow = "hidden";

      motion = item.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      answer.animate(
        opening
          ? [{ transform: "translateY(-8px)", opacity: 0 }, { transform: "none", opacity: 1 }]
          : [{ transform: "none", opacity: 1 }, { transform: "translateY(-8px)", opacity: 0 }],
        { duration: 280, easing: "ease-out" },
      );
      motion.onfinish = () => {
        item.style.overflow = "";
        if (!opening) item.open = false;
        motion = null;
      };
      motion.oncancel = () => {
        item.style.overflow = "";
      };
    };

    toggles.set(item, toggle);
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      const opening = !item.open;
      if (opening) for (const other of items) if (other !== item && other.open) toggles.get(other)?.(false);
      toggle(opening);
    });
  }
}

/* ---------- wiki contents ---------- */

/* Marks the section being read in "On this page": the last heading that has passed the top of the window. */
function setUpWikiContents() {
  const links = [...document.querySelectorAll(".wiki-toc a[href^='#']")];
  if (!links.length) return;
  const heads = links.map((link) => document.getElementById(link.getAttribute("href").slice(1))).filter(Boolean);

  const mark = () => {
    let current = heads[0];
    for (const head of heads) if (head.getBoundingClientRect().top <= 96) current = head;
    for (const link of links) {
      if (link.getAttribute("href") === "#" + current.id) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };

  window.addEventListener("scroll", mark, { passive: true });
  mark();
}

/* ---------- go ---------- */

/** One setup, run on its own, so a throw in one leaves the rest working. */
function attempt(setup) {
  try {
    setup();
  } catch (error) {
    console.error(error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  attempt(() => markOwnSystem(detectOs()));
  attempt(() => putOwnSystemFirst(document.documentElement.dataset.os));
  attempt(rememberLanguage);
  attempt(setUpLanguageMenu);
  attempt(setUpCopy);
  attempt(setUpShareLink);
  attempt(setUpOsSwitch);
  attempt(setUpClips);
  attempt(setUpFeatureTabs);
  attempt(setUpTheme);
  attempt(setUpMarquee);
  attempt(setUpWordReveal);
  attempt(setUpStage);
  attempt(setUpFaq);
  attempt(setUpWikiContents);
});
