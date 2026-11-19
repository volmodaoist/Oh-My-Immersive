/* The rules the Obsidian community-plugin review runs. Kept here so the
   findings arrive from `npm run lint` rather than from a reviewer.
 *
   Type-aware on purpose: several of the rules that matter here — unbound
   methods among them — read types rather than syntax, and without
   projectService they simply never fire. `npm run lint` must be run from the
   repository root: eslint-plugin-obsidianmd reads manifest.json from the
   working directory. */
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import js from "@eslint/js";
import globals from "globals";

const sourceFiles = "src/**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}";
const pluginConfigs = obsidianmd.configs.recommended.map(config => ({
  ...config,
  // Intersect the preset's original selectors with src. Keep its JS/TS
  // branches distinct so package.json's overrides cannot disable TS checks.
  files: config.files
    ? config.files.map(pattern => ["src/**", ...(Array.isArray(pattern) ? pattern : [pattern])])
    : [sourceFiles],
}));

export default tseslint.config(
  { ignores: ["main.js", "node_modules/**"] },
  ...pluginConfigs,
  {
    ...js.configs.recommended,
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.node },
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // This client and painter run in Safari/Chrome without Obsidian globals.
    files: ["src/ink/browser.ts", "src/ink/engine.ts"],
    rules: { "no-restricted-globals": "off", "obsidianmd/prefer-create-el": "off" },
  },
);
