import { describe, expect, it } from "vitest";
import {
  ACCEPTED_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TEXT_FILE_BYTES,
  extensionOf,
  looksLikeImage,
  planAttachment,
} from "../chat/attachments";
import {
  SLASH_COMMANDS,
  clampSlashIndex,
  matchSlashCommands,
  slashQueryFor,
} from "../chat/slashCommands";

const file = (name: string, size = 100, type = "") => ({ name, size, type });
const seeing = { visionSupported: true };
const blind = { visionSupported: false };

describe("extensionOf", () => {
  it("reads the extension", () => {
    expect(extensionOf("report.docx")).toBe("docx");
  });

  it("lower-cases it, because Windows does not", () => {
    expect(extensionOf("REPORT.DOCX")).toBe("docx");
  });

  it("takes the last one", () => {
    expect(extensionOf("archive.tar.gz")).toBe("gz");
  });

  it("has nothing to read from a name with no dot", () => {
    expect(extensionOf("Makefile")).toBe("");
  });

  it("treats a dotfile as having no extension", () => {
    expect(extensionOf(".gitignore")).toBe("gitignore");
  });
});

describe("looksLikeImage", () => {
  it("believes the MIME type", () => {
    expect(looksLikeImage(file("photo", 10, "image/png"))).toBe(true);
  });

  it("falls back to the extension when there is no type", () => {
    expect(looksLikeImage(file("photo.jpg"))).toBe(true);
  });

  it("says no to a document", () => {
    expect(looksLikeImage(file("report.docx"))).toBe(false);
  });
});

describe("planning what to do with a dropped file", () => {
  it("accepts an image when the model can see", () => {
    expect(planAttachment(file("photo.png", 1000), seeing)).toEqual({
      kind: "image",
      extension: "png",
    });
  });

  it("refuses an image when the model cannot see", () => {
    // Said before the size is looked at: telling someone their photo is too
    // large when no size would have worked is the wrong message.
    expect(planAttachment(file("photo.png", 999 ** 3), blind)).toEqual({
      kind: "reject",
      reason: "visionUnsupported",
    });
  });

  it("refuses an image that is too large", () => {
    expect(planAttachment(file("photo.png", MAX_IMAGE_BYTES + 1), seeing)).toEqual({
      kind: "reject",
      reason: "fileTooLarge",
    });
  });

  it("accepts an image exactly at the limit", () => {
    expect(planAttachment(file("photo.png", MAX_IMAGE_BYTES), seeing).kind).toBe("image");
  });

  it("routes every office format and PDF to the document reader", () => {
    for (const extension of DOCUMENT_EXTENSIONS) {
      expect(planAttachment(file(`a.${extension}`), seeing).kind, extension).toBe(
        "document",
      );
    }
  });

  it("gives documents their own larger limit", () => {
    expect(planAttachment(file("a.pdf", MAX_TEXT_FILE_BYTES + 1), seeing).kind).toBe(
      "document",
    );
    expect(planAttachment(file("a.pdf", MAX_DOCUMENT_BYTES + 1), seeing)).toEqual({
      kind: "reject",
      reason: "fileTooLarge",
    });
  });

  it("accepts source code and plain text", () => {
    expect(planAttachment(file("main.ts"), seeing).kind).toBe("text");
    expect(planAttachment(file("notes.md"), seeing).kind).toBe("text");
    expect(planAttachment(file("data.csv"), seeing).kind).toBe("text");
  });

  it("holds text files to the smallest limit", () => {
    expect(planAttachment(file("big.log", MAX_TEXT_FILE_BYTES + 1), seeing)).toEqual({
      kind: "reject",
      reason: "fileTooLarge",
    });
  });

  it("refuses a format it does not know", () => {
    expect(planAttachment(file("archive.zip"), seeing)).toEqual({
      kind: "reject",
      reason: "unsupportedFile",
    });
    expect(planAttachment(file("song.mp3"), seeing).kind).toBe("reject");
    expect(planAttachment(file("video.mp4"), seeing).kind).toBe("reject");
  });

  it("refuses a file with no extension at all", () => {
    expect(planAttachment(file("LICENSE"), seeing).kind).toBe("reject");
  });

  it("judges by extension regardless of case", () => {
    expect(planAttachment(file("REPORT.PDF"), seeing).kind).toBe("document");
  });

  it("prefers the document reader over the text reader for a .pdf", () => {
    // Both lists could plausibly claim it; the order of the checks decides,
    // and reading a PDF as text produces bytes rather than words.
    expect(planAttachment(file("a.pdf"), seeing).kind).toBe("document");
  });

  it("treats a MIME-typed image without an extension as an image", () => {
    expect(planAttachment(file("clipboard", 10, "image/png"), seeing).kind).toBe("image");
  });

  it("offers documents and text in the picker, but not images", () => {
    // Images are added separately, and only when the model can see.
    for (const extension of DOCUMENT_EXTENSIONS) {
      expect(ACCEPTED_EXTENSIONS).toContain(extension);
    }
    for (const extension of IMAGE_EXTENSIONS) {
      expect(ACCEPTED_EXTENSIONS).not.toContain(extension);
    }
  });
});

describe("slash commands", () => {
  it("opens on a slash", () => {
    expect(slashQueryFor("/")).toBe("");
    expect(matchSlashCommands("/")).toHaveLength(SLASH_COMMANDS.length);
  });

  it("narrows as the command is typed", () => {
    expect(matchSlashCommands("/se").map((c) => c.id)).toEqual(["settings"]);
  });

  it("ignores case", () => {
    expect(matchSlashCommands("/SET").map((c) => c.id)).toEqual(["settings"]);
  });

  it("closes as soon as there is a space", () => {
    // "/dev/null is not a file" is a sentence. Leaving the menu open would
    // make Enter run a command instead of sending the message.
    expect(slashQueryFor("/new thing")).toBeNull();
    expect(matchSlashCommands("/new thing")).toEqual([]);
  });

  it("stays closed for text that does not start with a slash", () => {
    expect(slashQueryFor("what is 2+2")).toBeNull();
    expect(slashQueryFor("")).toBeNull();
    expect(slashQueryFor("a/b")).toBeNull();
  });

  it("matches nothing for a command that does not exist", () => {
    expect(matchSlashCommands("/zzz")).toEqual([]);
  });

  it("gives every command a unique id and a label to translate", () => {
    const ids = SLASH_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of SLASH_COMMANDS) expect(command.label).toBeTruthy();
  });
});

describe("keeping the highlighted command in range", () => {
  it("leaves a valid index alone", () => {
    expect(clampSlashIndex(2, 5)).toBe(2);
  });

  it("pulls an index back as the list shrinks under it", () => {
    expect(clampSlashIndex(7, 3)).toBe(2);
  });

  it("never goes negative", () => {
    expect(clampSlashIndex(-1, 3)).toBe(0);
    expect(clampSlashIndex(4, 0)).toBe(0);
  });
});
