// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ApiServerField from "../settings/ApiServerField";
import { translations } from "../translations";
import type { ApiServerConfig, ApiServerStatus } from "../types";

/** The switch for the local API, and what it shows once it is on. */

const t = (key: string) => translations.en[key] || key;

const OFF: ApiServerStatus = {
  success: true,
  enabled: false,
  port: 11500,
  mode: "agent",
  running: false,
  baseUrl: "http://127.0.0.1:11500/v1",
  key: null,
  error: null,
  settings: {
    maxParallel: 2,
    queueWaitSecs: 60,
    requestTimeoutSecs: 600,
    maxBodyMb: 32,
    defaultModel: "",
    aliases: {},
    listCloudModels: false,
    agentWebTools: true,
    systemPrompt: "",
    sendReasoning: false,
    sampling: {},
    extraEngineArgs: "",
  },
};

const ON: ApiServerStatus = { ...OFF, enabled: true, running: true, key: "draggy-secret-key" };

let current: ApiServerStatus;
const status = vi.fn(async () => current);
const configure = vi.fn(async (next: ApiServerConfig) => {
  current = next.enabled === false ? OFF : { ...ON, mode: next.mode ?? current.mode, port: next.port ?? current.port, settings: { ...current.settings, ...next, sampling: { ...current.settings.sampling, ...next.sampling } } as ApiServerStatus["settings"], baseUrl: `http://127.0.0.1:${next.port ?? current.port}/v1` };
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
  (window as unknown as { draggy: unknown }).draggy = {
    apiServer: { status, configure, regenerateKey },
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { draggy?: unknown }).draggy;
});

const show = async () => {
  await act(async () => {
    render(<ApiServerField t={t} />);
  });
};

describe("the local API setting", () => {
  it("is off, and shows no address or key while it is", async () => {
    await show();

    expect(screen.getAllByRole("switch")[0].getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText(OFF.baseUrl)).toBeNull();
  });

  it("turns on and shows where to connect", async () => {
    await show();

    await act(async () => {
      fireEvent.click(screen.getAllByRole("switch")[0]);
    });

    expect(configure).toHaveBeenCalledWith({ enabled: true });
    expect(screen.getByText(ON.baseUrl)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(t("apiServerListening"));
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

  it("answers with the agent by default and saves a change to the model alone", async () => {
    current = ON;
    await show();

    const choice = screen.getByLabelText(t("apiServerMode")) as HTMLSelectElement;
    expect(choice.value).toBe("agent");

    await act(async () => {
      fireEvent.change(choice, { target: { value: "model" } });
    });

    expect(configure).toHaveBeenCalledWith({ mode: "model" });
    expect((screen.getByLabelText(t("apiServerMode")) as HTMLSelectElement).value).toBe("model");
  });

  it("saves a server number on Enter and clamps it", async () => {
    current = ON;
    await show();

    const input = screen.getByLabelText(t("apiMaxParallel"));
    await act(async () => {
      fireEvent.change(input, { target: { value: "40" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(configure).toHaveBeenCalledWith({ maxParallel: 16 });
  });

  it("adds and removes an alias", async () => {
    current = ON;
    await show();

    await act(async () => {
      fireEvent.click(screen.getByText(t("apiAliasAdd")));
    });
    const [name, model] = [screen.getByLabelText(t("apiAliasClient")), screen.getByLabelText(t("apiAliasModel"))];
    await act(async () => {
      fireEvent.change(name, { target: { value: "gpt-4o" } });
      fireEvent.change(model, { target: { value: "qwen3" } });
      fireEvent.blur(model);
    });
    expect(configure).toHaveBeenCalledWith({ aliases: { "gpt-4o": "qwen3" } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText(t("apiAliasRemove")));
    });
    expect(configure).toHaveBeenLastCalledWith({ aliases: {} });
  });

  it("turns on reasoning and saves the system prompt", async () => {
    current = ON;
    await show();

    await act(async () => {
      fireEvent.click(screen.getByLabelText(t("apiSendReasoning")));
    });
    expect(configure).toHaveBeenCalledWith({ sendReasoning: true });

    const prompt = screen.getByLabelText(t("apiSystemPrompt"));
    await act(async () => {
      fireEvent.change(prompt, { target: { value: "Be brief." } });
      fireEvent.blur(prompt);
    });
    expect(configure).toHaveBeenCalledWith({ systemPrompt: "Be brief." });
  });

  it("clears a sampling default when emptied", async () => {
    current = { ...ON, settings: { ...ON.settings, sampling: { temperature: 0.7 } } };
    await show();

    const input = screen.getByLabelText(t("apiTemperature"));
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
    });
    expect(configure).toHaveBeenCalledWith({ sampling: { temperature: null } });
  });
});
