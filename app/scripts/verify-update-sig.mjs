// Checks each update file's .sig against plugins.updater.pubkey, so a signing key that does not match
// the key the app ships with fails the release instead of every later update.
//   node scripts/verify-update-sig.mjs [--conf <tauri.conf.json>] <file>...
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
let conf = "src-tauri/tauri.conf.json";
if (args[0] === "--conf") {
  conf = args[1];
  args.splice(0, 2);
}
if (args.length === 0) throw new Error("usage: verify-update-sig.mjs [--conf <path>] <file>...");

// A Tauri key or .sig is base64 of minisign text; the second line is base64 of the binary payload.
const payload = (b64) => Buffer.from(Buffer.from(b64, "base64").toString("utf8").split("\n")[1].trim(), "base64");

const pub = payload(JSON.parse(readFileSync(conf, "utf8")).plugins.updater.pubkey);
const keyId = pub.subarray(2, 10);
const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pub.subarray(10, 42).toString("base64url") }, format: "jwk" });
console.log(`pubkey ${Buffer.from(keyId).reverse().toString("hex").toUpperCase()}`);

let failed = false;
for (const file of args) {
  const sig = payload(readFileSync(`${file}.sig`, "utf8").trim());
  const alg = sig.subarray(0, 2).toString("latin1");
  const data = readFileSync(file);
  const signed = alg === "ED" ? createHash("blake2b512").update(data).digest() : data;
  if (!sig.subarray(2, 10).equals(keyId)) {
    console.error(`::error::${file}.sig was made with key ${Buffer.from(sig.subarray(2, 10)).reverse().toString("hex").toUpperCase()}, not the pubkey in ${conf}`);
    failed = true;
  } else if (!verify(null, signed, key, sig.subarray(10, 74))) {
    console.error(`::error::${file}.sig does not verify against the pubkey in ${conf}`);
    failed = true;
  } else {
    console.log(`ok ${file}`);
  }
}
if (failed) process.exit(1);
