#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, realpathSync, statSync, mkdtempSync, mkdirSync, rmSync, cpSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const versionFiles = ["package.json", "package-lock.json", "manifest.json", "versions.json", "CHANGELOG.md"];

function command(root, executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} ${args.join(" ")} failed\n${result.stderr ?? ""}${result.stdout ?? ""}`.trim());
  return result.stdout?.trim() ?? "";
}
const git = (root, ...args) => command(root, "git", args);

export function validateVersion(current, next) {
  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!pattern.test(current) || !pattern.test(next)) throw new Error("Use a version in x.y.z format, such as 1.0.1 (without v).");
  const a = current.split(".").map(BigInt), b = next.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return;
    if (b[i] < a[i]) break;
  }
  throw new Error(`New version must be greater than ${current}.`);
}

export function releaseNotes(changelog, version) {
  const marker = `## ${version}`;
  const lines = changelog.split("\n");
  const at = lines.findIndex(line => line === marker || line.startsWith(marker + " "));
  if (at === -1) throw new Error(`CHANGELOG.md has no ${version} section.`);
  const end = lines.findIndex((line, index) => index > at && line.startsWith("## "));
  const notes = lines.slice(at + 1, end === -1 ? undefined : end).join("\n").trim();
  if (!notes) throw new Error(`Release notes for ${version} are empty.`);
  return notes;
}

export function planRelease(root, version) {
  const original = new Map(versionFiles.map(name => [name, readFileSync(join(root, name), "utf8")]));
  const packageInfo = JSON.parse(original.get("package.json"));
  const manifest = JSON.parse(original.get("manifest.json"));
  const lock = JSON.parse(original.get("package-lock.json"));
  const versions = JSON.parse(original.get("versions.json"));
  validateVersion(packageInfo.version, version);
  if (manifest.version !== packageInfo.version || lock.version !== packageInfo.version || lock.packages?.[""]?.version !== packageInfo.version) throw new Error("Current package, lock and manifest versions are inconsistent.");
  if (versions[version]) throw new Error(`Version ${version} already exists in versions.json.`);
  const changelog = original.get("CHANGELOG.md");
  if (changelog.split("\n").some(line => line === `## ${version}` || line.startsWith(`## ${version} `))) throw new Error(`CHANGELOG.md already contains ${version}.`);
  const notes = releaseNotes(changelog, "Unreleased");
  packageInfo.version = version; manifest.version = version;
  lock.version = version; lock.packages[""].version = version;
  versions[version] = manifest.minAppVersion;
  const updated = new Map([
    ["package.json", JSON.stringify(packageInfo, null, 2) + "\n"],
    ["package-lock.json", JSON.stringify(lock, null, 2) + "\n"],
    ["manifest.json", JSON.stringify(manifest, null, 2) + "\n"],
    ["versions.json", JSON.stringify(versions, null, 2) + "\n"],
    ["CHANGELOG.md", changelog.replace(/^## Unreleased[^\n]*$/m, `## Unreleased\n\n## ${version}`)],
  ]);
  return { version, notes, original, updated };
}

function repositoryName(value) {
  const text = typeof value === "string" ? value : value?.url;
  if (!text) throw new Error("Package repository URL is missing.");
  const match = text.replace(/^git\+/, "").match(/(?:github\.com[/:]|^[^:/]+@[^:]+:)([^/]+\/[^/]+?)\/?(?:\.git)?$/i);
  if (!match) throw new Error(`Unsupported GitHub repository URL: ${text}`);
  return match[1].replace(/\.git$/, "").toLowerCase();
}

export function preflight(root, version) {
  if (git(root, "status", "--porcelain=v1")) throw new Error("Commit or stash all working-tree changes before releasing.");
  if (git(root, "branch", "--show-current") !== "main") throw new Error("Release from the main branch.");
  const packageInfo = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const remote = git(root, "remote", "get-url", "origin");
  if (repositoryName(remote) !== repositoryName(packageInfo.repository)) throw new Error("origin does not match the package's GitHub repository.");
  if (git(root, "tag", "--list", version)) throw new Error(`Local tag ${version} already exists.`);
  if (!git(root, "config", "user.name") || !git(root, "config", "user.email")) throw new Error("Configure Git user.name and user.email first.");
  return { plan: planRelease(root, version), remote, head: git(root, "rev-parse", "HEAD") };
}

function python(root) {
  for (const name of ["python3", "python"]) {
    const result = spawnSync(name, ["--version"], { cwd: root, encoding: "utf8" });
    if (result.status === 0 && /^Python 3\./.test((result.stdout ?? "") + (result.stderr ?? ""))) return name;
  }
  throw new Error("Python 3 is required for the commit message check.");
}
function shellQuote(value) { return "'" + value.replaceAll("\\", "/").replaceAll("'", "'\"'\"'") + "'"; }

function checkedCommit(root, version, pythonCommand) {
  const gitDir = git(root, "rev-parse", "--absolute-git-dir");
  const hookConfig = spawnSync("git", ["config", "--path", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" });
  const inherited = hookConfig.status === 0 ? resolve(root, hookConfig.stdout.trim()) : resolve(root, git(root, "rev-parse", "--git-path", "hooks"));
  const temp = mkdtempSync(join(gitDir, "release-check-"));
  try {
    const hooks = join(temp, "hooks");
    if (existsSync(inherited)) cpSync(inherited, hooks, { recursive: true });
    else mkdirSync(hooks);
    const check = join(root, ".github", "workflows", "check-commit.py");
    const inheritedCheck = join(inherited, "commit-msg");
    const useInheritedCheck = existsSync(inheritedCheck) && (process.platform === "win32" || (statSync(inheritedCheck).mode & 0o111) !== 0);
    const hook = join(hooks, "commit-msg");
    if (existsSync(hook)) rmSync(hook);
    writeFileSync(hook, "#!/bin/sh\n" + (useInheritedCheck ? `${shellQuote(inheritedCheck)} "$@" || exit $?\n` : "") + `exec ${shellQuote(pythonCommand)} ${shellQuote(check)} "$1"\n`);
    chmodSync(hook, 0o755);
    const message = join(temp, "message.txt");
    writeFileSync(message, `Release ${version}\n`);
    command(root, pythonCommand, [check, message]);
    command(root, "git", ["-c", `core.hooksPath=${hooks}`, "commit", "--file", message], { stdio: "inherit" });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export function publish(root, version, { dryRun = false } = {}) {
  const { plan, remote, head } = preflight(root, version);
  console.log(`Release ${version} → github.com/${repositoryName(remote)}\nUpdate ${versionFiles.join(", ")}\nRun tests, build and lint; check and commit the version; create tag ${version}; atomically push main and tag.`);
  if (dryRun) { console.log("Preview only: no files, commits, tags or remotes changed."); return; }
  const pythonCommand = python(root);
  git(root, "fetch", "origin");
  git(root, "merge-base", "--is-ancestor", "origin/main", "HEAD");
  if (git(root, "ls-remote", "--tags", "origin", `refs/tags/${version}`)) throw new Error(`Remote tag ${version} already exists.`);
  let committed = false;
  try {
    for (const [name, text] of plan.updated) writeFileSync(join(root, name), text);
    const windows = process.platform === "win32";
    for (const args of [["test"], ["run", "build"], ["run", "lint"]]) command(root, windows ? "npm.cmd" : "npm", args, { stdio: "inherit", shell: windows });
    if (git(root, "rev-parse", "HEAD") !== head) throw new Error("HEAD changed while release checks were running.");
    if (versionFiles.some(name => readFileSync(join(root, name), "utf8") !== plan.updated.get(name))) throw new Error("Version files changed while release checks were running.");
    const changed = [...git(root, "diff", "--name-only").split("\n"), ...git(root, "diff", "--cached", "--name-only").split("\n"), ...git(root, "ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean);
    if (changed.some(name => !versionFiles.includes(name))) throw new Error("Other working-tree files changed while release checks were running.");
    git(root, "add", "--", ...versionFiles);
    checkedCommit(root, version, pythonCommand);
    committed = true;
    git(root, "tag", "-a", version, "-m", `Oh-My-Immersive ${version}`);
    command(root, "git", ["push", "--atomic", "origin", "HEAD:refs/heads/main", `refs/tags/${version}`], { stdio: "inherit" });
    console.log(`Tag pushed. Follow GitHub Actions to confirm the release: https://github.com/${repositoryName(remote)}/actions`);
  } catch (error) {
    if (!committed) {
      for (const [name, original] of plan.original) {
        if (readFileSync(join(root, name), "utf8") === plan.updated.get(name)) writeFileSync(join(root, name), original);
      }
      git(root, "reset", "--", ...versionFiles);
    } else console.error(`Release commit exists locally. If push failed, inspect it and retry: git push --atomic origin HEAD:refs/heads/main refs/tags/${version}`);
    throw error;
  }
}

export function main() {
  if (process.argv[2] === "--notes") {
    const version = process.argv[3];
    if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("A release version is required.");
    console.log(releaseNotes(readFileSync(join(projectRoot, "CHANGELOG.md"), "utf8"), version));
    return;
  }
  const version = process.env.OH_MY_IMMERSIVE_VERSION;
  if (!version) throw new Error("Use: make release version=1.0.1 or make release-dry-run version=1.0.1");
  publish(projectRoot, version, { dryRun: process.argv.includes("--dry-run") });
}
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
