// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ApiServerField from "../settings/ApiServerField";
import { translations } from "../translations";
import type { ApiServerStatus } from "../types";

/** The switch for the local API, and what it shows once it is on. */

const t = (key: string) => translations.en[key] || key;

const OFF: ApiServerStatus = {
  success: true,
  enabled: false,
  port: 11500,
  running: false,
  baseUrl: "http://127.0.0.1:11500/v1",
  key: null,
  error: null,
};

const ON: ApiServerStatus = { ...OFF, enabled: true, running: true, key: "draggy-secret-key" };

let current: ApiServerStatus;
const status = vi.fn(async () => current);
const configure = vi.fn(async (next: { enabled?: boolean; port?: number }) => {
  current = next.enabled === false ? OFF : { ...ON, port: next.port ?? current.port, baseUrl: `http://127.0.0.1:${next.port ?? current.port}/v1` };
  return current;
});
const regenerateKey = vi.fn(async () => {
  current = { ...current, key: "draggy-new-key" };
  return current;
});

beforeEach(() => {
  current = OFF;
  status.mockClear();
  configure.mockClear();
  regenerateKey.mockClear();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    apiServer: { status, configure, regenerateKey },
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const show = async () => {
  await act(async () => {
    render(<ApiServerField t={t} />);
  });
};

describe("the local API setting", () => {
  it("is off, and shows no address or key while it is", async () => {
    await show();

    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText(OFF.baseUrl)).toBeNull();
    expect(screen.getByText(t("apiServerHint"))).toBeTruthy();
  });

  it("turns on and shows where to connect", async () => {
    await show();

    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });

    expect(configure).toHaveBeenCalledWith({ enabled: true });
    expect(screen.getByText(ON.baseUrl)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(t("apiServerListening"));
    expect(screen.getByText(t("apiServerWarning"))).toBeTruthy();
  });

  it("keeps the key hidden until asked", async () => {
    current = ON;
    await show();

    expect(screen.queryByText("draggy-secret-key")).toBeNull();

    fireEvent.click(screen.getByLabelText(t("apiServerShowKey")));
    expect(screen.getByText("draggy-secret-key")).toBeTruthy();
  });

  it("makes a new key on request", async () => {
    current = ON;
    await show();
    fireEvent.click(screen.getByLabelText(t("apiServerShowKey")));

    await act(async () => {
      fireEvent.click(screen.getByLabelText(t("apiServerNewKey")));
    });

    expect(regenerateKey).toHaveBeenCalledTimes(1);
    expect(screen.getByText("draggy-new-key")).toBeTruthy();
  });

  it("moves to another port once one is typed", async () => {
    current = ON;
    await show();

    const port = screen.getByDisplayValue("11500");
    fireEvent.change(port, { target: { value: "12000" } });

    await act(async () => {
      fireEvent.blur(port);
    });

    expect(configure).toHaveBeenCalledWith({ port: 12000 });
    expect(screen.getByText("http://127.0.0.1:12000/v1")).toBeTruthy();
  });

  it("ignores a port it could not use", async () => {
    current = ON;
    await show();

    const port = screen.getByDisplayValue("11500");
    fireEvent.change(port, { target: { value: "80" } });

    await act(async () => {
      fireEvent.blur(port);
    });

    expect(configure).not.toHaveBeenCalled();
  });

  it("says why it is not running", async () => {
    current = { ...ON, running: false, error: "Port 11500 is already in use." };
    await show();

    expect(screen.getByRole("status").textContent).toContain("Port 11500 is already in use.");
  });
});
