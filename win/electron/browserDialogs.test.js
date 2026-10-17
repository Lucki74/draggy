import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createDialogs, safeDownloadName } = require("./browserDialogs.cjs");

function rig() {
  const sent = [];
  const dialogs = createDialogs({
    send: async (method, params) => {
      sent.push([method, params]);
      return {};
    },
    onError: () => {},
  });
  return { dialogs, sent };
}

const open = (type, message = "Sure?") => ["Page.javascriptDialogOpening", { type, message, defaultPrompt: "" }];

describe("dialogs", () => {
  it("holds an alert until the model answers it", async () => {
    const { dialogs, sent } = rig();
    dialogs.handle(...open("confirm", "Delete it?"));
    expect(dialogs.pending()).toMatchObject({ type: "confirm", message: "Delete it?" });
    await dialogs.answer({ accept: false });
    expect(sent).toEqual([["Page.handleJavaScriptDialog", { accept: false }]]);
    expect(dialogs.pending()).toBeNull();
  });

  it("passes prompt text along", async () => {
    const { dialogs, sent } = rig();
    dialogs.handle(...open("prompt"));
    await dialogs.answer({ accept: true, text: "Ada" });
    expect(sent[0][1]).toEqual({ accept: true, promptText: "Ada" });
  });

  it("lets a page leave without asking", () => {
    const { dialogs, sent } = rig();
    dialogs.handle(...open("beforeunload"));
    expect(sent[0][1]).toEqual({ accept: true });
    expect(dialogs.pending()).toBeNull();
  });

  it("forgets a dialog the page closed itself", () => {
    const { dialogs } = rig();
    dialogs.handle(...open("alert"));
    dialogs.handle("Page.javascriptDialogClosed", {});
    expect(dialogs.pending()).toBeNull();
  });

  it("wakes a waiter when one opens", async () => {
    const { dialogs } = rig();
    const seen = dialogs.opened();
    dialogs.handle(...open("alert", "Hi"));
    expect(await seen).toMatchObject({ message: "Hi" });
  });

  it("refuses to answer when nothing is open", async () => {
    const { dialogs } = rig();
    await expect(dialogs.answer({ accept: true })).rejects.toMatchObject({ code: "no_dialog" });
  });
});

describe("safeDownloadName", () => {
  it("keeps only a plain file name", () => {
    expect(safeDownloadName("..\\..\\evil.exe")).toBe("evil.exe");
    expect(safeDownloadName("a/b/report.pdf")).toBe("report.pdf");
    expect(safeDownloadName("")).toBe("download");
    expect(safeDownloadName('bad:na*me?.txt')).toBe("bad_na_me_.txt");
  });
});
