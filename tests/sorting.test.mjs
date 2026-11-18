import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { build } from "esbuild";

// Obsidian provides the runtime module inside the app. These small doubles
// let the actual bundled plugin code run with Node's built-in test runner.
class TAbstractFile {
  constructor(name, parent = null) {
    this.name = name;
    this.parent = parent;
    this.path = parent && parent.path !== "/" ? `${parent.path}/${name}` : name;
    if (parent) parent.children.push(this);
  }
}
class TFolder extends TAbstractFile {
  children = [];
  isRoot() { return this.parent === null; }
}
class TFile extends TAbstractFile {}
class PluginHost {
  constructor(app) { this.app = app; }
  async loadData() { return this.app.data; }
  async saveData(data) {
    this.app.data = plain(data);
    this.app.saves++;
  }
  registerEvent() {}
}
class MutationObserverStub {
  observe() {}
  disconnect() {}
}
class Row {
  constructor(file, container) {
    this.path = file.path;
    this.container = container;
    this.attrs = new Map([["data-path", file.path]]);
    this.classes = new Set();
    this.handle = null;
  }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  setAttribute(name, value) { this.attrs.set(name, value); }
  removeAttribute(name) { this.attrs.delete(name); }
  addClass(name) { this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  closest(selector) {
    return selector === ".nav-files-container" ? this.container : this;
  }
  querySelector() { return this.handle; }
  createDiv({ cls, attr }) {
    this.handle = {
      cls,
      hasAttribute: (key) => Object.hasOwn(attr, key),
      remove: () => { this.handle = null; },
    };
    return this.handle;
  }
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const result = await build({
  stdin: {
    contents: 'export { default as ImmersiveFolderPlugin } from "./src/main"; export * from "./src/order"; export { DragSort } from "./src/dnd";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    sourcefile: "sorting-test-entry.ts",
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  target: "es2018",
  external: ["obsidian", "remote-ink-client"],
});
const module = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, {
  module,
  exports: module.exports,
  require: (name) => {
    assert.equal(name, "obsidian");
    return {
      TAbstractFile, TFolder, TFile,
      Plugin: PluginHost,
      PluginSettingTab: class {},
      Modal: class {},
      Notice: class {},
      Platform: { isMobile: false },
    };
  },
  MutationObserver: MutationObserverStub,
  Element: Row,
  HTMLElement: Row,
  document: { documentElement: { lang: "en" } },
});
const { ImmersiveFolderPlugin, OrderStore, DragSort, ORDER_VERSION } = module.exports;

function fixture(data = null) {
  const root = new TFolder("/");
  const folder = new TFolder("Work", root);
  const other = new TFolder("Other", root);
  const aFolder = new TFolder("A", folder);
  const bFolder = new TFolder("B", folder);
  const a = new TFile("a.md", folder);
  const b = new TFile("a.pdf", folder);
  const c = new TFile("c.png", folder);
  const find = (path, node = root) => node.path === path
    ? node
    : node instanceof TFolder
      ? node.children.map((child) => find(path, child)).find(Boolean) ?? null
      : null;
  const events = new Map();
  const app = {
    data, saves: 0,
    vault: {
      getRoot: () => root,
      getFolderByPath: (path) => {
        const file = find(path);
        return file instanceof TFolder ? file : null;
      },
      getAbstractFileByPath: (path) => find(path),
    },
    workspace: {
      getLeavesOfType: () => [],
      iterateAllLeaves: () => {},
      on: (name, callback) => { events.set(name, callback); },
    },
  };
  const plugin = new ImmersiveFolderPlugin(app);
  // All native children are available even if the DOM only shows a few rows.
  plugin.sortPatch = {
    nativeItems: (parent) => parent.children.map((file) => ({ file })),
  };
  return { app, plugin, root, folder, other, aFolder, bFolder, a, b, c, events };
}
const displayed = (plugin, folder, files = folder.children) =>
  plain(plugin.orderStore.apply(folder, files.map((file) => ({ file }))).map((item) => item.file.name));

test("unarranged directories follow both native sort orders unchanged", () => {
  const { plugin, folder } = fixture();
  const native = folder.children.map((file) => ({ file }));
  assert.equal(plugin.orderStore.apply(folder, native), native);
  const reverse = native.slice().reverse();
  assert.equal(plugin.orderStore.apply(folder, reverse), reverse);
});

test("files of different types reorder independently of folders and survive reload", async () => {
  const { app, plugin, folder } = fixture();
  await plugin.loadSettings();
  await plugin.commitMove("Work", "c.png", "a.md", "before");
  await plugin.commitMove("Work", "B", "A", "before");
  const expected = ["B", "A", "c.png", "a.md", "a.pdf"];
  assert.deepEqual(displayed(plugin, folder), expected);
  assert.deepEqual(displayed(plugin, folder, folder.children.slice().reverse()), expected);
  assert.equal(app.saves, 2);
  const reloaded = new ImmersiveFolderPlugin(app);
  await reloaded.loadSettings();
  assert.deepEqual(displayed(reloaded, folder), expected);
  assert.equal(app.saves, 2);
});

test("commits reject mixed groups and missing or moved targets without saving", async () => {
  const { app, plugin, b, folder, other } = fixture();
  await plugin.loadSettings();
  await plugin.commitMove("Work", "a.md", "A", "after");
  await plugin.commitMove("Work", "a.md", "missing.pdf", "before");
  folder.children = folder.children.filter((child) => child !== b);
  b.parent = other;
  b.path = "Other/a.pdf";
  other.children.push(b);
  await plugin.commitMove("Work", "a.md", "a.pdf", "before");
  assert.deepEqual(plain(plugin.settings.orders), {});
  assert.equal(app.saves, 0);
});

test("new items join the end of their own group and the next drag captures every child", async () => {
  const { plugin, folder } = fixture();
  await plugin.commitMove("Work", "c.png", "a.md", "before");
  const newFolder = new TFolder("New", folder);
  const newFile = new TFile("new.canvas", folder);
  const another = new TFile("another.jpg", folder);
  assert.deepEqual(displayed(plugin, folder), ["A", "B", "New", "c.png", "a.md", "a.pdf", "new.canvas", "another.jpg"]);
  await plugin.commitMove("Work", newFile.name, "a.md", "before");
  assert.deepEqual(displayed(plugin, folder), ["A", "B", newFolder.name, "c.png", newFile.name, "a.md", "a.pdf", another.name]);
  assert.equal(plugin.settings.orders.Work.length, folder.children.length);
});

test("file rename, delete and cross-directory move maintain manual order", async () => {
  const { plugin, folder, other, a, b } = fixture();
  await plugin.commitMove("Work", "c.png", "a.md", "before");
  a.name = "renamed.md";
  a.path = "Work/renamed.md";
  assert.equal(plugin.orderStore.onRename(a, "Work/a.md"), true);
  assert.deepEqual(displayed(plugin, folder), ["A", "B", "c.png", "renamed.md", "a.pdf"]);
  assert.equal(plugin.orderStore.onDelete(a), true);
  assert.equal(plugin.settings.orders.Work.includes("renamed.md"), false);
  b.parent = other;
  b.path = "Other/a.pdf";
  assert.equal(plugin.orderStore.onRename(b, "Work/a.pdf"), true);
  assert.equal(plugin.settings.orders.Work.includes("a.pdf"), false);
  assert.equal(plugin.settings.orders.Other, undefined);
});

test("moving and deleting a folder carries and removes its subtree records", () => {
  const { plugin, folder, other } = fixture();
  plugin.orderStore.capture("/", ["Other", "Work"]);
  plugin.orderStore.capture("Work", ["B", "A", "a.pdf", "a.md"]);
  plugin.orderStore.capture("Work/A", ["nested.pdf", "nested.md"]);
  folder.parent = other;
  folder.path = "Other/Work";
  assert.equal(plugin.orderStore.onRename(folder, "Work"), true);
  assert.deepEqual(plain(plugin.settings.orders), {
    "/": ["Other"],
    "Other/Work": ["B", "A", "a.pdf", "a.md"],
    "Other/Work/A": ["nested.pdf", "nested.md"],
  });
  assert.equal(plugin.orderStore.onDelete(folder), true);
  assert.deepEqual(plain(plugin.settings.orders), { "/": ["Other"] });
});

test("restoring one directory preserves its children and other directories", async () => {
  const { app, plugin, folder } = fixture();
  await plugin.commitMove("Work", "c.png", "a.md", "before");
  plugin.orderStore.capture("Work/A", ["b.md", "a.md"]);
  plugin.orderStore.capture("Other", ["z.pdf", "a.md"]);
  await plugin.resetOrders("Work");
  assert.deepEqual(displayed(plugin, folder), ["A", "B", "a.md", "a.pdf", "c.png"]);
  assert.deepEqual(app.data.orders, { "Work/A": ["b.md", "a.md"], Other: ["z.pdf", "a.md"] });
  await plugin.resetOrders();
  assert.deepEqual(app.data.orders, {});
});

test("legacy folder orders are overwritten once while other settings survive", async () => {
  const { app, plugin } = fixture({ language: "zh", keepActiveInView: false, orders: { Work: ["B", "A"] } });
  await plugin.loadSettings();
  assert.deepEqual(app.data.orders, {});
  assert.equal(app.data.orderVersion, ORDER_VERSION);
  assert.equal(app.data.language, "zh");
  assert.equal(app.data.keepActiveInView, false);
  const reloaded = new ImmersiveFolderPlugin(app);
  await reloaded.loadSettings();
  assert.equal(app.saves, 1);
});

test("current order records are copied without modifying loaded data", async () => {
  const data = { orderVersion: ORDER_VERSION, orders: { Work: ["B", "A", "a.pdf", "a.md"] } };
  const { plugin } = fixture(data);
  await plugin.loadSettings();
  plugin.orderStore.move("Work", "a.md", "a.pdf", "before");
  assert.deepEqual(data.orders.Work, ["B", "A", "a.pdf", "a.md"]);
});

test("root files reorder and expose a root reset from a child folder menu", async () => {
  const { plugin, root, folder, events } = fixture();
  new TFile("root.md", root);
  new TFile("root.pdf", root);
  await plugin.commitMove("/", "root.pdf", "root.md", "before");
  await plugin.commitMove("Work", "B", "A", "before");
  plugin.registerOrderMenus();
  const entries = [];
  events.get("file-menu")({
    addItem(callback) {
      const entry = {
        setTitle(title) { this.title = title; return this; },
        setIcon() { return this; },
        onClick(callback) { this.callback = callback; return this; },
      };
      callback(entry);
      entries.push(entry);
    },
  }, folder);
  assert.deepEqual(entries.map((entry) => entry.title), ["Reorder", "Restore default order: Work", "Restore default order: /"]);
  entries[0].callback();
  assert.equal(plugin.dragSort.isActive(), true);
  entries[2].callback();
  assert.equal(plugin.settings.orders["/"], undefined);
  assert.deepEqual(plain(plugin.settings.orders.Work), ["B", "A", "a.md", "a.pdf", "c.png"]);
});

test("drag mode gives files handles and offers only same-group siblings", () => {
  const { plugin, a, b, aFolder, bFolder, other } = fixture();
  const nested = new TFile("nested.md", aFolder);
  const unrelated = new TFile("other.md", other);
  const container = { querySelectorAll: () => rows };
  const rows = [a, b, aFolder, bFolder, nested, unrelated].map((file) => new Row(file, container));
  const host = {
    documents: () => [{ querySelectorAll: () => [container] }],
    hint: () => "Drag to reorder",
    canDrag: (row) => plugin.canDrag(row),
    canDrop: (source, target) => plugin.canDrop(source, target),
  };
  const drag = new DragSort(host);
  drag.decorate();
  assert.ok(rows[0].handle);
  assert.equal(rows[0].getAttribute("data-immersive-folder-hint"), "");
  assert.deepEqual(plain(drag.findSiblings(a.path, rows[0]).map((row) => row.path)), [b.path]);
  assert.deepEqual(plain(drag.findSiblings(aFolder.path, rows[2]).map((row) => row.path)), [bFolder.path]);
  drag.removeHandle(rows[0].handle);
  assert.equal(rows[0].handle, null);
});

test("arranging a directory does not mutate the native result or supplied snapshot", () => {
  const { plugin, folder } = fixture();
  const store = new OrderStore(plugin);
  const snapshot = ["B", "A", "a.pdf", "a.md", "c.png"];
  store.capture(folder.path, snapshot);
  snapshot.reverse();
  const native = folder.children.map((file) => ({ file }));
  store.apply(folder, native);
  assert.deepEqual(native.map((item) => item.file.name), ["A", "B", "a.md", "a.pdf", "c.png"]);
  assert.deepEqual(plain(plugin.settings.orders.Work), ["B", "A", "a.pdf", "a.md", "c.png"]);
});

test("leaving immersive mode restores open and closed folders exactly", () => {
  const { app, plugin } = fixture();
  const item = (collapsed) => ({
    collapsible: true,
    collapsed,
    setCollapsed(value) { this.collapsed = value; },
  });
  const fileItems = {
    Work: item(false),
    "Work/A": item(false),
    "Work/B": item(true),
    Other: item(true),
    "Work/a.md": { collapsible: false, collapsed: false },
  };
  app.workspace.getLeavesOfType = () => [{ view: { fileItems } }];
  plugin.captureExpanded();
  fileItems.Work.collapsed = true;
  fileItems["Work/A"].collapsed = true;
  fileItems["Work/B"].collapsed = false;
  fileItems.Other.collapsed = false;
  plugin.restoreExpanded();
  assert.equal(fileItems.Work.collapsed, false);
  assert.equal(fileItems["Work/A"].collapsed, false);
  assert.equal(fileItems["Work/B"].collapsed, true);
  assert.equal(fileItems.Other.collapsed, true);
  assert.equal(fileItems["Work/a.md"].collapsed, false);
  assert.deepEqual(plain(plugin.settings.expandedBefore), []);
});
