// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Sidebar from "../app/Sidebar";
import { translations } from "../translations";
import type { ChatSession, Workspace } from "../types";

afterEach(cleanup);

const mockWorkspace = {
  id: "w1",
  name: "draggy",
  rootPath: "D:/dev/draggy",
} as Workspace;

const mockSessions: ChatSession[] = [
  {
    id: "s1",
    title: "Fix crash on boot",
    updatedAt: Date.now(),
    messages: [],
    workspaceId: "w1",
    isGenerating: false,
  },
  {
    id: "s2",
    title: "Old exploration",
    updatedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    messages: [],
    workspaceId: "w1",
    isGenerating: false,
  },
];

describe("Sidebar", () => {
  it("renders Chat mode sessions grouped by time", () => {
    render(
      <Sidebar
        mode="chat"
        codeHome={false}
        activeWorkspaceId="w1"
        projects={[mockWorkspace]}
        runningSessionIds={[]}
        sessions={mockSessions}
        t={(k) => translations.en[k] || k}
        onSwitchMode={() => {}}
        onNewChat={() => {}}
        onNewProject={() => {}}
        onSelectChat={() => {}}
        onDeleteChat={() => {}}
        onOpenSettings={() => {}}
        onSelectWorkspace={() => {}}
        onRemoveWorkspace={() => {}}
        open={true}
        onToggleOpen={() => {}}
      />,
    );

    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Earlier")).toBeTruthy();
    expect(screen.getByText("Fix crash on boot")).toBeTruthy();
    expect(screen.getByText("Old exploration")).toBeTruthy();
  });

  it("renders Code mode sessions grouped by project", () => {
    render(
      <Sidebar
        mode="code"
        codeHome={false}
        activeWorkspaceId="w1"
        projects={[mockWorkspace]}
        runningSessionIds={[]}
        sessions={mockSessions}
        t={(k) => translations.en[k] || k}
        onSwitchMode={() => {}}
        onNewChat={() => {}}
        onNewProject={() => {}}
        onSelectChat={() => {}}
        onDeleteChat={() => {}}
        onOpenSettings={() => {}}
        onSelectWorkspace={() => {}}
        onRemoveWorkspace={() => {}}
        open={true}
        onToggleOpen={() => {}}
      />,
    );

    expect(screen.getByText("draggy")).toBeTruthy();
    expect(screen.getByText("Fix crash on boot")).toBeTruthy();
  });

  it("selects a session when clicked", () => {
    const onSelectChat = vi.fn();
    render(
      <Sidebar
        mode="chat"
        codeHome={false}
        activeWorkspaceId="w1"
        projects={[mockWorkspace]}
        runningSessionIds={[]}
        sessions={mockSessions}
        t={(k) => translations.en[k] || k}
        onSwitchMode={() => {}}
        onNewChat={() => {}}
        onNewProject={() => {}}
        onSelectChat={onSelectChat}
        onDeleteChat={() => {}}
        onOpenSettings={() => {}}
        onSelectWorkspace={() => {}}
        onRemoveWorkspace={() => {}}
        open={true}
        onToggleOpen={() => {}}
      />,
    );

    const sessionBtn = screen.getByText("Fix crash on boot");
    fireEvent.click(sessionBtn);

    expect(onSelectChat).toHaveBeenCalledWith("s1");
  });

  it("triggers settings when settings footer row is clicked", () => {
    const onOpenSettings = vi.fn();
    render(
      <Sidebar
        mode="chat"
        codeHome={false}
        activeWorkspaceId="w1"
        projects={[mockWorkspace]}
        runningSessionIds={[]}
        sessions={mockSessions}
        t={(k) => translations.en[k] || k}
        onSwitchMode={() => {}}
        onNewChat={() => {}}
        onNewProject={() => {}}
        onSelectChat={() => {}}
        onDeleteChat={() => {}}
        onOpenSettings={onOpenSettings}
        onSelectWorkspace={() => {}}
        onRemoveWorkspace={() => {}}
        open={true}
        onToggleOpen={() => {}}
      />,
    );

    const settingsBtn = screen.getByText("Settings");
    fireEvent.click(settingsBtn);

    expect(onOpenSettings).toHaveBeenCalledWith("general");
  });
});
