import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changelogHasVersion, packageExtension, transformIndexHtml } from "../scripts/package-extension.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "extension", "manifest.json"), "utf8"));
const hasZip = !spawnSync("zip", ["-v"], { stdio: "ignore" }).error;

// Changelog gate.
assert.equal(changelogHasVersion("# Changelog\n\n## 2.0.0 — 2026-09-24\n- x\n", "2.0.0"), true);
assert.equal(changelogHasVersion("## [2.0.0]\n", "2.0.0"), true);
assert.equal(changelogHasVersion("## 2.0.1\n## 1.2.0\n", "2.0.0"), false);
assert.equal(changelogHasVersion("## 2.0.0.1\n", "2.0.0"), false);
assert.equal(changelogHasVersion("", "2.0.0"), false);
assert.ok(changelogHasVersion(await readFile(path.join(root, "CHANGELOG.md"), "utf8"), manifest.version), "CHANGELOG.md covers the manifest version.");

assert.throws(() => transformIndexHtml("<html><head></head><body></body></html>"), /Google Fonts/);

const outDir = await mkdtemp(path.join(os.tmpdir(), "kaikata-package-"));
try {
  const result = await packageExtension({ root, outDir, zip: hasZip });
  const files = new Set(result.files);
  assert.equal(result.version, manifest.version);

  for (const required of [
    "manifest.json",
    "background.js",
    "content-script.js",
    "cartforge-wants-flow.js",
    "cartforge-cart-rows.js",
    "app-assets/fonts.css",
    "app-assets/fonts/Geist-Variable.woff2",
    "app-assets/fonts/OFL.txt",
    "app/index.html",
    "app/styles.css",
    "app/shipping_data.json",
    "app/sample-cart-mobile.txt",
    "app/src/app.mjs",
    "app/src/host.mjs"
  ]) {
    assert.ok(files.has(required), `${required} is packaged`);
  }
  for (const file of files) {
    assert.doesNotMatch(file, /(^|\/)(tests|_private|\.claude|scripts|fixtures|dist)\//, `${file} must not be packaged`);
    assert.doesNotMatch(file, /\.bak$|\.DS_Store$/, `${file} must not be packaged`);
  }
  const srcFiles = [...files].filter((file) => file.startsWith("app/src/"));
  assert.ok(srcFiles.every((file) => file.endsWith(".mjs")), "Only modules from src/.");

  // Every module the app imports (relative, with or without ?v=) is in the package.
  for (const file of srcFiles) {
    const source = await readFile(path.join(result.buildDir, file), "utf8");
    for (const [, specifier] of source.matchAll(/from\s+"(\.\/[^"?]+)(?:\?[^"]*)?"/g)) {
      assert.ok(files.has(path.posix.join(path.posix.dirname(file), specifier)), `${file} imports ${specifier}`);
    }
  }

  // Extension pages run under script-src 'self': no inline scripts, handlers or remote CSS.
  const html = await readFile(path.join(result.buildDir, "app", "index.html"), "utf8");
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "No on*= attributes.");
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    assert.match(tag, /\ssrc=/, `Inline script not allowed: ${tag}`);
  }
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/, "No remote fonts.");
  assert.match(html, /<link rel="stylesheet" href="\.\.\/app-assets\/fonts\.css">/);
  assert.ok(
    html.indexOf('<script src="../cartforge-wants-flow.js"></script>') < html.indexOf('<script type="module"'),
    "Wants-flow helpers load before app.mjs."
  );
  assert.match(html, /src="\.\/src\/app\.mjs\?v=/, "The app module entry is unchanged.");
  // The website's index.html is untouched.
  assert.match(await readFile(path.join(root, "index.html"), "utf8"), /fonts\.googleapis\.com/);

  const packagedManifest = JSON.parse(await readFile(path.join(result.buildDir, "manifest.json"), "utf8"));
  assert.equal(packagedManifest.action?.default_title, "Open KAIKATA");
  assert.equal(packagedManifest.action?.default_popup, undefined, "Icon click opens the app tab, no popup.");

  if (hasZip) {
    assert.equal(path.basename(result.zipPath), `kaikata-extension-${manifest.version}.zip`);
    const listing = spawnSync("unzip", ["-Z1", result.zipPath], { encoding: "utf8" });
    assert.equal(listing.status, 0, listing.stderr);
    const entries = listing.stdout.split("\n").filter(Boolean);
    assert.ok(entries.includes("manifest.json"), "manifest.json at the zip root");
    assert.ok(entries.includes("app/index.html"));
    assert.ok(!entries.some((entry) => /(^|\/)(tests|_private|\.claude)\//.test(entry)));
    assert.equal(entries.filter((entry) => !entry.endsWith("/")).length, result.files.length);

    // Packaging twice replaces the zip instead of adding to it.
    const again = await packageExtension({ root, outDir, zip: true });
    assert.equal(again.zipBytes, result.zipBytes);
  }

  console.log(JSON.stringify({ packagedFiles: result.files.length, zipBytes: result.zipBytes, version: result.version }));
} finally {
  await rm(outDir, { recursive: true, force: true });
}
