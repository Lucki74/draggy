// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useToollessPlan } from "../chat/useToollessPlan";
import type { PermissionMode } from "../types";

interface Props {
  active: boolean;
  toolsUnavailable: boolean;
  permissionMode?: PermissionMode;
}

function setup(initial: Props) {
  const onPermissionMode = vi.fn();
  const view = renderHook((props: Props) => useToollessPlan({ ...props, onPermissionMode }), {
    initialProps: initial,
  });
  return { onPermissionMode, ...view };
}

describe("a model that cannot use tools", () => {
  it("moves the project to Plan only", () => {
    const { onPermissionMode } = setup({ active: true, toolsUnavailable: true, permissionMode: "acceptEdits" });

    expect(onPermissionMode).toHaveBeenCalledTimes(1);
    expect(onPermissionMode).toHaveBeenCalledWith("plan");
  });

  it("does nothing when the project is already on Plan only", () => {
    const { onPermissionMode } = setup({ active: true, toolsUnavailable: true, permissionMode: "plan" });

    expect(onPermissionMode).not.toHaveBeenCalled();
  });

  it("gives back the mode it took when a model with tools is chosen again", () => {
    const { onPermissionMode, rerender } = setup({ active: true, toolsUnavailable: true, permissionMode: "auto" });
    expect(onPermissionMode).toHaveBeenLastCalledWith("plan");

    // The app applies the change, then the model is swapped for one with tools.
    rerender({ active: true, toolsUnavailable: true, permissionMode: "plan" });
    rerender({ active: true, toolsUnavailable: false, permissionMode: "plan" });

    expect(onPermissionMode).toHaveBeenCalledTimes(2);
    expect(onPermissionMode).toHaveBeenLastCalledWith("auto");
  });

  it("does not put a mode back over one the user chose in the meantime", () => {
    const { onPermissionMode, rerender } = setup({ active: true, toolsUnavailable: true, permissionMode: "ask" });
    rerender({ active: true, toolsUnavailable: true, permissionMode: "plan" });
    rerender({ active: true, toolsUnavailable: false, permissionMode: "acceptEdits" });

    expect(onPermissionMode).toHaveBeenCalledTimes(1);
  });

  it("does not change a mode it never took", () => {
    const { onPermissionMode, rerender } = setup({ active: true, toolsUnavailable: false, permissionMode: "plan" });
    rerender({ active: true, toolsUnavailable: false, permissionMode: "plan" });

    expect(onPermissionMode).not.toHaveBeenCalled();
  });

  it("leaves Chat, which has no permission modes, alone", () => {
    const { onPermissionMode } = setup({ active: false, toolsUnavailable: true, permissionMode: "auto" });

    expect(onPermissionMode).not.toHaveBeenCalled();
  });

  it("waits until it is known: a model still being probed changes nothing", () => {
    const { onPermissionMode } = setup({ active: true, toolsUnavailable: false, permissionMode: "auto" });

    expect(onPermissionMode).not.toHaveBeenCalled();
  });
});
