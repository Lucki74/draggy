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
    expect(screen.getByText("Moyen").closest(".sr-only")).toBeNull();
    expect(permission.closest("form")?.querySelector(".flex-wrap > .ms-auto")).toBeTruthy();
  });
});
