// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EffortSlider } from "../chat/EffortSlider";
import type { EffortLevel } from "../types";

afterEach(cleanup);

const t = (key: string) => key;

function Harness({ start = "medium", locked = [] as EffortLevel[], onLockedPick = vi.fn() }) {
  const [value, setValue] = useState<EffortLevel>(start as EffortLevel);
  return <EffortSlider value={value} onChange={setValue} locked={locked} onLockedPick={onLockedPick} t={t} />;
}

const slider = () => screen.getByRole("slider");

describe("EffortSlider", () => {
  it("exposes five steps with the level as its text", () => {
    render(<Harness />);
    expect(slider().getAttribute("aria-valuemin")).toBe("0");
    expect(slider().getAttribute("aria-valuemax")).toBe("4");
    expect(slider().getAttribute("aria-valuenow")).toBe("2");
    expect(slider().getAttribute("aria-valuetext")).toBe("effortMedium");
  });

  it("steps with arrows and jumps with Home and End", () => {
    render(<Harness />);
    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(slider().getAttribute("aria-valuetext")).toBe("effortHigh");
    fireEvent.keyDown(slider(), { key: "End" });
    expect(slider().getAttribute("aria-valuetext")).toBe("effortMax");
    fireEvent.keyDown(slider(), { key: "Home" });
    expect(slider().getAttribute("aria-valuetext")).toBe("effortOff");
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    expect(slider().getAttribute("aria-valuetext")).toBe("effortOff");
  });

  it("stops at the highest unlocked level and reports a locked pick", () => {
    const onLockedPick = vi.fn();
    render(<Harness start="high" locked={["max"]} onLockedPick={onLockedPick} />);
    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(slider().getAttribute("aria-valuetext")).toBe("effortHigh");
    fireEvent.keyDown(slider(), { key: "Home" });
    fireEvent.keyDown(slider(), { key: "End" });
    expect(slider().getAttribute("aria-valuetext")).toBe("effortHigh");
  });

  it("shows how an unsupported level is sent", () => {
    render(<EffortSlider value="max" onChange={() => {}} supported={["off", "low", "medium"]} t={t} />);
    expect(screen.getByText("effortSentAs")).toBeTruthy();
  });
});
