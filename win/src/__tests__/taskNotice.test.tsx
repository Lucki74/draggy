// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import MessageItem from "../chat/MessageItem";
import { defaultSettings } from "../app/settings";

afterEach(cleanup);

it("shows a background task note as a quiet line, not a user bubble", () => {
  const content = "[Background tasks ended]\nTask t1 (npm run build) finished with exit code 0 after 1m 16s.\nLast output: done";
  const { container } = render(
    <MessageItem
      msg={{ id: "u1", role: "user", content, notice: "tasks_ended" }}
      idx={0}
      isGenerating={false}
      isLast
      onRegenerate={() => {}}
      onSwitchVersion={() => {}}
      copiedIndex={null}
      copyToClipboard={() => {}}
      settings={{ ...defaultSettings, showMetrics: false }}
      onEditMessage={() => {}}
    />,
  );
  expect(screen.getByTestId("task-notice")).toBeTruthy();
  expect(screen.getByText("npm run build")).toBeTruthy();
  expect(screen.getByText("1m 16s")).toBeTruthy();
  expect(container.querySelector(".justify-end")).toBeNull();
});
