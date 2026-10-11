// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ComposerPreview } from "../ui/gallery/ComposerPreview";

/** A narrow composer wraps its controls rather than hiding their labels. */

afterEach(cleanup);

describe("the narrow composer", () => {
  it("keeps the French labels on screen and wraps the row", () => {
    render(<ComposerPreview narrow language="fr" />);

    const permission = screen.getByText("Accepter les modifications");
    expect(permission.closest(".sr-only")).toBeNull();
    expect(screen.getByText("Équilibré").closest(".sr-only")).toBeNull();
    expect(permission.closest("form")?.querySelector(".flex-wrap .basis-full")).toBeTruthy();
  });

  it("keeps one line when there is room", () => {
    render(<ComposerPreview />);

    expect(screen.getByText("Accept edits").closest("form")?.querySelector(".basis-full")).toBeNull();
  });
});
