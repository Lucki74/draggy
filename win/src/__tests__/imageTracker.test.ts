import { describe, expect, it } from "vitest";
import { imageIndex, referenceFor, trackImages } from "../images/imageTracker";
import type { Message } from "../types";

const generated = (id: string, prompt: string, path: string, location: "created" | "project" = "created"): Message => ({
  id,
  role: "assistant",
  content: "",
  steps: [{ id: `${id}-s`, type: "image", content: prompt, isComplete: true, image: { prompt, status: "done", path, location, width: 1024, height: 768, seed: 7 } }],
});

const chat: Message[] = [
  { id: "m1", role: "user", content: "hi", attachments: [{ name: "cat.png", type: "image/png", content: "AAAA" }, { name: "n.txt", type: "text/plain", content: "x" }] },
  generated("m2", "a red fox", "C:/out/fox.png"),
  { id: "m3", role: "assistant", content: "", steps: [{ id: "bad", type: "image", content: "x", isComplete: true, image: { prompt: "failed", status: "error" } }] },
  generated("m4", "a blue fox", "src/fox.png", "project"),
];

describe("image tracker", () => {
  it("numbers attached and generated pictures in chat order and skips failures", () => {
    const tracked = trackImages(chat);
    expect(tracked.map((item) => [item.id, item.origin])).toEqual([
      ["img_1", "attached"],
      ["img_2", "generated"],
      ["img_3", "generated"],
    ]);
  });

  it("gives the same IDs for the same chat", () => {
    expect(trackImages(chat).map((item) => item.id)).toEqual(trackImages([...chat]).map((item) => item.id));
  });

  it("lists every picture for the model without any bytes", () => {
    const text = imageIndex(trackImages(chat));
    expect(text).toContain("img_1: attached by the user (cat.png)");
    expect(text).toContain('img_2: generated: "a red fox", 1024x768');
    expect(text).not.toContain("AAAA");
    expect(imageIndex([])).toBe("");
  });

  it("resolves an ID to the right starting picture", () => {
    const tracked = trackImages(chat);
    expect(referenceFor(tracked, "img_1")?.init).toEqual({ kind: "attachment", dataUrl: "data:image/png;base64,AAAA" });
    expect(referenceFor(tracked, "IMG_2")?.init).toEqual({ kind: "created", path: "C:/out/fox.png" });
    expect(referenceFor(tracked, "img_3")?.init).toMatchObject({ kind: "project", path: "src/fox.png", optional: true });
    expect(referenceFor(tracked, "img_9")).toBeNull();
  });
});
