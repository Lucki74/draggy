import { describe, expect, it } from "vitest";
import { chatToHtml, chatToMarkdown, escapeHtml, transcriptFilename } from "../chat/transcriptExport";
import type { ChatSession, Message, SearchStep } from "../types";

const at = new Date("2026-09-06T12:00:00Z");

function message(partial: Partial<Message>): Message {
  return { id: "m", role: "user", content: "", ...partial };
}

function session(partial: Partial<ChatSession>): ChatSession {
  return { id: "c", title: "A chat", messages: [], updatedAt: 0, isGenerating: false, ...partial };
}

function step(partial: Partial<SearchStep>): SearchStep {
  return { id: "s", type: "command", content: "npm test", ...partial } as SearchStep;
}

const metrics = {
  promptTokens: 120,
  responseTokens: 48,
  promptMs: 300,
  responseMs: 1200,
  loadMs: 0,
  totalMs: 1500,
  tokensPerSecond: 40,
  timeToFirstTokenMs: 210,
  contextWindow: 8192,
  model: "Qwen 3 8B",
  gpuPercent: null,
};

const busy = session({
  title: "Refactor login",
  plan: [
    { id: "p1", text: "Read the auth module", status: "done" },
    { id: "p2", text: "Patch the token check", status: "todo" },
  ],
  messages: [
    message({ id: "u", role: "user", content: "fix the token check", attachments: [{ name: "auth.ts", type: "text", content: "" }] }),
    message({
      id: "a",
      role: "assistant",
      content: "Done, the check is fixed.",
      thinkingContent: "first compare the expiry with now",
      metrics,
      steps: [
        step({ id: "1", type: "command", content: "npm test", stdout: "12 passed", stderr: "one warning" }),
        step({ id: "2", type: "edit_file", content: "src/auth.ts", filepath: "src/auth.ts", before: "if (exp > now)", after: "if (exp >= now)" }),
        step({ id: "3", type: "searching", content: "token expiry", results: [{ title: "JWT", url: "https://example.com/jwt", snippet: "exp claim" }] }),
      ],
    }),
  ],
});

describe("chatToMarkdown", () => {
  it("writes every message under its heading", () => {
    const markdown = chatToMarkdown(busy, { now: at });
    expect(markdown).toContain("# Refactor login");
    expect(markdown).toContain("## You");
    expect(markdown).toContain("fix the token check");
    expect(markdown).toContain("## Qwen 3 8B");
    expect(markdown).toContain("Done, the check is fixed.");
    expect(markdown).toContain("*Attached: auth.ts*");
  });

  it("keeps the thinking, the tool steps with their output and the edits", () => {
    const markdown = chatToMarkdown(busy, { now: at });
    expect(markdown).toContain("first compare the expiry with now");
    expect(markdown).toContain("npm test");
    expect(markdown).toContain("12 passed");
    expect(markdown).toContain("one warning");
    expect(markdown).toContain("- if (exp > now)");
    expect(markdown).toContain("+ if (exp >= now)");
    expect(markdown).toContain("https://example.com/jwt");
  });

  it("writes the plan and the metrics", () => {
    const markdown = chatToMarkdown(busy, { now: at });
    expect(markdown).toContain("- [x] Read the auth module");
    expect(markdown).toContain("- [ ] Patch the token check");
    expect(markdown).toContain("- Tokens per second: 40.0");
    expect(markdown).toContain("- Time to first token: 210 ms");
  });

  it("writes a reply that never arrived and an empty chat", () => {
    const empty = chatToMarkdown(session({ messages: [] }), { now: at });
    expect(empty).toContain("This conversation is empty.");

    const noReply = chatToMarkdown(session({ messages: [message({ role: "assistant", content: "" })] }), { now: at });
    expect(noReply).toContain("*No reply*");
  });

  it("writes the other versions the reader did not see", () => {
    const markdown = chatToMarkdown(
      session({
        messages: [
          message({
            role: "assistant",
            content: "the regenerated one",
            currentVersionIndex: 1,
            versions: [{ content: "the first attempt" }, { content: "the regenerated one" }],
          }),
        ],
      }),
      { now: at },
    );
    expect(markdown).toContain("the regenerated one");
    expect(markdown).toContain("Version 1");
    expect(markdown).toContain("the first attempt");
  });

  it("keeps the code fence closed when the output holds backticks", () => {
    const markdown = chatToMarkdown(
      session({
        messages: [message({ role: "assistant", content: "ok", steps: [step({ stdout: "```\nnested\n```" })] })],
      }),
      { now: at },
    );
    expect(markdown).toContain("````text\n```\nnested\n```\n````");
  });
});

describe("chatToHtml", () => {
  it("is a complete page with inline style and no script", () => {
    const html = chatToHtml(busy, { now: at });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<style>");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
  });

  it("collapses tool steps into details and colours the edit", () => {
    const html = chatToHtml(busy, { now: at });
    expect(html).toContain('<details class="step">');
    expect(html).toContain('<pre class="del">');
    expect(html).toContain('<pre class="add">');
    expect(html).toContain("12 passed");
    expect(html).toContain("<summary>Thinking</summary>");
  });

  it("escapes a closing script tag and every special character in content and title", () => {
    const hostile = `</script><img src=x onerror="alert('x')"> & more`;
    const html = chatToHtml(
      session({
        title: `Bad </script> title`,
        messages: [
          message({
            role: "assistant",
            content: hostile,
            steps: [step({ stdout: "</script>" })],
          }),
        ],
      }),
      { now: at },
    );
    expect(html).not.toContain("</script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; more");
    expect(html).toContain("<title>Bad &lt;/script&gt; title</title>");
  });

  it("writes the same facts as the markdown", () => {
    const html = chatToHtml(busy, { now: at });
    expect(html).toContain("Read the auth module");
    expect(html).toContain("Patch the token check");
    expect(html).toContain("Tokens per second");
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that can open markup or end an attribute", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("transcriptFilename", () => {
  it("uses the title, the date and the format's extension", () => {
    expect(transcriptFilename(session({ title: "Tax questions" }), "html", at)).toBe("Tax questions 2026-09-06.html");
    expect(transcriptFilename(session({ title: "Tax questions" }), "md", at)).toBe("Tax questions 2026-09-06.md");
  });
});
