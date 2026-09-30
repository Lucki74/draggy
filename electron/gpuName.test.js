import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { gpuNameFrom } = require("./platform.cjs");

// Recorded from Electron 42 on a Windows machine with an RTX 4070 Ti and an AMD iGPU.
const windows = {
  gpuDevice: [
    { active: false, deviceString: "Microsoft Basic Render Driver" },
    { active: true, deviceString: "NVIDIA GeForce RTX 4070 Ti" },
    { active: false, deviceString: "AMD Radeon(TM) Graphics" },
  ],
  auxAttributes: {
    glRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002782) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.16.1714)",
  },
};

describe("naming the graphics card", () => {
  it("names the active device", () => {
    expect(gpuNameFrom(windows)).toBe("NVIDIA GeForce RTX 4070 Ti");
  });

  it("never names a software renderer, and tidies trademark marks", () => {
    expect(gpuNameFrom({ gpuDevice: [windows.gpuDevice[0], windows.gpuDevice[2]] })).toBe("AMD Radeon Graphics");
    expect(gpuNameFrom({ gpuDevice: [windows.gpuDevice[0]], auxAttributes: { glRenderer: "llvmpipe (LLVM 15.0.7, 256 bits)" } })).toBeNull();
  });

  it("falls back to the renderer string", () => {
    expect(gpuNameFrom({ auxAttributes: windows.auxAttributes })).toBe("NVIDIA GeForce RTX 4070 Ti");
    expect(gpuNameFrom({ auxAttributes: { glRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max, Unspecified Version)" } })).toBe("Apple M2 Max");
    expect(gpuNameFrom({ auxAttributes: { glRenderer: "Mesa Intel(R) UHD Graphics 620 (KBL GT2)" } })).toBe("Mesa Intel UHD Graphics 620 (KBL GT2)");
  });

  it("answers null with nothing to go on", () => {
    expect(gpuNameFrom(null)).toBeNull();
    expect(gpuNameFrom({})).toBeNull();
  });
});
