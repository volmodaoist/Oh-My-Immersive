# Oh-My-Immersive：Obsidian 社区插件发布 SOP

核查日期：2026-11-19。本文针对 `volmodaoist/Oh-My-Immersive` 当前配置编写，官方流程与仓库状态以后可能变化，正式提交时需再次核对。

项目已在 GitHub 上解除 fork 关系，具备发布 GitHub 发行版的配置。进入 Obsidian 社区目录还需要确认衍生代码的准入条件、准备与当前代码一致的发行版，并在社区开发者界面提交和处理审核结果。`make release` 负责 GitHub 发行，社区提交需要单独操作。

## 1. 当前项目状态

| 检查项 | 当前结果 | 发布时的要求或后续动作 |
| --- | --- | --- |
| GitHub 仓库 | [volmodaoist/Oh-My-Immersive](https://github.com/volmodaoist/Oh-My-Immersive)，公开，默认分支 `main` | 社区能读取源码、清单和发行附件 |
| GitHub fork 关系 | API 返回 `fork: false`，`parent`、`source` 均为空 | 已脱离 GitHub 的 fork 网络；代码来源政策另见第 2 节 |
| Git 远端 | `origin` 指向本项目，`upstream` 指向 `iBlinkQ/immersive-folder` | 向 `origin` 发布；保留 `upstream` 只是方便查看原项目，不影响 GitHub 独立状态 |
| 插件身份 | ID 为 `oh-my-immersive`，名称为 `Oh-My-Immersive`，作者为 `volmodaoist` | 上架后保持 ID 稳定；社区表单会校验 ID 和名称唯一性 |
| 清单版本 | `manifest.json`、package/lock 版本均为 `1.0.0` | 新发行版的清单版本与标签完全一致 |
| 最低应用版本 | `minAppVersion: 1.15.1`，`versions.json` 已记录 `1.0.0 → 1.15.1` | 在最低支持版本验证；使用更高版本 API 时同步提高要求 |
| 平台 | `isDesktopOnly: true` | 本项目使用 Node.js / Electron，保留桌面限定；iPad 浏览器连接不等于支持移动版 Obsidian 安装 |
| 简短描述 | 当前英文描述少于 250 字符，以句号结尾 | 符合当前描述格式要求，内容需与功能一致 |
| README / LICENSE | 根目录文件齐全，MIT 保留 iBlinkQ 和 volmodaoist 的版权声明，README 说明原项目来源 | 保留许可与署名，并明确联网及数据处理行为 |
| GitHub Release | 已发布 [1.0.0](https://github.com/volmodaoist/Oh-My-Immersive/releases/tag/1.0.0)，有 `main.js`、`manifest.json`、`styles.css` | 当前 `main` 已有后续工具、代码整理与文档更新，建议发布新版本再提交社区 |
| 社区登记 | 核查公开 `community-plugins.json` 时未发现本项目 ID / 仓库条目 | 在社区开发者界面创建条目，实际状态以该界面为准 |
| 发布命令 | 已提供 `make release-dry-run`、`make release` | 执行前提交改动，保持工作区干净 |
| 发布工作流 | [release.yml](../.github/workflows/release.yml) 在标签推送时执行 | 确认 Actions 成功且发行附件完整；普通分支推送不会触发该工作流 |
| 本地自动检查 | 本次执行 `make check`：47 项测试通过，类型检查、构建与 lint 通过 | 尚需真实应用、最低支持版本与目标设备验证；不等于社区审核通过 |

根目录配置见 [manifest.json](../manifest.json)、[versions.json](../versions.json)、[package.json](../package.json) 和 [LICENSE](../LICENSE)。npm 的 `private: true` 只阻止发布到 npm，不会把 GitHub 仓库变成私有，也不妨碍 Obsidian 安装发行附件。

## 2. 提交社区前确认代码来源资格

MIT 允许在保留版权和许可声明的前提下修改、发布与分发衍生作品，无需另行取得原作者书面授权才能发布 GitHub Release。Obsidian 社区目录另有开发者政策，不能把这两项要求等同起来。

当前项目继承了 Immersive Folder 0.6.0 的代码。解除 GitHub fork 关系、修改仓库名或插件 ID 不会改变这一来源。官方 [Developer policies](https://docs.obsidian.md/community-directory/developer-policies) 对 fork 的条件是：

> The fork has received explicit written approval from the original author in a publicly verifiable way.

另一条路径要求能证明原作者无法联系且至少 6 个月未更新；满足 6 个月条件后联系原作者，并留出 30 天供其公开回应。两种情况下都要把原作者列为贡献者。对于显著分化的新项目，政策也写明应从新仓库和自己的代码开始，未经明确许可不继承原项目代码。

因此，本项目正式提交前应确认以下适用路径之一：

| 路径 | 需要准备的材料 |
| --- | --- |
| 原作者明确同意提交衍生插件 | 可公开核验的原作者书面同意链接，例如 issue 中的明确回复；保留原作者贡献者署名 |
| 原项目长期停更且作者无法联系 | 最后更新记录、联系记录与满足上述等待期的证据；保留原作者贡献者署名 |
| 使用自己的实现开展独立项目 | 核对实际代码来源，满足官方关于新项目继承代码的要求 |

目前本仓库中未见可公开核验的明确同意材料，也未核实第二条路径的停更和联系条件，不能据此认定社区准入已经满足。准备说明时应如实披露来源与新增功能；如果对本项目应如何适用政策仍有疑问，先通过官方支持渠道确认。该事项不影响现有源码安装和 MIT 下的 GitHub 发行。

## 3. 准备提交材料与验证

### 3.1 清单、源码和文档

社区读取默认分支 HEAD 的 `manifest.json`，安装时下载与其 `version` 同名的 GitHub Release 附件。提交前检查：

- `id` 唯一、使用小写字母与连字符、不含 `obsidian`，且不以 `plugin` 结尾；本项目安装目录为 `.obsidian/plugins/oh-my-immersive/`。
- 名称和描述符合官方要求，描述最多 250 字符、以英文句号结尾；当前名称与描述满足格式要求，唯一性由社区校验。
- `version` 使用严格的 `x.y.z`，标签不加 `v`；仓库根目录和发行附件中的清单一致。
- `minAppVersion` 与实际兼容性一致，`versions.json` 记录各发行版本的最低应用版本。本项目发布脚本会维护该文件。
- 保留 `isDesktopOnly: true`，说明 iPad 是远程浏览器客户端。
- README 描述用途、使用方法、安装步骤和限制，LICENSE 保留原始许可声明。未接受捐赠时不添加 `fundingUrl`。
- 不包含示例代码、遥测、自行安装/更新依赖或为隐藏功能而混淆的代码。`make install` 是用户主动运行的开发工具，不应变成插件运行期间的自动安装行为。

### 3.2 明确说明局域网服务的数据范围

官方要求在 README 明确披露联网行为。当前 README 已介绍局域网书写与内存笔迹，但提交前建议补齐连接机制、共享范围和第三方服务说明。以下内容应与 [server.ts](../src/ink/server.ts) 和 [controller.ts](../src/ink/controller.ts) 保持一致：

- 服务由用户启动，在本机所有 IPv4 网络接口上监听 HTTP，默认端口 `8674`，设置允许 `1024–65535`；停止服务时关闭连接。
- 连接设备收到当前 Obsidian 主窗口的画面截图以及笔迹状态。画面可能包含正在显示的笔记、侧栏和弹窗；服务不提供任意 vault 文件下载或远程编辑文件的接口。
- 画面、笔迹状态和写入接口需要本次启动生成的随机连接码；当前传输为 HTTP，连接码不等于传输加密。
- 该功能不依赖第三方云服务，不把画面或笔迹发送给第三方服务；连接浏览器与本机直接通信。
- 笔迹只保存在运行服务的内存中，停止服务、关闭 Obsidian 后清空；刷新浏览器会恢复仍在运行的会话笔迹。清屏可以从本机或网页操作。
- 插件设置与手动排序仍保存在 `data.json`；“笔迹不持久化”不意味着插件设置也不保存。

社区 README 以英文主文档为入口，建议同时更新 [README.md](../README.md) 和 [README.zh-CN.md](../README.zh-CN.md)。如果以后增加外部服务、库外文件访问或遥测，需重新核对官方披露要求。

### 3.3 本地检查和试用

以下命令在仓库根目录执行，需要 Git、Node.js / npm、GNU Make 与 Python 3。当前 Actions 使用 Node.js 20，复现远端构建时可使用同一版本。

```bash
npm ci
make check
make install vault="/你的 Obsidian 测试库路径"
```

`make check` 运行测试、类型检查与构建、全仓库 lint；本地检查通过不能代替社区扫描和真实应用试用。`make install` 会复制三个安装文件并保留 `data.json`，需要目标库已存在 `.obsidian`，不会自动启用插件。

建议在独立测试库启用 Oh-My-Immersive，并停用同库的原插件，避免同时接管文件列表。至少验证以下实际行为：

| 场景 | 验收内容 |
| --- | --- |
| 沉浸模式 | 遮挡范围正确；退出后恢复进入前的文件夹展开状态 |
| 排序 | 任意文件类型能拖拽；文件夹在前、文件在后；各自区域内排序；右键重排和恢复默认可用；重启保留手动顺序 |
| 远程书写 | 启停、复制地址、鼠标实时回传、两端清屏、浏览器刷新恢复当前会话、停止后再次启动为空白 |
| 画面与输入 | 底图持续更新无闪屏；笔迹位置一致；长按不触发选择；有 iPad 时实测 Pencil 压感与手掌误触 |
| 资源清理 | 停止、禁用插件或关闭主窗口后，无遗留监听服务和透明层；端口占用时能正常反馈错误 |
| 兼容性 | 在最低支持版本和当前稳定版验证；本项目依赖 Electron 透明窗口接口，Windows / macOS / Linux 的表现分别记录 |

尚未实测的平台或设备应记录为未验证，不根据鼠标测试推断 Pencil 或所有桌面平台均已通过。

## 4. 发布供社区安装的 GitHub Release

现有 `1.0.0` 已可手动安装。为了让首次提交包含当前 `main` 的改动，建议将下一次发行设为 `1.0.1`；若提交时该版本已占用，使用更高的未使用版本。

### 4.1 写发行说明并提交

在 [CHANGELOG.md](../CHANGELOG.md) 的 `## Unreleased` 下记录本次变更，然后提交源码与文档。版本脚本会自动更新版本文件，不需要再执行 `npm version`。

普通提交必须通过 [.github/workflows/check-commit.py](../.github/workflows/check-commit.py)。检查方法、Git 身份配置与现有 hooks 的串联方式见 [GitHub 操作与发布教程](../.github/README.md)。本项目作者配置为 `volmodaoist`，提交说明中不添加邮箱或署名 trailer。

正式发布要求：当前分支为 `main`、工作区与暂存区干净、版本递增、Unreleased 非空、`origin` 指向本项目且拥有推送权限。脚本会获取远端状态，要求本地包含 `origin/main` 的已有提交。

### 4.2 预览和执行

```bash
make release-dry-run version=1.0.1
```

预览显示目标仓库、版本文件和发布步骤，不修改文件、提交、标签或远端，也不运行完整测试和远端认证检查。

```bash
make release version=1.0.1
```

[scripts/release.mjs](../scripts/release.mjs) 执行：

1. 校验仓库、分支、版本和远端状态。
2. 同步 `package.json`、`package-lock.json`、`manifest.json`、`versions.json`，把 Unreleased 说明转为本次版本的发行说明。
3. 运行测试、构建和 lint，通过提交说明检查创建版本提交。
4. 创建同名 annotated tag，原子推送 `main` 与标签。

本机不需要登录 GitHub CLI。推送使用本机的 Git 认证，附件上传由 Actions 的 `GITHUB_TOKEN` 完成。

### 4.3 确认发行完成

打开 [Actions](https://github.com/volmodaoist/Oh-My-Immersive/actions)，确认本次 **Release plugin** 成功，再打开 [Releases](https://github.com/volmodaoist/Oh-My-Immersive/releases) 核对：

- Release 已公开发布，可作为稳定发行安装；标签等于 `manifest.json` 的版本，例如 `1.0.1`。
- 同一 Release 的附件有 `main.js`、`manifest.json`、`styles.css`。官方将 CSS 视为可选，本插件的界面需要它，发布时应齐全。
- 下载的是安装附件，不是 GitHub 自动生成的源码 ZIP；源码 ZIP 不含构建出的 `main.js`。
- 附件清单与默认分支清单版本、ID、最低应用版本一致，下载后在测试库验证安装。

标签推送成功只表示 Actions 已具备触发条件；完整发行版存在才算完成。当前工作流还生成构建来源证明，社区会另行扫描源码并校验构建，来源证明不等于社区批准。

失败处理见 [GitHub 教程](../.github/README.md)。若已经创建本地版本提交或已有远端 Release，先核对状态再重试；当前 `Create release` 步骤不是幂等操作，直接重跑可能遇到发行版重复。

## 5. 首次提交 Obsidian 社区目录

当前官方入口是 [community.obsidian.md](https://community.obsidian.md)。不要把旧的“修改 `obsidian-releases/community-plugins.json` 并提交 PR”教程当作当前新插件提交流程。

1. 使用 Obsidian 账号登录社区网站。
2. 在社区 **Profile** 页的 **GitHub → Connect** 连接 `volmodaoist` 的 GitHub 账号，完成仓库归属验证。
3. 在侧栏 **Plugins → New plugin** 打开表单。
4. 填入仓库 URL：`https://github.com/volmodaoist/Oh-My-Immersive`，Owner 选择维护此条目的个人或组织。
5. 在已确认第 2 节适用条件、已准备正式发行版后，阅读并同意 Developer policies 与持续维护承诺，再选择 **Submit**。
6. 进入条目管理页，检查自动审核结果，补充页面描述、类别与截图；需要时使用 **Add contributor** 为原作者提供公开贡献署名。

名称、ID、版本等来自默认分支 HEAD 的清单，不要只更新本机未提交的文件。首次提交需要同时存在可下载的匹配 Release，单有源码或标签不够。

## 6. 处理审核与确认上架

社区扫描清单、发行附件、源码，并验证构建与提交内容匹配。管理页区分 **Error、Warning、Recommendation、Pass**：

| 结果或操作 | 处理方式 |
| --- | --- |
| Error | 修复对应代码或元数据，增加版本并发布新 Release；错误未解决时，不能从 Obsidian 内安装 |
| Warning / Recommendation | Warning 不阻止提交，但应尽可能处理；对不适用项记录原因，并继续满足开发者政策 |
| Request review | 管理页的 `...` 菜单可请求立即复审 |
| Review branch | 可扫描默认分支、指定分支、标签或提交，预览扫描结果；不代替正式 Release |
| Edit listing / Publish | 编辑社区页面并保存，选择 Publish；仅点击 Publish 不会绕过 Error |
| Check for new releases | 新版本未显示时，在 `...` 菜单主动检查发行版 |

自动检查通过不应被当成代码来源政策已获确认。以管理页显示的实际状态、安装可用性和后续官方审核反馈为准。

上架验收：社区公开页面可访问，Obsidian **设置 → 第三方插件 → 浏览** 能搜到 Oh-My-Immersive，在未手工安装过本插件的测试库可以正常安装和启用。完成后再更新 README 中的社区安装入口与上架状态。

## 7. 上架后的版本更新

首次提交通过后，不需要每次重新创建插件条目。后续继续执行：

1. 修改代码与 README，在 Unreleased 写说明，运行检查与实际试用。
2. 按提交规则提交，在 `main` 使用 `make release-dry-run version=x.y.z` 和 `make release version=x.y.z`；将 `x.y.z` 换成更高版本。
3. 核对 Actions 和 Release 附件，必要时在社区条目选择 **Check for new releases**。
4. 查看新版本审核结果，修复 Error 并再发递增版本。用户从 Obsidian 内更新时，安装文件来自 GitHub Release。

建议在社区账号开启 **Action required notifications**，及时处理后续审核失败。保留插件 ID、版权声明和历史版本兼容映射；增加联网或数据访问行为时同步更新 README。

## 8. 官方资料与项目内入口

以下官方资料于核查日期读取；页面变化时以最新规则为准。

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)：默认分支清单、Release 附件与社区提交步骤。
- [Set up and claim](https://docs.obsidian.md/community-directory/set-up-and-claim)：账号连接、New plugin 表单和维护承诺。
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)：许可、fork 条件、联网披露与禁止行为。
- [Submission requirements for plugins](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)：描述、最低版本、桌面 Node.js / Electron 限定。
- [Manifest](https://docs.obsidian.md/Reference/Manifest)：ID、名称和清单字段要求。
- [Manage your plugin or theme](https://docs.obsidian.md/community-directory/manage-entry)：扫描、复审、贡献署名、版本更新与页面管理。
- [GitHub 操作与发布教程](../.github/README.md)：本项目提交检查、Make 发布、Actions 权限与失败恢复。
- [远程书写模块说明](../src/ink/README.md)：协议、输入处理、会话状态和资源生命周期。
