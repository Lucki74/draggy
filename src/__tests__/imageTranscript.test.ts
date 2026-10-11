import { describe, expect, it } from "vitest";
import { chatToMarkdown } from "../chat/export";
import { isWorkStep } from "../chat/workSummary";
import { describeCompletedWork } from "../agent/resume";
import type { ChatSession, ImageStepInfo, Message, SearchStep } from "../types";

const picture = (image: Partial<ImageStepInfo>): SearchStep => {
  const info: ImageStepInfo = {
    prompt: "a red fox",
    status: "done",
    path: "C:/out/fox.png",
    filename: "fox.png",
    ...image,
  };
  return { id: "i1", type: "image", content: "", isComplete: info.status === "done", image: info };
};

describe("a picture in the transcript", () => {
  it("stands on its own instead of folding into a work block", () => {
    expect(isWorkStep(picture({}))).toBe(false);
  });

  it("is exported as an image pointing at the saved file", () => {
    const reply: Message = { id: "m", role: "assistant", content: "", steps: [picture({})] };
    const session: ChatSession = { id: "c", title: "Fox", messages: [reply], updatedAt: 0, isGenerating: false };
    const markdown = chatToMarkdown(session, { now: new Date("2026-10-07T12:00:00Z") });

    expect(markdown).toContain("![a red fox](<C:/out/fox.png>)");
    expect(markdown).not.toContain("*(no reply)*");
  });

  it("leaves a picture that never finished out of the export", () => {
    const reply: Message = { id: "m", role: "assistant", content: "", steps: [picture({ status: "cancelled" })] };
    const session: ChatSession = { id: "c", title: "Fox", messages: [reply], updatedAt: 0, isGenerating: false };

    expect(chatToMarkdown(session)).not.toContain("![");
  });

  it("tells a resumed reply not to draw it again", () => {
    const work = describeCompletedWork([picture({})]);
    expect(work).toContain("a red fox");
    expect(work).toContain("C:/out/fox.png");
    expect(work).toContain("do not draw it again");
  });
});
