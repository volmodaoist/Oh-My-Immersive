import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();

test("Node tool scripts may use built-ins, process and CLI logging", async () => {
  const [result] = await eslint.lintText('import { fileURLToPath } from "node:url"; console.log(fileURLToPath(import.meta.url), process.version);', { filePath: "scripts/install.mjs" });
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
  assert.equal(result.warningCount, 0, JSON.stringify(result.messages));
});

test("Node script lint still detects real undefined identifiers", async () => {
  const [result] = await eslint.lintText("console.log(undefinedReleaseValue);", { filePath: "scripts/release.mjs" });
  assert.ok(result.messages.some(message => message.ruleId === "no-undef" && message.severity === 2));
});

test("plugin code keeps Obsidian logging restrictions and type-aware checks", async () => {
  const [result] = await eslint.lintText('export async function example(): Promise<void> { console.log("debug"); await 42; }', { filePath: "src/main.ts" });
  assert.ok(result.messages.some(message => message.ruleId === "obsidianmd/rule-custom-message"));
  assert.ok(result.messages.some(message => message.ruleId === "@typescript-eslint/await-thenable"));
});
