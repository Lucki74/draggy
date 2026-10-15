// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NativeAppBanner from "../app/NativeAppBanner";
import { nativeAppPlatform } from "../app/nativeAppPlatform";
import { translations } from "../translations";

const t = (key: string) => translations.en[key] || key;
const KEY = "draggy_native_banner";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Electron/36.0.0 Chrome/136.0.0.0 Safari/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Electron/36.0.0 Chrome/136.0.0.0 Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Electron/36.0.0 Chrome/136.0.0.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36";

function onPlatform(userAgent: string) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("nativeAppPlatform", () => {
  it("names Mac and Linux from the user agent", () => {
    expect(nativeAppPlatform(MAC)).toBe("mac");
    expect(nativeAppPlatform(LINUX)).toBe("linux");
  });

  it("gives Windows and Android no platform, so they get no banner", () => {
    expect(nativeAppPlatform(WINDOWS)).toBeNull();
    expect(nativeAppPlatform(ANDROID)).toBeNull();
  });
});

describe("the native beta banner", () => {
  it("tells Mac users about the macOS beta", () => {
    onPlatform(MAC);
    render(<NativeAppBanner t={t} />);
    expect(screen.getByText(translations.en.nativeBannerMac)).toBeTruthy();
    expect(screen.queryByText(translations.en.nativeBannerLinux)).toBeNull();
  });

  it("tells Linux users about the Linux beta", () => {
    onPlatform(LINUX);
    render(<NativeAppBanner t={t} />);
    expect(screen.getByText(translations.en.nativeBannerLinux)).toBeTruthy();
    expect(screen.queryByText(translations.en.nativeBannerMac)).toBeNull();
  });

  it("never shows on Windows", () => {
    onPlatform(WINDOWS);
    const { container } = render(<NativeAppBanner t={t} />);
    expect(container.textContent).toBe("");
  });

  it("stays gone after dismiss, including on a fresh render", () => {
    onPlatform(MAC);
    render(<NativeAppBanner t={t} />);
    fireEvent.click(screen.getByRole("button", { name: translations.en.dismiss }));
    expect(screen.queryByText(translations.en.nativeBannerMac)).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("1");

    cleanup();
    const again = render(<NativeAppBanner t={t} />);
    expect(again.container.textContent).toBe("");
  });

  it("links Learn more to the Draggy site in a new window", () => {
    onPlatform(LINUX);
    render(<NativeAppBanner t={t} />);
    const link = screen.getByRole("link", { name: translations.en.nativeBannerLearnMore });
    expect(link.getAttribute("href")).toBe("https://draggy.org");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("still shows when the browser refuses storage", () => {
    onPlatform(MAC);
    const getItem = vi.fn(() => {
      throw new Error("storage is blocked");
    });
    vi.stubGlobal("localStorage", {
      getItem,
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    });
    render(<NativeAppBanner t={t} />);
    expect(getItem).toHaveBeenCalledWith(KEY);
    expect(screen.getByText(translations.en.nativeBannerMac)).toBeTruthy();
  });
});
