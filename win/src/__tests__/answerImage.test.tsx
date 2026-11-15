// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { withImageTokens } from "../chat/AnswerImage";

describe("image tokens in an answer", () => {
  it("turn into a picture block with its title", () => {
    expect(withImageTokens("Here.\n{image}img_1|Basalt cliffs{image}\nDone.")).toBe('Here.\n\n\n![Basalt cliffs](<img_1> "Basalt cliffs")\n\n\nDone.');
  });

  it("take a web URL and work without a title", () => {
    expect(withImageTokens("{image}https://a.org/x.jpg{image}")).toBe("\n\n![](<https://a.org/x.jpg>)\n\n");
  });

  it("stay hidden while still being written", () => {
    expect(withImageTokens("Look:\n{image}img_1|Bas", true)).toBe("Look:\n");
  });

  it("leave text without tokens alone", () => {
    expect(withImageTokens("plain {braces}")).toBe("plain {braces}");
  });

  it("take the title a model writes after a markdown picture", () => {
    expect(withImageTokens("Look:\n\n![](https://a.org/x.jpg)|Point Lighthouse, CA\n\nMore.")).toBe(
      'Look:\n\n![Point Lighthouse, CA](<https://a.org/x.jpg> "Point Lighthouse, CA")\n\nMore.',
    );
  });
});
