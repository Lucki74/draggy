// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_ARGS_BYTES,
  MAX_CUSTOM_FILE_BYTES,
  expandCustomCommand,
  parseCustomFile,
  renderCustomBody,
  type CustomCommand,
} from "../chat/customCommands";
import { matchSlashCommands } from "../chat/slashCommands";
import { usableCustomCommands } from "../chat/customCommands";

/** Project commands are prompt templates: the typed line becomes the body, with the arguments in. */

const review: CustomCommand = { id: "review", kind: "command", source: "project", description: "Review a change", body: "Review $ARGUMENTS carefully." };
const plan: CustomCommand = { id: "plan", kind: "command", source: "project", description: "Plan", body: "Make a plan." };
const helper: CustomCommand = { id: "helper", kind: "agent", source: "project", description: "Helps", body: "Be brief." };

describe("parseCustomFile", () => {
  it("takes the name from the file and the description from frontmatter", () => {
    const parsed = parseCustomFile("Review.md", "---\ndescription: Review a diff\n---\nCheck it.", "command");
    expect(parsed).toMatchObject({ id: "review", description: "Review a diff", body: "Check it.", kind: "command" });
  });

  it("falls back to the first body line when there is no description", () => {
    const parsed = parseCustomFile("plan.md", "Make a plan.\nMore.", "command");
    expect(parsed?.description).toBe("Make a plan.");
  });

  it("refuses names that cannot be typed after a slash", () => {
    expect(parseCustomFile("bad name.md", "x", "command")).toBeNull();
    expect(parseCustomFile("-lead.md", "x", "command")).toBeNull();
  });

  it("refuses empty and oversized files", () => {
    expect(parseCustomFile("empty.md", "---\ndescription: none\n---\n", "command")).toBeNull();
    expect(parseCustomFile("big.md", "a".repeat(MAX_CUSTOM_FILE_BYTES + 1), "command")).toBeNull();
  });

  it("reads agent frontmatter but keeps it advisory", () => {
    const parsed = parseCustomFile(
      "helper.md",
      "---\ndescription: Helps\nmodel: small\ntools: [read, grep]\npermissions: ask\n---\nBe brief.",
      "agent",
    );
    expect(parsed).toMatchObject({ kind: "agent", model: "small", tools: ["read", "grep"], permissions: "ask" });
  });

  it("handles CRLF line endings", () => {
    const parsed = parseCustomFile("crlf.md", "---\r\ndescription: Win\r\n---\r\nBody here.", "command");
    expect(parsed).toMatchObject({ description: "Win", body: "Body here." });
  });
});

describe("renderCustomBody", () => {
  it("puts the arguments where $ARGUMENTS stands", () => {
    expect(renderCustomBody("Fix $ARGUMENTS now $ARGUMENTS", "bug 4")).toBe("Fix bug 4 now bug 4");
  });

  it("appends the arguments when the body has no placeholder", () => {
    expect(renderCustomBody("Summarise.", "the log")).toBe("Summarise.\n\nthe log");
    expect(renderCustomBody("Summarise.", "")).toBe("Summarise.");
  });
});

describe("expandCustomCommand", () => {
  it("sends a line unchanged when its arguments pass the size cap", () => {
    const long = "x".repeat(MAX_CUSTOM_ARGS_BYTES + 1);
    expect(expandCustomCommand(`/review ${long}`, [review])).toBe(`/review ${long}`);
    const fits = "y".repeat(MAX_CUSTOM_ARGS_BYTES);
    expect(expandCustomCommand(`/review ${fits}`, [review])).toContain(fits);
  });

  it("expands a command line into its prompt", () => {
    expect(expandCustomCommand("/review the login page", [review])).toBe("Review the login page carefully.");
  });

  it("matches the name without regard to case", () => {
    expect(expandCustomCommand("/REVIEW auth", [review])).toBe("Review auth carefully.");
  });

  it("leaves a message alone when it is not a known command", () => {
    expect(expandCustomCommand("/dev/null is a file", [review])).toBe("/dev/null is a file");
    expect(expandCustomCommand("please /review this", [review])).toBe("please /review this");
    expect(expandCustomCommand("/unknown x", [review])).toBe("/unknown x");
  });

  it("gives an agent its instructions ahead of the task", () => {
    const out = expandCustomCommand("/helper list files", [helper]);
    expect(out.startsWith('Work as the agent "helper"')).toBe(true);
    expect(out.endsWith("Be brief.\n\nlist files")).toBe(true);
  });

  it("runs a bare command with no arguments", () => {
    expect(expandCustomCommand("/plan", [plan])).toBe("Make a plan.");
  });
});

describe("slash menu with custom commands", () => {
  it("offers custom commands next to built-ins", () => {
    const ids = matchSlashCommands("/re", { custom: [review] }).map((command) => command.id);
    expect(ids).toContain("review");
  });

  it("does not let a custom command shadow a built-in", () => {
    const shadow: CustomCommand = { ...review, id: "new", description: "Fake" };
    const hits = matchSlashCommands("/new", { custom: [shadow] });
    expect(hits.filter((command) => command.id === "new")).toHaveLength(1);
    expect(hits.find((command) => command.id === "new")?.description).toBeUndefined();
  });

  it("shows a custom command's description and takes an argument", () => {
    const hit = matchSlashCommands("/pla", { custom: [plan] }).find((command) => command.id === "plan");
    expect(hit).toMatchObject({ description: "Plan", takesArgument: true });
  });
});

describe("custom command edge cases", () => {
  it("accepts a 64 KB file and refuses one byte more", () => {
    const head = "---\ndescription: big\n---\n";
    const body = "x".repeat(MAX_CUSTOM_FILE_BYTES - head.length);
    expect(parseCustomFile("big.md", head + body, "command")).not.toBeNull();
    expect(parseCustomFile("big.md", head + body + "x", "command")).toBeNull();
  });

  it("refuses upper case and underscores in names, but takes a file named in upper case", () => {
    expect(parseCustomFile("my_cmd.md", "body", "command")).toBeNull();
    expect(parseCustomFile("My-Cmd.md", "body", "command")?.id).toBe("my-cmd");
  });

  it("keeps $ patterns in arguments as written", () => {
    expect(renderCustomBody("Run $ARGUMENTS", "$& $1 $$")).toBe("Run $& $1 $$");
    expect(renderCustomBody("A $ARGUMENTS B $ARGUMENTS", "x")).toBe("A x B x");
  });

  it("drops the second of two commands with the same name", () => {
    const first = parseCustomFile("dup.md", "first", "command")!;
    const second = parseCustomFile("dup.md", "second", "agent")!;
    const kept = usableCustomCommands([first, second], new Set());
    expect(kept).toHaveLength(1);
    expect(kept[0].body).toBe("first");
  });

  it("marks agents in the menu with a badge", () => {
    const agent = parseCustomFile("reviewer.md", "---\nmodel: x\n---\nReview.", "agent")!;
    const [row] = matchSlashCommands("/rev", { custom: [agent] });
    expect(row.badge).toBe("agent");
  });
});

describe("custom command store", () => {
  it("keeps the newer load when an older one finishes last", async () => {
    const waiting: Record<string, Array<() => void>> = {};
    const listing = (ws: string, folder: string) =>
      new Promise((resolve) => {
        (waiting[ws] ??= []).push(() =>
          resolve(
            folder.includes("commands")
              ? { success: true, entries: [{ name: `${ws}.md`, path: `${ws}.md`, isDirectory: false }] }
              : { success: true, entries: [] },
          ),
        );
      });
    (window as unknown as { draggy: unknown }).draggy = {
      files: {
        list: listing,
        read: async () => ({ success: true, text: "body" }),
      },
    };
    for (const id of ["old", "new", "ws", "ws2"]) localStorage.setItem(`commandTrust:${id}`, "yes");
    const { loadCustomCommands, getCustomCommands } = await import("../chat/customCommandStore");
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const older = loadCustomCommands("old");
    await flush();
    const newer = loadCustomCommands("new");
    await flush();
    waiting.new.forEach((release) => release());
    await newer;
    waiting.old.forEach((release) => release());
    await older;
    expect(getCustomCommands().map((command) => command.id)).toEqual(["new"]);
  });
});

describe("mergeCustomCommands", () => {
  it("keeps project files over user files of the same name", async () => {
    const { mergeCustomCommands } = await import("../chat/customCommandStore");
    const project: CustomCommand = { ...plan, source: "project", body: "Project plan." };
    const user: CustomCommand = { ...plan, source: "user", body: "User plan." };
    const merged = mergeCustomCommands([project], [user, review]);
    expect(merged.map((command) => [command.id, command.body])).toEqual([
      ["plan", "Project plan."],
      ["review", "Review $ARGUMENTS carefully."],
    ]);
  });
});
