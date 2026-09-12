// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import PlanPanel from "../plan/PlanPanel";
import { parsePlan } from "../plan/plan";
import { translations } from "../translations";

/**
 * The panel is the steering wheel: whatever the model wrote, the user can
 * change it here and the loop is told. Every control has to hand back a new
 * list rather than quietly editing the one it was given.
 */

const t = (key: string) => translations.en[key] || key;

const ITEMS = parsePlan("[x] Read it\n[>] Change it\n[ ] Test it");

afterEach(cleanup);

function panel(overrides: Partial<React.ComponentProps<typeof PlanPanel>> = {}) {
  const onChange = vi.fn();
  const onContinue = vi.fn();

  render(
    <PlanPanel
      items={ITEMS}
      onChange={onChange}
      onContinue={onContinue}
      running={false}
      t={t}
      {...overrides}
    />,
  );

  return { onChange, onContinue };
}

describe("what it shows", () => {
  it("lists every step", () => {
    panel();

    expect(screen.getByText("Read it")).toBeTruthy();
    expect(screen.getByText("Change it")).toBeTruthy();
    expect(screen.getByText("Test it")).toBeTruthy();
  });

  it("counts what is done", () => {
    panel();

    expect(screen.getByText("1/3")).toBeTruthy();
  });
});

describe("the user steering it", () => {
  it("ticks a step off", () => {
    const { onChange } = panel();

    act(() => screen.getByRole("button", { name: "Test it" }).click());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][2].status).toBe("done");
  });

  it("takes a step out", () => {
    const { onChange } = panel();

    act(() => screen.getAllByRole("button", { name: "Remove step" })[0].click());

    expect(onChange.mock.calls[0][0].map((item: { text: string }) => item.text)).toEqual(
      ["Change it", "Test it"],
    );
  });

  it("moves one up", () => {
    const { onChange } = panel();

    act(() => screen.getAllByRole("button", { name: "Move up" })[1].click());

    expect(onChange.mock.calls[0][0][0].text).toBe("Change it");
  });

  it("adds one at the end", () => {
    const { onChange } = panel();

    const input = screen.getByRole("textbox", { name: "Add a step" });
    fireEvent.change(input, { target: { value: "Ship it" } });
    act(() => screen.getByRole("button", { name: "Add a step" }).click());

    expect(onChange.mock.calls[0][0]).toHaveLength(4);
    expect(onChange.mock.calls[0][0][3].text).toBe("Ship it");
  });

  it("never changes the list it was handed", () => {
    const before = JSON.stringify(ITEMS);
    const { onChange } = panel();

    act(() => screen.getAllByRole("button", { name: "Remove step" })[0].click());

    expect(onChange).toHaveBeenCalled();
    expect(JSON.stringify(ITEMS)).toBe(before);
  });
});

describe("picking an unfinished plan back up", () => {
  it("offers to carry on when nothing is running", () => {
    const { onContinue } = panel();

    act(() => screen.getByRole("button", { name: /carry on/i }).click());

    expect(onContinue).toHaveBeenCalled();
  });

  it("says nothing while the model is still working", () => {
    panel({ running: true });

    expect(screen.queryByRole("button", { name: /carry on/i })).toBeNull();
  });

  it("says nothing once every step is done", () => {
    panel({ items: parsePlan("[x] Read it\n[x] Change it") });

    expect(screen.queryByRole("button", { name: /carry on/i })).toBeNull();
  });
});
