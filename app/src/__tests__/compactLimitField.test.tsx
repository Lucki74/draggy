// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CompactLimitField from "../settings/CompactLimitField";
import { translations } from "../translations";

afterEach(cleanup);

const t = (key: string) => translations.en[key] || key;

describe("CompactLimitField", () => {
  it("displays formatted limit and updates when limit prop changes externally", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CompactLimitField limit={64_000} onChange={onChange} t={t} />,
    );

    const input = screen.getByRole("textbox", { name: t("compactLimitSetting") }) as HTMLInputElement;
    expect(input.value).toBe("64k");

    rerender(<CompactLimitField limit={128_000} onChange={onChange} t={t} />);
    expect(input.value).toBe("128k");
  });

  it("clears input when limit changes to automatic null", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CompactLimitField limit={64_000} onChange={onChange} t={t} />,
    );

    expect(screen.queryByRole("textbox", { name: t("compactLimitSetting") })).toBeTruthy();

    rerender(<CompactLimitField limit={null} onChange={onChange} t={t} />);
    expect(screen.queryByRole("textbox", { name: t("compactLimitSetting") })).toBeNull();
  });

  it("commits parsed token limit on enter", () => {
    const onChange = vi.fn();
    render(<CompactLimitField limit={32_000} onChange={onChange} t={t} />);

    const input = screen.getByRole("textbox", { name: t("compactLimitSetting") });
    fireEvent.change(input, { target: { value: "48k" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(48_000);
  });
});
