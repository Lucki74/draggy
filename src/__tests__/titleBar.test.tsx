// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TitleBar from "../app/TitleBar";
import { translations } from "../translations";

const t = (key: string) => translations.en[key] || key;

afterEach(cleanup);

describe("TitleBar", () => {
  it("renders dragon mark, sidebar button, and project breadcrumb", () => {
    render(
      <TitleBar
        t={t}
        projectName="draggy"
        sidebarOpen={true}
        onToggleSidebar={() => {}}
      />,
    );

    expect(screen.getByText("draggy")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hide sidebar/ })).toBeTruthy();
  });

  it("calls onToggleSidebar when sidebar toggle button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <TitleBar
        t={t}
        sidebarOpen={false}
        onToggleSidebar={onToggle}
      />,
    );

    const button = screen.getByRole("button", { name: /Show sidebar/ });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders diff stats and invokes onOpenDiff when clicked", () => {
    const onOpenDiff = vi.fn();
    render(
      <TitleBar
        t={t}
        diffStats={{ added: 12, removed: 1 }}
        onOpenDiff={onOpenDiff}
        sidebarOpen={true}
        onToggleSidebar={() => {}}
      />,
    );

    const diffBtn = screen.getByRole("button", { name: /Open changes/ });
    expect(screen.getByText("+12")).toBeTruthy();
    expect(screen.getByText("−1")).toBeTruthy();

    fireEvent.click(diffBtn);
    expect(onOpenDiff).toHaveBeenCalledTimes(1);
  });

  it("opens Views menu and allows changing view mode", () => {
    const onChangeViewMode = vi.fn();
    render(
      <TitleBar
        t={t}
        viewMode="normal"
        onChangeViewMode={onChangeViewMode}
        sidebarOpen={true}
        onToggleSidebar={() => {}}
      />,
    );

    const viewsBtn = screen.getByRole("button", { name: /Views/ });
    fireEvent.click(viewsBtn);

    const thinkingOption = screen.getByRole("menuitemradio", { name: /thinking/i });
    fireEvent.click(thinkingOption);

    expect(onChangeViewMode).toHaveBeenCalledWith("thinking");
  });

  it("shows plan progress during a run and opens the plan on click", () => {
    const onOpenPlan = vi.fn();
    render(
      <TitleBar t={t} sidebarOpen onToggleSidebar={() => {}} onOpenPlan={onOpenPlan} planProgress="3 of 7" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Plan: 3 of 7" }));
    expect(onOpenPlan).toHaveBeenCalled();
  });

  it("hides plan progress when no run is going", () => {
    render(<TitleBar t={t} sidebarOpen onToggleSidebar={() => {}} onOpenPlan={() => {}} />);

    expect(screen.queryByRole("button", { name: /^Plan:/ })).toBeNull();
  });
});
