import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateVault, copyBuiltPlugin, projectRoot } from "../scripts/install.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oh-my-immersive-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("installation rejects missing vaults without creating directories", t => {
  const root = fixture(t), vault = join(root, "missing");
  assert.throws(() => validateVault(""), /Vault path is required/);
  assert.throws(() => validateVault(vault), /does not exist/);
  assert.equal(existsSync(vault), false);
  mkdirSync(vault);
  assert.throws(() => validateVault(vault), /missing .obsidian/);
});

test("copying the plugin preserves settings and unrelated plugin files", t => {
  const root = fixture(t), source = join(root, "source"), vault = join(root, "我的库 with spaces");
  mkdirSync(source);
  const destination = join(vault, ".obsidian", "plugins", "oh-my-immersive");
  mkdirSync(destination, { recursive: true });
  const manifest = { id: "oh-my-immersive", name: "Oh-My-Immersive", version: "1.0.0" };
  writeFileSync(join(source, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(source, "main.js"), "new bundle");
  writeFileSync(join(source, "styles.css"), "new styles");
  writeFileSync(join(destination, "data.json"), '{"inkPort":9000}');
  writeFileSync(join(destination, "other.txt"), "keep me");
  assert.equal(copyBuiltPlugin(source, vault).destination, destination);
  assert.equal(readFileSync(join(destination, "main.js"), "utf8"), "new bundle");
  assert.equal(readFileSync(join(destination, "data.json"), "utf8"), '{"inkPort":9000}');
  assert.equal(readFileSync(join(destination, "other.txt"), "utf8"), "keep me");
});

test("missing artifacts and invalid IDs leave the target untouched", t => {
  const root = fixture(t), source = join(root, "source"), vault = join(root, "vault");
  mkdirSync(source); mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(source, "manifest.json"), '{"id":"../outside"}');
  assert.throws(() => copyBuiltPlugin(source, vault), /Missing build artifact/);
  writeFileSync(join(source, "main.js"), "bundle"); writeFileSync(join(source, "styles.css"), "styles");
  assert.throws(() => copyBuiltPlugin(source, vault), /Invalid plugin ID/);
  assert.equal(existsSync(join(vault, ".obsidian", "plugins")), false);
});

test("make install accepts spaces, Unicode and literal shell characters in a vault path", t => {
  const root = fixture(t);
  const vault = join(root, "笔记 vault ' $dollar $(literal) `literal`");
  const target = join(vault, ".obsidian", "plugins", "oh-my-immersive");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "data.json"), '{"language":"zh"}');
  const result = spawnSync("make", ["install", "vault=" + vault], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "oh-my-immersive");
  assert.equal(manifest.name, "Oh-My-Immersive");
  assert.equal(manifest.isDesktopOnly, true);
  assert.equal(readFileSync(join(target, "data.json"), "utf8"), '{"language":"zh"}');
  assert.ok(existsSync(join(target, "main.js")));
  assert.ok(existsSync(join(target, "styles.css")));
});
