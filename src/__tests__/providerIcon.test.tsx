// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readdirSync } from "node:fs";
import path from "node:path";
import { ProviderIcon } from "../providers/ProviderIcon";
// @ts-expect-error plain CommonJS, no types
import { bundledCatalog } from "../../electron/providers/catalog.cjs";

/** The servers with no brand mark to show: they keep a letter. */
const LETTERS = ["llamafile", "custom"];

const iconOf = (type: string | undefined, name = "Name") => {
  const { container } = render(<ProviderIcon type={type} name={name} />);
  return container.firstElementChild as HTMLElement;
};

afterEach(cleanup);

describe("provider icons", () => {
  it("gives every catalog provider its logo, except the servers that have none", () => {
    for (const { id } of bundledCatalog() as { id: string }[]) {
      expect(Boolean(iconOf(id).dataset.icon), id).toBe(!LETTERS.includes(id));
      cleanup();
    }
  });

  it("ships no logo that no provider shows", () => {
    const shown = new Set((bundledCatalog() as { id: string }[]).map(({ id }) => iconOf(id).dataset.icon));
    const files = readdirSync(path.join(__dirname, "..", "providers", "icons")).filter((name) => /\.(svg|png)$/.test(name));
    expect(files.filter((name) => !shown.has(name.slice(0, -4)))).toEqual([]);
  });

  it("paints one-colour logos with the text colour, so they show in the dark theme", () => {
    expect(iconOf("openai").tagName).toBe("SPAN");
    expect(iconOf("openai").className).toContain("bg-[var(--text-main)]");
    expect(iconOf("mistral").tagName).toBe("IMG");
  });

  it("falls back to the first letter for a server it does not know", () => {
    const tile = iconOf("someserver", "kobold");
    expect(tile.dataset.icon).toBeUndefined();
    expect(tile.textContent).toBe("K");
    expect(iconOf(undefined, "lemonade").textContent).toBe("L");
  });

  it("is decoration: the row's name is what is read out", () => {
    expect(iconOf("claude").getAttribute("aria-hidden")).toBe("true");
    expect(iconOf("claude").getAttribute("alt")).toBe("");
  });
});
