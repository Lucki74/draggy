import { useEffect, useRef } from "react";
import type { PermissionMode } from "../types";

/** A model that cannot use tools can only plan, so the project's permission mode follows it to Plan only
 * and, once a model with tools is chosen again, goes back to what it was. A mode the user picked in the
 * meantime is left alone. Code only: Chat has no permission modes. */
export function useToollessPlan({
  active,
  toolsUnavailable,
  permissionMode,
  onPermissionMode,
}: {
  active: boolean;
  toolsUnavailable: boolean;
  permissionMode?: PermissionMode;
  onPermissionMode?: (mode: PermissionMode) => void;
}) {
  const before = useRef<PermissionMode | null>(null);

  useEffect(() => {
    if (!active || !permissionMode || !onPermissionMode) return;

    if (toolsUnavailable) {
      if (permissionMode !== "plan") {
        before.current = permissionMode;
        onPermissionMode("plan");
      }
      return;
    }

    const previous = before.current;
    before.current = null;
    if (previous && permissionMode === "plan") onPermissionMode(previous);
  }, [active, toolsUnavailable, permissionMode, onPermissionMode]);
}
