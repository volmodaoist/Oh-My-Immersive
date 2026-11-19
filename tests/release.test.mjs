import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { validateVersion, releaseNotes, planRelease, preflight, publish, projectRoot } from "../scripts/release.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oh-my-immersive-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "package.json": { name: "oh-my-immersive", version: "1.0.0", repository: { url: "git+https://github.com/volmodaoist/Oh-My-Immersive.git" } },
    "package-lock.json": { version: "1.0.0", packages: { "": { version: "1.0.0" } } },
    "manifest.json": { id: "oh-my-immersive", version: "1.0.0", minAppVersion: "1.15.1", author: "volmodaoist" },
    "versions.json": { "1.0.0": "1.15.1" },
  };
  for (const [name, value] of Object.entries(files)) writeFileSync(join(root, name), JSON.stringify(value, null, 2) + "\n");
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n- Improve publishing.\n\n## 1.0.0\n\n- Initial release.\n");
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout.trim();
  };
  git("init", "-b", "main");
  git("config", "user.name", "Release Test"); git("config", "user.email", "release@example.test");
  git("remote", "add", "origin", "git@github-zizi:volmodaoist/Oh-My-Immersive.git");
  git("-c", "core.hooksPath=/dev/null", "add", ".");
  git("-c", "core.hooksPath=/dev/null", "commit", "-m", "Initial release fixture");
  return { root, git };
}

test("release versions must be strict and greater than the existing version", () => {
  validateVersion("1.0.0", "1.0.1"); validateVersion("1.0.9", "1.1.0");
  for (const value of ["v1.0.1", "1.0", "1.0.1-beta", "01.0.1", "1.0.0", "0.9.9"]) assert.throws(() => validateVersion("1.0.0", value));
});

test("release planning synchronizes all version files and moves Unreleased notes", t => {
  const { root } = fixture(t), plan = planRelease(root, "1.0.1");
  for (const name of ["package.json", "package-lock.json", "manifest.json"]) assert.equal(JSON.parse(plan.updated.get(name)).version, "1.0.1");
  assert.equal(JSON.parse(plan.updated.get("package-lock.json")).packages[""].version, "1.0.1");
  assert.equal(JSON.parse(plan.updated.get("versions.json"))["1.0.1"], "1.15.1");
  assert.equal(JSON.parse(plan.updated.get("manifest.json")).author, "volmodaoist");
  assert.equal(releaseNotes(plan.updated.get("CHANGELOG.md"), "1.0.1"), "- Improve publishing.");
  assert.throws(() => releaseNotes(plan.updated.get("CHANGELOG.md"), "Unreleased"), /empty/);
  assert.equal(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version, "1.0.0");
});

test("empty notes and inconsistent current versions are rejected before changes", t => {
  const { root } = fixture(t);
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n## 1.0.0\n\nInitial.\n");
  assert.throws(() => planRelease(root, "1.0.1"), /empty/);
  writeFileSync(join(root, "manifest.json"), '{"version":"0.9.0"}');
  assert.throws(() => planRelease(root, "1.0.1"), /inconsistent/);
});

test("dry-run leaves files, commits and tags untouched", t => {
  const { root, git } = fixture(t), head = git("rev-parse", "HEAD");
  const contents = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  publish(root, "1.0.1", { dryRun: true });
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("tag", "--list"), "");
  assert.equal(git("status", "--porcelain=v1"), "");
  assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), contents);
});

test("dirty trees, duplicate tags and the wrong publishing remote are rejected", t => {
  const { root, git } = fixture(t);
  writeFileSync(join(root, "uncommitted.txt"), "work");
  assert.throws(() => preflight(root, "1.0.1"), /working-tree/);
  rmSync(join(root, "uncommitted.txt"));
  git("-c", "core.hooksPath=/dev/null", "tag", "1.0.1");
  assert.throws(() => preflight(root, "1.0.1"), /already exists/);
  git("-c", "core.hooksPath=/dev/null", "tag", "-d", "1.0.1");
  git("remote", "set-url", "origin", "git@github-zizi:someone/other-project.git");
  assert.throws(() => preflight(root, "1.0.1"), /does not match/);
});

function integration(t) {
  const { root, git } = fixture(t);
  const bare = join(dirname(root), basename(root) + "-origin.git");
  const bin = join(dirname(root), basename(root) + "-bin");
  t.after(() => { rmSync(bare, { recursive: true, force: true }); rmSync(bin, { recursive: true, force: true }); });
  mkdirSync(join(root, "scripts")); mkdirSync(join(root, ".github", "workflows"), { recursive: true }); mkdirSync(bin);
  copyFileSync(join(projectRoot, "scripts", "release.mjs"), join(root, "scripts", "release.mjs"));
  copyFileSync(join(projectRoot, ".github", "workflows", "check-commit.py"), join(root, ".github", "workflows", "check-commit.py"));
  git("-c", "core.hooksPath=/dev/null", "add", "."); git("-c", "core.hooksPath=/dev/null", "commit", "-m", "Add release fixture scripts");
  git("init", "--bare", bare); git("push", bare, "HEAD:refs/heads/main"); git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("config", "--local", "core.hooksPath", ".git/hooks");
  writeFileSync(join(root, ".git", "hooks", "commit-msg"), '#!/bin/sh\nprintf "\\nCo-authored-by: Extra <extra@example.test>\\n" >> "$1"\n');
  chmodSync(join(root, ".git", "hooks", "commit-msg"), 0o755);
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  const proxy = `#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');const a=process.argv.slice(2);if(a[0]==='fetch'&&a[1]==='origin'){a[1]=process.env.RELEASE_TEST_ORIGIN;a.push('+refs/heads/main:refs/remotes/origin/main');}if((a[0]==='ls-remote'||a[0]==='push')&&a.includes('origin'))a[a.indexOf('origin')]=process.env.RELEASE_TEST_ORIGIN;const r=spawnSync(process.env.RELEASE_TEST_GIT,a,{stdio:'inherit'});process.exit(r.status??1);\n`;
  writeFileSync(join(bin, "git"), proxy); chmodSync(join(bin, "git"), 0o755);
  writeFileSync(join(bin, "npm"), "#!/usr/bin/env node\nprocess.exit(process.env.RELEASE_TEST_FAIL_CHECKS==='1'?9:0);\n"); chmodSync(join(bin, "npm"), 0o755);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", PATH: bin + ":" + process.env.PATH, RELEASE_TEST_GIT: realGit, RELEASE_TEST_ORIGIN: bare, OH_MY_IMMERSIVE_VERSION: "1.0.1" };
  return { root, git, bare, env };
}

test("release CLI checks the message and atomically publishes to a local fixture", { skip: process.platform === "win32" }, t => {
  const { root, git, bare, env } = integration(t);
  const result = spawnSync(process.execPath, [join(root, "scripts", "release.mjs")], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version, "1.0.1");
  assert.equal(git("log", "-1", "--format=%B"), "Release 1.0.1");
  assert.equal(git("rev-parse", "HEAD"), git("--git-dir=" + bare, "rev-parse", "refs/heads/main"));
  assert.equal(git("rev-parse", "1.0.1^{}"), git("--git-dir=" + bare, "rev-parse", "refs/tags/1.0.1^{}"));
  assert.equal(git("status", "--porcelain=v1"), "");
});

test("failed release checks restore version files without committing or tagging", { skip: process.platform === "win32" }, t => {
  const { root, git, env } = integration(t), head = git("rev-parse", "HEAD");
  const before = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const result = spawnSync(process.execPath, [join(root, "scripts", "release.mjs")], { cwd: root, env: { ...env, RELEASE_TEST_FAIL_CHECKS: "1" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("tag", "--list"), "");
  assert.equal(git("status", "--porcelain=v1"), "");
  assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), before);
  assert.equal(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version, "1.0.0");
});
