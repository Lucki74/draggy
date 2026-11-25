import { describe, expect, it } from "vitest";
import { iconMissing, markIconMissing } from "../favicon";

describe("failed icon hosts", () => {
  it("remembers a host whose icon failed, and only that host", () => {
    expect(iconMissing("no-icon.example")).toBe(false);
    markIconMissing("no-icon.example");
    expect(iconMissing("no-icon.example")).toBe(true);
    expect(iconMissing("other.example")).toBe(false);
  });
});
