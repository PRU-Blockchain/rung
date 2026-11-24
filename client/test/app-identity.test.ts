// A wallet checks that the Android app asking for a signature really belongs
// to the site it names (`APP_IDENTITY.uri`). It reads the site's
// /.well-known/assetlinks.json and looks for the app's package and signing
// certificate. Without that file Phantom shows "This app's identity could not
// be verified", refuses the saved authorization and asks to connect again on
// every buy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const links = () => JSON.parse(read("web/public/.well-known/assetlinks.json")) as {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
}[];

test("the site vouches for the Android app's package", () => {
  const pkg = JSON.parse(read("app/app.json")).expo.android.package as string;
  const statements = links().filter((s) => s.target.namespace === "android_app");
  assert.equal(statements.length, 1);
  assert.equal(statements[0].target.package_name, pkg);
  assert.ok(statements[0].relation.includes("delegate_permission/common.handle_all_urls"));
});

test("every certificate fingerprint is a SHA-256 in the colon form wallets compare against", () => {
  const prints = links()[0].target.sha256_cert_fingerprints;
  assert.ok(prints.length >= 1);
  for (const p of prints) assert.match(p, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

test("the file sits on the site the app names as its identity", () => {
  const config = read("app/src/config.ts");
  const uri = /uri:\s*"(https:\/\/[^"]+)"/.exec(config)?.[1];
  assert.equal(uri, "https://rung-drab.vercel.app");
  // web/ is what is deployed there; public/ is served from the site's root.
  assert.ok(read("web/vercel.json").includes("nextjs"));
});
