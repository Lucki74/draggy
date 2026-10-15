/** The native beta ships for Mac and Linux only, so Windows and Android never see the banner. */
export function nativeAppPlatform(userAgent: string): "mac" | "linux" | null {
  if (userAgent.includes("Mac")) return "mac";
  if ((userAgent.includes("Linux") || userAgent.includes("X11")) && !userAgent.includes("Android")) return "linux";
  return null;
}
