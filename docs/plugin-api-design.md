# 插件扩展 API 设计建议

这是基于当前代码的设计草案，尚未作为公开接口发布。目标是让其他 Obsidian 插件
调用 Oh-My-Immersive 的书写、演示与排序能力，并让独立浏览器客户端复用书写协议。

## 适合开放的能力

| 能力 | 当前实现 | 建议开放方式 | 准备程度 |
| --- | --- | --- | --- |
| 绘制与笔迹模型 | [engine.ts](../src/ink/engine.ts)、[protocol.ts](../src/ink/protocol.ts) | 笔迹快照、绘制操作、事件订阅；以后可单独发布浏览器 SDK | 模型和网络输入验证已独立，画布绘制仍需 DOM 宿主 |
| 远程书写服务 | [server.ts](../src/ink/server.ts)、[controller.ts](../src/ink/controller.ts) | 启动、停止、清屏、状态与显式获取连接地址 | 生命周期已有独立方法，仍需统一并发操作、能力检查和对外错误 |
| 手动排序 | [order.ts](../src/order.ts) | 按目录读取、设置与恢复顺序 | 已独立维护排序记录；还依赖 Obsidian 文件类型和文件栏条目类型 |
| 沉浸模式 | [main.ts](../src/main.ts) | 读取/设置模式、订阅状态 | 模式、展开状态恢复与界面绘制集中在主类，需要抽取管理器 |
| 文件栏适配 | [explorer-api.ts](../src/explorer-api.ts) | 由内部适配层提供能力检查，对外只返回稳定结果 | 使用 Obsidian 内部接口，需继续维护运行时守卫 |

其他插件可以据此增加“开始演示时开启遮挡”“切换课件时清屏”“批量安排目录顺序”
或自定义书写工具栏。画布 SDK 还可以让网页项目共享相同的压感、擦除与笔迹格式。

## 两类接口

| 接口 | 使用者 | 用途 |
| --- | --- | --- |
| Obsidian 插件间的 TypeScript API | 安装在同一 Obsidian 实例中的其他插件 | 管理服务、控制模式、操作排序与订阅事件 |
| HTTP / SSE 协议及 OpenAPI 描述 | iPad 页面、独立网页或其他局域网客户端 | 获取画面和快照、上传笔迹、接收同步事件 |

目前已有 `/api/state`、`/api/op`、`/api/scroll`、`/events` 和 `/frame`，但这些是当前客户端的内部
协议：没有公开的版本与兼容承诺，也没有对外的 OpenAPI 文档。OpenAPI 可以描述
HTTP 请求和响应；SSE 的事件名、顺序、补帧与重连规则还需要单独说明。

建议先提供同实例的 TypeScript API，让第三方插件复用同一份服务和状态。
远程协议可以随后加入版本、文档与客户端 SDK，避免每个插件创建独立 HTTP 服务。

## 第一版公开 API 草案

优先开放书写服务控制，稳定后再加入绘制操作、排序和沉浸管理。下面是拟定的形状，
当前版本没有提供 `getApi()` 或这些公开类型：

```ts
export enum InkServiceState {
  Stopped = "stopped",
  Starting = "starting",
  Running = "running",
  Stopping = "stopping",
  Unavailable = "unavailable",
}

export interface InkServiceStatus {
  readonly state: InkServiceState;
  readonly port: number | null;
}

export interface InkConnection {
  readonly local: string;
  readonly lan: readonly string[];
}

export interface OhMyImmersiveApiV1 {
  readonly apiVersion: 1;
  readonly ink: {
    getStatus(): InkServiceStatus;
    start(options?: { port?: number }): Promise<void>;
    stop(): Promise<void>;
    clear(): void;
    getConnection(): InkConnection | null;
    onStatusChange(listener: (status: InkServiceStatus) => void): () => void;
  };
}
```

API 应使用对象而非 UI 按钮来操作核心能力，启动不打开连接面板，显示面板也不启动
服务。当前已将 `openInk()` 和 `startInk()` 分开，但它们仍是插件实现方法，尚未形成
稳定的公共 API。

## 公开前需要补齐的约定

- **实例发现与版本**：提供 `getApi()` 与公共类型；Obsidian 没有在本项目使用的公开
  类型中提供标准的插件依赖机制，插件发现应集中在兼容层并做运行时校验。第三方
  先检查本插件是否已启用、API 版本与功能可用性。
- **并发与权限范围**：同一宿主保持一份服务；重复启动/停止的结果明确，启动中
  停止能取消待完成的启动。第三方应响应用户操作启动服务，停止或清屏会影响所有
  连接者，需要让调用方清楚这是共享会话。
- **只读边界**：状态与笔迹快照返回副本；不暴露 `settings`、`InkStore.strokes`、
  原生窗口、排序补丁或文件栏 DOM，防止外部修改破坏内部不变量。
- **连接信息**：普通状态事件不包含连接码，完整地址只由显式 `getConnection()`
  返回。界面的遮挡只保护显示，不是 API 权限控制。
- **事件生命周期**：订阅返回取消函数，第三方通过自身 `register()` 清理。宿主
  禁用时清理服务与订阅；重新启用后重新获取 API，旧对象不再执行操作。
- **笔迹操作**：后续开放 `applyOperation()` 时，复用网络请求的载荷验证、大小限制
  与同一广播通道，不能只改 `InkStore` 而漏掉 SSE 同步。
- **排序约束**：目录 API 使用路径与完整文件名，校验条目属于同一目录，保留文件夹
  在前、文件在后的规则，统一触发保存和刷新；不让调用方直接改排序记录。
- **兼容性与错误**：使用明确的错误类型或错误码，区分端口占用、平台不可用、宿主
  已卸载和参数无效；Obsidian 内部接口失效时返回不可用状态，保留其他功能。
- **版本承诺**：API 版本独立于插件发行版本；小版本只追加兼容能力，破坏性改动
  提高 API 版本。内部重构不能要求第三方随之改代码。

## 建议实施顺序

1. 抽出书写服务管理器，补齐状态事件、并发操作与卸载失效语义；发布第一版书写
   控制 API、类型文件和一个简单调用示例。
2. 抽出沉浸管理器和目录排序服务，增加能力检查；为 API 增加目录与模式控制。
3. 根据实际第三方客户端需求，版本化 HTTP 协议、提供 OpenAPI 描述与 SSE 文档，
   再将可复用的绘制/协议部分发布为浏览器 SDK。

本次界面调整只完成 UI 与启动生命周期的分离，以上 API 后续按独立功能实现与验证。
