// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { flushLogs } from "../logger";
import { Toast } from "../ui/Toast";

afterEach(cleanup);

describe("Toast", () => {
  it("renders nothing when closed", () => {
    render(<Toast open={false} title="Notice" />);
    expect(screen.queryByText("Notice")).toBeNull();
  });

  it("renders title, description and triggers action", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <Toast
        open
        title="Saved"
        description="Changes preserved"
        action={{ label: "Undo", onClick: onAction }}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("Changes preserved")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders with alert role on danger tone", () => {
    render(<Toast open tone="danger" title="Failed" />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  describe("an error the user sees", () => {
    const sent: { level: string; message: string; correlationId?: string | null; data?: Record<string, unknown> }[] = [];
    const written: string[] = [];

    afterEach(() => {
      sent.length = 0;
      written.length = 0;
      delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    });

    function bridge() {
      Object.assign(window, {
        electronAPI: {
          logBatch: (entries: typeof sent) => sent.push(...entries),
          appInfo: async () => ({ version: "9.9.9" }),
          readLogs: async () => "",
        },
      });
      Object.assign(navigator, { clipboard: { writeText: async (text: string) => void written.push(text) } });
      // Lines the tests above queued are not part of this one.
      flushLogs();
      sent.length = 0;
    }

    it("is logged once, with the text it showed and an id", () => {
      bridge();
      const { rerender } = render(<Toast open tone="danger" title="Could not save chats" />);
      rerender(<Toast open tone="danger" title="Could not save chats" />);
      flushLogs();

      const shown = sent.filter((entry) => entry.message === "error shown");
      expect(shown).toHaveLength(1);
      expect(shown[0]).toMatchObject({ level: "WARN", data: { surface: "toast", text: "Could not save chats" } });
      expect(shown[0].correlationId).toBeTruthy();
    });

    it("copies details that carry the same id as the log line", async () => {
      bridge();
      render(<Toast open tone="danger" title="Could not save chats" />);
      flushLogs();
      const id = sent.find((entry) => entry.message === "error shown")?.correlationId;

      fireEvent.click(screen.getByRole("button", { name: "Copy error details" }));
      await waitFor(() => expect(written).toHaveLength(1));

      expect(written[0]).toContain("Could not save chats");
      expect(written[0]).toContain(`id: ${id}`);
      expect(written[0]).toContain("version: 9.9.9");
    });

    it("is not logged for a toast that is not an error", () => {
      bridge();
      render(<Toast open title="Saved" />);
      flushLogs();
      expect(sent.filter((entry) => entry.message === "error shown")).toHaveLength(0);
    });
  });
});
