import { describe, expect, it } from "vitest";
import { buildLabel } from "../app/buildLabel";

const t = (key: string) => ({ buildNumber: "build {n}", devBuild: "dev build" })[key] ?? key;

describe("buildLabel", () => {
  it("names 3.0.N as build N", () => {
    expect(buildLabel("3.0.1", t)).toBe("build 1");
    expect(buildLabel("3.0.42", t)).toBe("build 42");
  });

  it("calls 3.0.0 a dev build", () => {
    expect(buildLabel("3.0.0", t)).toBe("dev build");
  });

  it("keeps any other version as it is", () => {
    expect(buildLabel("2.4.0", t)).toBe("v2.4.0");
    expect(buildLabel("3.1.0", t)).toBe("v3.1.0");
    expect(buildLabel("3.0.1-rc1", t)).toBe("v3.0.1-rc1");
  });

  it("is empty without a version", () => {
    expect(buildLabel(null, t)).toBe("");
    expect(buildLabel(undefined, t)).toBe("");
  });
});
