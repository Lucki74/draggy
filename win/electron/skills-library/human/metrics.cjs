// Measures the structure of a prose text. Plain JavaScript, no dependencies.
// Use: put `const TEXT = `...`;` above this code and run it with run_code, or require() it from a script.
function measure(text) {
  const clean = text.replace(/\r\n/g, "\n").replace(/```[\s\S]*?```/g, " ").trim();
  const paras = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const split = (p) => p.replace(/\b(Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e)\./gi, "$1").match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [];
  const words = (s) => s.toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) || [];
  const sents = [];
  const shape = [];
  for (const p of paras) {
    const ss = split(p).map((s) => s.trim()).filter((s) => words(s).length > 0);
    shape.push(ss.length);
    sents.push(...ss);
  }
  const lens = sents.map((s) => words(s).length);
  const all = words(clean);
  const n = lens.length;
  const mean = n ? lens.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  const near = lens.filter((l) => Math.abs(l - mean) <= mean * 0.2).length;
  const openers = {};
  for (const s of sents) {
    const o = words(s).slice(0, 2).join(" ");
    if (o) openers[o] = (openers[o] || 0) + 1;
  }
  // type-token ratio over the first 100 words keeps long and short texts comparable
  const win = all.slice(0, 100);
  const tells = (clean.match(/—|\bnot just\b|\bnot only\b|\b(?:it(?:'s| is)|that(?:'s| is)) not\b|important to note|worth noting|\b(?:Additionally|Moreover|Furthermore),|\bdelve|tapestry|testament|\b(?:serves|stands) as\b|\bboasts?\b|\bIn (?:summary|conclusion)\b|game-chang|\bpivotal\b|\bvibrant\b|\brobust\b|\bseamless(?:ly)?\b|\bleverag(?:e|es|ing)\b|, (?:highlighting|underscoring|reflecting|showcasing|ensuring|demonstrating|fostering)\b/gi) || []).length;
  const r = (x) => Math.round(x * 100) / 100;
  return {
    words: all.length,
    sentences: n,
    meanLen: r(mean),
    lenCV: r(mean ? sd / mean : 0),
    longestShortestRatio: n ? r(Math.max(...lens) / Math.max(1, Math.min(...lens))) : 0,
    shareNearMean: r(n ? near / n : 0),
    ttr100: r(win.length ? new Set(win).size / win.length : 0),
    repeatedOpeners: Object.values(openers).filter((c) => c > 1).reduce((a, c) => a + c, 0),
    paragraphs: paras.length,
    paraShapes: new Set(shape).size,
    tellHitsPer1000: r(all.length ? (tells * 1000) / all.length : 0),
  };
}
if (typeof module !== "undefined") module.exports = { measure };
/* global TEXT */
if (typeof TEXT === "string") process.stdout.write(JSON.stringify(measure(TEXT), null, 1) + "\n");
