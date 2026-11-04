// Downloads the embeddable Python the chat workspace runs scripts with, into win/vendor/python.
// Plain standard library, about 10 MB. Run by hand or before electron-builder.
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");
const { execFileSync } = require("child_process");

const VERSION = "3.12.8";
const SHA256 = "8d3f33be9eb810f23c102f08475af2854e50484b8e4e06275e937be61ce3d2fb";
const URL = `https://www.python.org/ftp/python/${VERSION}/python-${VERSION}-embed-amd64.zip`;
const target = path.join(__dirname, "..", "vendor", "python");

function download(url, file) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, file).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.pipe(fs.createWriteStream(file)).on("finish", resolve).on("error", reject);
    }).on("error", reject);
  });
}

async function main() {
  if (process.platform !== "win32") return;
  if (fs.existsSync(path.join(target, "python.exe"))) return;
  fs.mkdirSync(target, { recursive: true });
  const zip = path.join(target, "python.zip");
  await download(URL, zip);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
  if (hash !== SHA256) {
    fs.rmSync(target, { recursive: true, force: true });
    throw new Error(`Python archive hash mismatch: ${hash}`);
  }
  execFileSync("powershell", ["-NoProfile", "-Command", "Expand-Archive -LiteralPath $env:PY_ZIP -DestinationPath $env:PY_DIR -Force"], {
    env: { ...process.env, PY_ZIP: zip, PY_DIR: target },
  });
  fs.rmSync(zip);
  console.log(`Python ${VERSION} ready in ${target}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
