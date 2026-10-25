import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const gitTools = require("./git.cjs");
const fsGuard = require("./fsGuard.cjs");

/** The parser runs on git's own format; the rest uses real throwaway repos, since only trying
 * proves a hostile repo cannot run programs. */

const NUL = "\0";

describe("reading git status", () => {
  it("reads the branch, its upstream and how far apart they are", () => {
    const output = [
      "# branch.oid 1234",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "",
    ].join(NUL);

    expect(gitTools.parseStatus(output)).toMatchObject({
      branch: "main",
      detached: false,
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      files: [],
    });
  });

  it("knows a detached HEAD is not a branch", () => {
    const status = gitTools.parseStatus(`# branch.head (detached)${NUL}`);

    expect(status.detached).toBe(true);
    expect(status.branch).toBeNull();
  });

  it("sorts changes into plain kinds, with staged and unstaged apart", () => {
    const output = [
      "1 .M N... 100644 100644 100644 aaa bbb src/app.ts",
      "1 A. N... 000000 100644 100644 000 ccc src/new file.ts",
      "1 D. N... 100644 000000 000000 ddd 000 old.ts",
      "2 R. N... 100644 100644 100644 eee fff R100 docs/guide.md",
      "guide.md",
      "u UU N... 100644 100644 100644 100644 a b c conflict.ts",
      "? notes.md",
      "",
    ].join(NUL);

    expect(gitTools.parseStatus(output).files).toEqual([
      { path: "src/app.ts", kind: "modified", staged: false, unstaged: true },
      { path: "src/new file.ts", kind: "added", staged: true, unstaged: false },
      { path: "old.ts", kind: "deleted", staged: true, unstaged: false },
      { path: "docs/guide.md", from: "guide.md", kind: "renamed", staged: true, unstaged: false },
      { path: "conflict.ts", kind: "conflicted", staged: true, unstaged: true },
      { path: "notes.md", kind: "untracked", staged: false, unstaged: true },
    ]);
  });

  it("gives paths relative to the project when it sits inside a bigger repository", () => {
    const output = `1 .M N... 100644 100644 100644 a b app/src/main.ts${NUL}? app/readme.md${NUL}`;

    expect(gitTools.parseStatus(output, "app/").files.map((file) => file.path)).toEqual([
      "src/main.ts",
      "readme.md",
    ]);
  });

  it("stops listing after a limit, and says it did", () => {
    const many = Array.from({ length: gitTools.MAX_STATUS_FILES + 5 }, (_, i) => `? f${i}.txt`);
    const status = gitTools.parseStatus(many.join(NUL));

    expect(status.files).toHaveLength(gitTools.MAX_STATUS_FILES);
    expect(status.truncated).toBe(true);
  });

  it("counts changes by kind", () => {
    expect(
      gitTools.countChanges([{ kind: "modified" }, { kind: "modified" }, { kind: "untracked" }]),
    ).toMatchObject({ modified: 2, untracked: 1, added: 0 });
  });
});

describe("turning a path into a pathspec", () => {
  const root = path.resolve("/work/project");

  it("makes it relative, with forward slashes", () => {
    expect(gitTools.toPathspec(root, path.join(root, "src", "app.ts"))).toBe("src/app.ts");
  });

  it("names the project itself as the current folder", () => {
    expect(gitTools.toPathspec(root, root)).toBe(".");
  });

  it("refuses anything outside the project", () => {
    expect(gitTools.toPathspec(root, path.resolve("/work/other/file.ts"))).toBeNull();
  });
});

describe("the flags every call carries", () => {
  function recorder(responses = {}) {
    const calls = [];
    const run = async (args) => {
      calls.push(args);
      const sub = args.find((arg) => ["--version", "rev-parse", "config", "status", "diff"].includes(arg));
      const response = responses[sub] ?? { code: 0, stdout: "" };
      return typeof response === "function" ? response(args) : response;
    };
    return { calls, git: gitTools.createGit({ run }) };
  }

  it("turns off fsmonitor, pagers, pathspec magic and colour on everything", async () => {
    const { calls, git } = recorder();
    await git.status("/repo");

    for (const call of calls.filter((args) => args[0] !== "--version")) {
      expect(call.slice(0, gitTools.SAFE_FLAGS.length)).toEqual(gitTools.SAFE_FLAGS);
    }
    expect(gitTools.SAFE_FLAGS).toContain("core.fsmonitor=false");
    expect(gitTools.SAFE_FLAGS).toContain("--literal-pathspecs");
  });

  it("disarms every filter driver the repository defines", async () => {
    const { calls, git } = recorder({
      config: { code: 0, stdout: "filter.lfs.clean\nfilter.lfs.process\nfilter.evil.clean\n" },
    });
    await git.status("/repo");

    const status = calls.find((args) => args.includes("status"));
    expect(status).toEqual(expect.arrayContaining(["filter.lfs.clean=", "filter.lfs.process=", "filter.evil.clean="]));
    expect(status).toContain("--ignore-submodules=all");
  });

  it("refuses a repository whose driver name could slip past the override", async () => {
    const { calls, git } = recorder({
      config: { code: 0, stdout: "filter.a=b.clean\n" },
    });
    const status = await git.status("/repo");

    expect(status.success).toBe(false);
    expect(calls.some((args) => args.includes("status"))).toBe(false);
  });

  it("keeps external diff tools and textconv off, and paths after --", async () => {
    const { calls, git } = recorder({
      diff: (args) =>
        args.includes("--name-only") ? { code: 0, stdout: `src/a.ts${NUL}` } : { code: 0, stdout: "diff" },
    });
    await git.diff("/repo", { relative: "src/a.ts" });

    const diff = calls.filter((args) => args.includes("diff")).at(-1);
    expect(diff).toEqual(expect.arrayContaining(["--no-ext-diff", "--no-textconv"]));
    expect(diff.slice(diff.indexOf("--"))).toEqual(["--", "src/a.ts"]);
  });

  it("says git is missing rather than failing", async () => {
    const git = gitTools.createGit({ run: async () => ({ code: -1, stdout: "", stderr: "", missing: true }) });

    await expect(git.status("/repo")).resolves.toEqual({ success: true, available: false, isRepo: false });
  });

  it("says a folder is not a repository", async () => {
    const { git } = recorder({ "rev-parse": { code: 128, stdout: "", stderr: "fatal: not a git repository" } });

    await expect(git.status("/repo")).resolves.toEqual({ success: true, available: true, isRepo: false });
  });
});

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasGit)("against a real repository", () => {
  let root;
  const git = gitTools.createGit();

  const run = (...args) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
      cwd: root,
      stdio: "pipe",
      encoding: "utf8",
    });

  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  };

  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "draggy-git-")));
    run("init", "-q", "-b", "main", ".");
    write("readme.md", "hello\n");
    write("src/app.ts", "export const a = 1;\n");
    run("add", ".");
    run("commit", "-q", "-m", "first");
  });

  afterEach(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows can hold a handle on a fresh repository for a moment.
    }
  });

  it("reports a clean tree on its branch", async () => {
    const status = await git.status(root);

    expect(status).toMatchObject({ success: true, available: true, isRepo: true, branch: "main", files: [] });
  });

  it("sees an edit, a new file and a staged one", async () => {
    write("readme.md", "hello again\n");
    write("notes.md", "new\n");
    write("src/staged.ts", "export {};\n");
    run("add", "src/staged.ts");

    const status = await git.status(root);
    const byPath = Object.fromEntries(status.files.map((file) => [file.path, file]));

    expect(byPath["readme.md"]).toMatchObject({ kind: "modified", unstaged: true });
    expect(byPath["notes.md"]).toMatchObject({ kind: "untracked" });
    expect(byPath["src/staged.ts"]).toMatchObject({ kind: "added", staged: true });
  });

  it("diffs one file", async () => {
    write("src/app.ts", "export const a = 2;\n");

    const result = await git.diff(root, { relative: "src/app.ts" });

    expect(result.success).toBe(true);
    expect(result.diff).toContain("-export const a = 1;");
    expect(result.diff).toContain("+export const a = 2;");
  });

  it("scopes a project that is a folder inside the repository", async () => {
    write("readme.md", "outside\n");
    write("src/app.ts", "export const a = 3;\n");

    const status = await git.status(path.join(root, "src"));

    expect(status.files.map((file) => file.path)).toEqual(["app.ts"]);
  });

  it("leaves a tracked credentials file out of a whole-project diff", async () => {
    write(".env", "TOKEN=old\n");
    run("add", ".env");
    run("commit", "-q", "-m", "env");
    write(".env", "TOKEN=super-secret\n");
    write("readme.md", "changed\n");

    const result = await git.diff(root, { allow: (absolute) => fsGuard.isReadable(absolute) });

    expect(result.diff).toContain("+changed");
    expect(result.diff).not.toContain("super-secret");
    expect(result.skipped).toBe(1);
  });

  /** A script that leaves a file behind if anything ever runs it. */
  const trap = () => {
    const marker = path.join(root, "RAN");
    const script = path.join(root, "trap.sh");
    fs.writeFileSync(script, `#!/bin/sh\necho ran > "${marker.split(path.sep).join("/")}"\ncat\n`);
    fs.chmodSync(script, 0o755);
    return { marker, script: script.split(path.sep).join("/") };
  };

  it("does not run a repository's fsmonitor hook", async () => {
    const { marker, script } = trap();
    run("config", "core.fsmonitor", script);
    write("readme.md", "changed\n");

    // The control: plain git does run it, so the check below means something.
    run("status", "--porcelain");
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker);

    await git.status(root);

    expect(fs.existsSync(marker)).toBe(false);
  });

  it("does not run a repository's clean filter on status or diff", async () => {
    const { marker, script } = trap();
    write(".gitattributes", "readme.md filter=evil\n");
    run("add", ".gitattributes");
    run("commit", "-q", "-m", "attributes");
    run("config", "filter.evil.clean", script);
    write("readme.md", "changed\n");

    // The control, as above: even with fsmonitor and external tools off, plain
    // git runs the filter.
    run("-c", "core.fsmonitor=false", "diff", "--no-ext-diff", "--no-textconv");
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker);

    await git.status(root);
    await git.diff(root, {});
    await git.diff(root, { relative: "readme.md" });

    expect(fs.existsSync(marker)).toBe(false);
  });
});

describe.skipIf(!hasGit)("history, branches and changes made by the app", () => {
  let root;
  const git = gitTools.createGit();

  const run = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8" });
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  };

  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "draggy-git-write-")));
    run("init", "-q", "-b", "main", ".");
    run("config", "user.email", "t@t");
    run("config", "user.name", "t");
    write("readme.md", "hello\n");
    run("add", ".");
    run("commit", "-q", "-m", "first");
  });

  afterEach(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows can hold a handle on a fresh repository for a moment.
    }
  });

  it("lists commits, newest first", async () => {
    write("a.txt", "a\n");
    run("add", ".");
    run("commit", "-q", "-m", "second: with a colon");

    const result = await git.log(root, { limit: 10 });

    expect(result.success).toBe(true);
    expect(result.commits.map((commit) => commit.subject)).toEqual(["second: with a colon", "first"]);
    expect(result.commits[0]).toMatchObject({ author: "t" });
    expect(result.commits[0].hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("lists branches and marks the current one", async () => {
    run("branch", "feature");
    const result = await git.branches(root);

    expect(result.branches).toEqual(expect.arrayContaining([{ name: "main", current: true }, { name: "feature", current: false }]));
  });

  it("includes untracked files in the diff as additions when asked", async () => {
    write("new.txt", "brand new\n");

    const without = await git.diff(root, {});
    const withNew = await git.diff(root, { untracked: true });

    expect(without.diff).toBe("");
    expect(withNew.diff).toContain("+++ b/new.txt");
    expect(withNew.diff).toContain("+brand new");
    expect(withNew.files).toBe(1);
  });

  it("cuts a long diff at a whole line and says so", async () => {
    write("big.txt", "x".repeat(100) + "\n");
    run("add", ".");
    run("commit", "-q", "-m", "big");
    write("big.txt", Array.from({ length: 2000 }, (_, i) => `line ${i} ${"y".repeat(40)}`).join("\n") + "\n");

    const result = await git.diff(root, {});

    expect(result.truncated).toBe(true);
    expect(result.diff.length).toBeLessThanOrEqual(gitTools.MAX_DIFF_CHARS);
    expect(result.diff.endsWith("\n")).toBe(true);
  });

  it("stages, unstages and commits", async () => {
    write("a.txt", "a\n");

    expect(await git.stage(root, ["a.txt"])).toMatchObject({ success: true });
    expect((await git.status(root)).files).toEqual([expect.objectContaining({ path: "a.txt", staged: true })]);

    expect(await git.unstage(root, ["a.txt"])).toMatchObject({ success: true });
    expect((await git.status(root)).files).toEqual([expect.objectContaining({ path: "a.txt", kind: "untracked" })]);

    await git.stage(root, ["a.txt"]);
    const done = await git.commit(root, "Add a");
    expect(done.success).toBe(true);
    expect(done.hash).toMatch(/^[0-9a-f]+$/);
    expect(run("log", "-1", "--format=%s").trim()).toBe("Add a");
  });

  it("does not run a hook when it commits", async () => {
    const marker = path.join(root, "hook-ran");
    write(".git/hooks/pre-commit", `#!/bin/sh\ntouch "${marker.split(path.sep).join("/")}"\n`);
    write(".git/hooks/post-commit", `#!/bin/sh\ntouch "${marker.split(path.sep).join("/")}"\n`);
    write("a.txt", "a\n");
    await git.stage(root, ["a.txt"]);

    const done = await git.commit(root, "Add a");

    expect(done.success).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("refuses an empty message and nothing staged", async () => {
    expect((await git.commit(root, "  ")).success).toBe(false);
    expect((await git.commit(root, "Nothing")).success).toBe(false);
  });

  it("switches to an existing branch and refuses odd names", async () => {
    run("branch", "feature");

    expect(await git.checkout(root, "feature")).toMatchObject({ success: true, branch: "feature" });
    expect(run("branch", "--show-current").trim()).toBe("feature");
    expect((await git.checkout(root, "--detach")).success).toBe(false);
    expect((await git.checkout(root, "no-such-branch")).success).toBe(false);
  });

  it("keeps a path that looks like an option from becoming one", async () => {
    write("-n", "x\n");
    expect((await git.stage(root, ["-n"])).success).toBe(true);
    expect((await git.status(root)).files[0].path).toBe("-n");
  });
});
