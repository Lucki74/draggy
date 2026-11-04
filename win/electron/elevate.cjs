const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { clip, timeoutFor } = require("./commands.cjs");

/** One command as administrator. Windows shows its UAC prompt for each; the app itself never runs
 * elevated. The command goes into a batch file, so no quoting has to survive the hop through
 * PowerShell, and its output comes back through a file, since an elevated process cannot share pipes. */

const DECLINED = 1223;

function batchText(command, cwd) {
  return `@echo off\r\ncd /d "${cwd}"\r\n${command}\r\n`;
}

/** The PowerShell line that starts the elevated shell and waits for it. */
function elevationScript(batchFile, outFile) {
  const quote = (value) => value.replace(/'/g, "''");
  const args = `/d /c ""${batchFile}" > "${outFile}" 2>&1"`;
  return `$ErrorActionPreference='Stop'; try { $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '${quote(args)}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } catch { exit ${DECLINED} }`;
}

function runElevated({ command, cwd, timeoutMs, platform = process.platform, spawnFn = spawn }) {
  const text = String(command || "").trim();
  if (platform !== "win32") return Promise.resolve({ success: false, error: "Administrator rights are only available on Windows." });
  if (!text) return Promise.resolve({ success: false, error: "No command was given." });
  if (!cwd || !fs.existsSync(cwd)) return Promise.resolve({ success: false, error: "The project folder is not available." });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dg-admin-${crypto.randomBytes(4).toString("hex")}-`));
  const batchFile = path.join(dir, "run.cmd");
  const outFile = path.join(dir, "out.txt");
  fs.writeFileSync(batchFile, batchText(text, cwd));
  const encoded = Buffer.from(elevationScript(batchFile, outFile), "utf16le").toString("base64");

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawnFn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutFor(timeoutMs));

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ success: false, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let output = "";
      try {
        output = fs.readFileSync(outFile, "utf8");
      } catch {
        // silent-ok: the command never started, or printed nothing
      }
      fs.rmSync(dir, { recursive: true, force: true });
      const declined = code === DECLINED && !output;
      const clipped = clip(output);
      resolve({
        success: !timedOut && !declined && code === 0,
        exitCode: code,
        timedOut,
        declined,
        elevated: true,
        output: declined ? "" : clipped.text,
        truncated: clipped.truncated,
        shell: "cmd",
        durationMs: Date.now() - started,
        ...(declined ? { error: "The user declined the administrator prompt." } : {}),
      });
    });
  });
}

module.exports = { runElevated, elevationScript, batchText, DECLINED };
