#!/usr/bin/env node
import { copyFileSync, existsSync, realpathSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = ["main.js", "manifest.json", "styles.css"];

export function validateVault(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error('Vault path is required. Use: make install vault="/path/to/vault"');
  }
  const expanded = value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  const vault = resolve(expanded);
  if (!existsSync(vault) || !statSync(vault).isDirectory()) throw new Error(`Vault directory does not exist: ${vault}`);
  const config = join(vault, ".obsidian");
  if (!existsSync(config) || !statSync(config).isDirectory()) throw new Error(`Not an initialized Obsidian vault (missing .obsidian): ${vault}`);
  return vault;
}

export function copyBuiltPlugin(root, vaultPath) {
  const vault = validateVault(vaultPath);
  for (const name of artifacts) {
    const file = join(root, name);
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Missing build artifact: ${name}`);
  }
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  if (typeof manifest.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error("Invalid plugin ID in manifest.json");
  const destination = join(vault, ".obsidian", "plugins", manifest.id);
  mkdirSync(destination, { recursive: true });
  // Settings such as data.json are deliberately preserved on reinstall.
  for (const name of artifacts) copyFileSync(join(root, name), join(destination, name));
  return { destination, name: manifest.name, version: manifest.version };
}

function npm(args) {
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? "npm.cmd" : "npm", args, { cwd: projectRoot, stdio: "inherit", shell: windows });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed`);
}

export async function main() {
  if (process.argv.includes("--help")) {
    console.log('make install vault="/path/to/Obsidian vault"\n\nBuilds Oh-My-Immersive and copies its files into .obsidian/plugins/oh-my-immersive.\nExisting plugin settings are preserved. Enable or reload the plugin in Obsidian afterward.\n\nPublish: make release version=1.0.1\nPreview: make release-dry-run version=1.0.1\nOther targets: make build, make test, make lint, make check.');
    return;
  }
  const vault = validateVault(process.env.OH_MY_IMMERSIVE_VAULT ?? process.argv[2]);
  if (!existsSync(join(projectRoot, "node_modules", "esbuild", "package.json")) || !existsSync(join(projectRoot, "node_modules", "typescript", "package.json"))) {
    npm(["ci", "--no-audit", "--no-fund"]);
  }
  npm(["run", "build"]);
  const result = copyBuiltPlugin(projectRoot, vault);
  console.log(`Installed ${result.name} ${result.version}\n${result.destination}\nEnable Oh-My-Immersive in Settings → Community plugins, or reload it after an update.`);
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
