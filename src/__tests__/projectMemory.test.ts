import { describe, expect, it, vi } from "vitest";
import {
  MAX_MEMORY_CHARS,
  findMemory,
  guessStack,
  initialMemory,
  memoryCandidates,
  renderMemory,
  usefulScripts,
} from "../project/memory";
import type { ProjectScan } from "../project/memory";

/**
 * The project's own instructions. The rule the tests hold to: the closest file
 * to the work wins, nothing is invented for a project that did not say it, and
 * a folder with no file at all costs nothing.
 */

const ROOT = "C:\\projects\\thing";

function reader(files: Record<string, string>) {
  return vi.fn(async (path: string) => files[path] ?? null);
}

describe("where a memory file could be", () => {
  it("looks at the root when nothing in particular is being worked on", () => {
    expect(memoryCandidates(ROOT)).toEqual(["AGENTS.md", "DRAGGY.md"]);
  });

  it("looks in the file's own folder first, then upwards", () => {
    const candidates = memoryCandidates(
      ROOT,
      "C:\\projects\\thing\\packages\\api\\src\\index.ts",
    );

    expect(candidates).toEqual([
      "packages/api/src/AGENTS.md",
      "packages/api/src/DRAGGY.md",
      "packages/api/AGENTS.md",
      "packages/api/DRAGGY.md",
      "packages/AGENTS.md",
      "packages/DRAGGY.md",
      "AGENTS.md",
      "DRAGGY.md",
    ]);
  });

  it("ignores a path from somewhere else entirely", () => {
    expect(memoryCandidates(ROOT, "D:\\other\\file.ts")).toEqual([
      "AGENTS.md",
      "DRAGGY.md",
    ]);
  });

  it("reads a path the way the file system does", () => {
    const candidates = memoryCandidates(ROOT, "c:/projects/thing/src/App.tsx");

    expect(candidates[0]).toBe("src/AGENTS.md");
  });
});

describe("finding one", () => {
  it("takes the root file when that is all there is", async () => {
    const read = reader({ "AGENTS.md": "Always run npm run check.\n" });

    const memory = await findMemory(read, ROOT);

    expect(memory?.path).toBe("AGENTS.md");
    expect(memory?.text).toBe("Always run npm run check.");
  });

  it("prefers the file closest to what is being worked on", async () => {
    const read = reader({
      "AGENTS.md": "The project rule.",
      "packages/api/AGENTS.md": "The API rule.",
    });

    const memory = await findMemory(
      read,
      ROOT,
      "C:\\projects\\thing\\packages\\api\\src\\index.ts",
    );

    expect(memory?.path).toBe("packages/api/AGENTS.md");
    expect(memory?.text).toBe("The API rule.");
  });

  it("accepts the old name as well", async () => {
    const read = reader({ "DRAGGY.md": "Written before AGENTS.md existed." });

    expect((await findMemory(read, ROOT))?.path).toBe("DRAGGY.md");
  });

  it("prefers AGENTS.md when a folder has both", async () => {
    const read = reader({ "AGENTS.md": "new", "DRAGGY.md": "old" });

    expect((await findMemory(read, ROOT))?.text).toBe("new");
  });

  it("walks past a file that is there but empty", async () => {
    const read = reader({ "src/AGENTS.md": "   \n", "AGENTS.md": "The rule." });

    const memory = await findMemory(read, ROOT, "C:\\projects\\thing\\src\\a.ts");

    expect(memory?.path).toBe("AGENTS.md");
  });

  it("says nothing when the project has no instructions", async () => {
    expect(await findMemory(reader({}), ROOT)).toBeNull();
  });

  it("stops carrying one that has grown out of hand", async () => {
    const read = reader({ "AGENTS.md": "x".repeat(MAX_MEMORY_CHARS * 2) });

    const memory = await findMemory(read, ROOT);

    expect(memory?.text).toHaveLength(MAX_MEMORY_CHARS);
  });
});

describe("what the model is told", () => {
  it("names the file and says it outranks its own habits", () => {
    const rendered = renderMemory({ path: "AGENTS.md", text: "Use tabs." });

    expect(rendered).toContain("AGENTS.md");
    expect(rendered).toContain("Use tabs.");
    expect(rendered).toMatch(/outranks/i);
  });
});

describe("the first draft", () => {
  const scan = (extra: Partial<ProjectScan> = {}): ProjectScan => ({
    name: "thing",
    entries: [
      { name: "src", isDirectory: true },
      { name: "docs", isDirectory: true },
      { name: ".git", isDirectory: true },
      { name: "package.json", isDirectory: false },
      { name: "tsconfig.json", isDirectory: false },
    ],
    packageJson: {
      name: "thing",
      scripts: { dev: "vite", check: "tsc && vitest", nested: "x" },
    },
    ...extra,
  });

  it("names the project and what it is built with", () => {
    const draft = initialMemory(scan());

    expect(draft).toContain("# thing");
    expect(draft).toContain("Built with Node, TypeScript.");
  });

  it("writes down the commands that are really there", () => {
    const draft = initialMemory(scan());

    expect(draft).toContain("npm run dev");
    expect(draft).toContain("npm run check");
  });

  it("lists the folders, leaving the hidden ones out", () => {
    const draft = initialMemory(scan());

    expect(draft).toContain("- `src/`");
    expect(draft).toContain("- `docs/`");
    expect(draft).not.toContain(".git/");
  });

  it("leaves what it cannot know as something to fill in", () => {
    const draft = initialMemory(scan());

    expect(draft).toContain("<!-- One or two lines on what this project is. -->");
    expect(draft).toContain("## House rules");
  });

  it("uses the description when the project already has one", () => {
    const draft = initialMemory(
      scan({ packageJson: { name: "thing", description: "A small thing." } }),
    );

    expect(draft).toContain("A small thing.");
    expect(draft).not.toContain("<!-- One or two lines");
  });

  it("says nothing about commands a project without any", () => {
    const draft = initialMemory(
      scan({ packageJson: null, entries: [{ name: "main.py", isDirectory: false }] }),
    );

    expect(draft).not.toContain("## Commands");
  });
});

describe("reading a project", () => {
  it("puts the commands people run first", () => {
    const scripts = usefulScripts({
      zzz: "x",
      test: "vitest",
      dev: "vite",
      lint: "eslint",
    });

    expect(scripts.slice(0, 3)).toEqual(["dev", "test", "lint"]);
  });

  it("keeps the list short", () => {
    const many = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`script-${i}`, "x"]),
    );

    expect(usefulScripts(many)).toHaveLength(6);
  });

  it("guesses the stack from what is lying around", () => {
    expect(
      guessStack({
        name: "x",
        entries: [
          { name: "Cargo.toml", isDirectory: false },
          { name: "Dockerfile", isDirectory: false },
        ],
      }),
    ).toEqual(["Rust", "Docker"]);
  });
});
