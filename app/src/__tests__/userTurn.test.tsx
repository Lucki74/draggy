// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { UserTurn } from "../chat/UserTurn";

afterEach(cleanup);

describe("UserTurn", () => {
  it("shows markdown in a user message as raw text", () => {
    const content = "# Title\n\n**bold** `code` [link](https://example.com)\n- item\n\\(x\\)";
    const { container } = render(
      <UserTurn
        msg={{ id: "u1", role: "user", content }}
        idx={0}
        text={content}
        onEditMessage={vi.fn()}
        onSwitchVersion={vi.fn()}
        totalVersions={1}
        currentVersionIndex={0}
        t={(key) => key}
      />,
    );
    expect(container.querySelector(".whitespace-pre-wrap")?.textContent).toBe(content);
    expect(container.querySelector("h1, strong, code, a, li")).toBeNull();
  });
});
