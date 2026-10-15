// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "../ui/icons/Icon";
import { GLYPHS, type IconName } from "../ui/icons/glyphs.generated";

const WHITELIST_PATH = path.resolve(__dirname, "../ui/icons/icons.json");
const whitelist: string[] = JSON.parse(fs.readFileSync(WHITELIST_PATH, "utf8"));

describe("Phosphor icon resolution", () => {
  it("resolves every whitelisted icon in all three weights", () => {
    for (const name of whitelist) {
      const data = GLYPHS[name as IconName];
      expect(data, `Icon ${name} missing from GLYPHS`).toBeDefined();
      expect(data.regular.length, `${name} regular paths`).toBeGreaterThan(0);
      expect(data.light.length, `${name} light paths`).toBeGreaterThan(0);
      expect(data.fill.length, `${name} fill paths`).toBeGreaterThan(0);
    }
  });
});

describe("Icon component", () => {
  it("renders with default size 20 and aria-hidden", () => {
    const { container } = render(<Icon name="plus" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.getAttribute("height")).toBe("20");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("role")).toBeNull();
  });

  it("applies light weight for size 24 and up", () => {
    const { container } = render(<Icon name="plus" size={24} />);
    const pathElem = container.querySelector("path");
    const lightPath = GLYPHS["plus"].light[0];
    expect(pathElem?.getAttribute("d")).toBe(lightPath);
  });

  it("applies fill weight when filled is set", () => {
    const { container } = render(<Icon name="plus" filled />);
    const pathElem = container.querySelector("path");
    const fillPath = GLYPHS["plus"].fill[0];
    expect(pathElem?.getAttribute("d")).toBe(fillPath);
  });

  it("flips a mirrored icon in right-to-left text only", () => {
    const { container } = render(<Icon name="sidebar-simple" mirrored />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("rtl:-scale-x-100");
    expect(svg?.style.transform).toBe("");
  });

  it("renders accessible name and role img when label is provided", () => {
    render(<Icon name="plus" label="Add session" />);
    const icon = screen.getByRole("img", { name: "Add session" });
    expect(icon).toBeTruthy();
    expect(icon.getAttribute("aria-hidden")).toBeNull();
  });
});
