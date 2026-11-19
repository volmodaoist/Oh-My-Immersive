# GitHub 操作与发布教程

本项目的 GitHub 自动化、提交说明检查和发行版操作说明。下面的终端命令都在仓库根目录执行。

## 当前目录有哪些文件

| 文件 | 谁执行 | 作用 | 触发方式 |
| --- | --- | --- | --- |
| [workflows/release.yml](workflows/release.yml) | GitHub Actions | 校验、构建并上传 GitHub Release | 版本标签推送到远端 |
| [workflows/check-commit.py](workflows/check-commit.py) | 本机 Python 3 | 检查和清理提交说明中的邮箱、署名及生成工具标识 | 手工调用；`make release` 自动调用 |

`.github` 是 GitHub 配置目录。Actions 会读取 `workflows/` 下的 YAML 文件；Python 脚本不会因为放在这里就自动运行。

当前没有针对普通分支 push 或 pull request 的独立 CI workflow。日常提交先在本地执行 `make check`；发布标签会触发远端校验。

## 首次准备

需要 Git、Node.js 与 npm、GNU Make 和 Python 3。建议使用 Node.js LTS。

```bash
git config --local user.name "volmodaoist"
git config --local user.email "1304548501@qq.com"
git remote -v
npm ci
```

本项目的远端分工：

| 远端 | 仓库 | 用途 |
| --- | --- | --- |
| `origin` | `volmodaoist/Oh-My-Immersive` | 推送本项目代码和发行标签 |
| `upstream` | `iBlinkQ/immersive-folder` | 查看或获取原项目更新 |

当前配置使用本机 SSH 别名 `github-zizi`。其他电脑可使用自己配置的 SSH 别名、标准 `git@github.com:...` 地址或 HTTPS，并确保有 `origin` 的推送权限。

在 GitHub 仓库的 **Actions** 页面确认 workflow 已启用。Fork 仓库首次使用可能需要手动启用。发布流程使用 GitHub 自动提供的 `GITHUB_TOKEN`，不需要在本机登录 `gh`。

## 日常开发与提交

### 校验和安装

```bash
make check
make install vault="/你的 Obsidian 库路径"
```

`make check` 运行测试、构建和全仓库 lint。`make install` 构建并复制插件文件，保留目标库已有的配置；路径包含空格时需要加引号。

### 检查提交说明

`check-commit.py` 接受一个提交说明文件路径。它会移除署名 trailer，并拒绝说明中的邮箱和生成工具标识。Git 作者、提交者的元数据仍使用正常 Git 配置。

例如在 macOS/Linux 或 Git Bash 中提交 README 修改（其他改动换成相应文件）：

```bash
commit_message_file=$(mktemp)
printf 'Improve remote ink drawing\n' > "$commit_message_file"
python3 .github/workflows/check-commit.py "$commit_message_file"
git add README.md
git commit --file "$commit_message_file"
rm "$commit_message_file"
git push origin main
```

普通 `git commit` 不会仅因为仓库包含这个 Python 文件就自动检查说明。若要为普通提交自动检查，可配置本机的 `commit-msg` hook，并与已有 hook 串联。已有 `core.hooksPath` 时应在它指定的目录配置，保留已有检查。

`make release` 会自动串联原有 hooks 和这个检查器，对即将写入提交对象的说明执行检查。

## 快速发布新版本

### 1. 写好发行说明并提交改动

在 [CHANGELOG.md](../CHANGELOG.md) 的 `## Unreleased` 下记录本次修改，提交代码和文档。正式发布前要求：

- 当前分支为 `main`。
- 工作区和暂存区干净。
- `origin` 对应本项目仓库，并有推送权限。
- Git 身份已配置。
- Unreleased 说明非空。
- 新版本为递增的 `x.y.z`，且标签尚未使用。

### 2. 预览

```bash
make release-dry-run version=1.0.1
```

会显示目标仓库、更新的文件和发布步骤，不修改文件、提交、标签或远端。

### 3. 正式执行

```bash
make release version=1.0.1
```

[scripts/release.mjs](../scripts/release.mjs) 会依次执行：

1. 校验分支、版本、提交状态及远端，获取最新 `origin/main`。
2. 同步 `package.json`、`package-lock.json`、`manifest.json` 和 `versions.json`。
3. 将 Unreleased 说明转为新版本的 CHANGELOG 段落。
4. 运行测试、构建和 lint。
5. 检查提交说明，创建版本提交和同名标签。
6. 原子推送 `main` 和标签；两者在远端一同成功或一同失败。

标签必须与清单版本完全一致，例如 `1.0.1`，不加 `v`。

### 4. 确认 GitHub 发布成功

打开 [Actions](https://github.com/volmodaoist/Oh-My-Immersive/actions)，进入本次 **Release plugin** 运行记录。

[release.yml](workflows/release.yml) 在 GitHub 服务器上执行：

| 步骤 | 作用 |
| --- | --- |
| Install | 通过 `npm ci` 安装锁定依赖 |
| Run tests / Lint / Build | 校验和构建插件 |
| Check tag matches manifest version | 检查标签与清单版本一致 |
| Attest build provenance | 为构建产物生成来源证明 |
| Create release | 从 CHANGELOG 提取说明，创建发行版并上传附件 |

Actions 成功后，在 [Releases](https://github.com/volmodaoist/Oh-My-Immersive/releases) 确认同一版本下存在：

- `main.js`
- `manifest.json`
- `styles.css`

`make release` 返回表示标签已经推送；Actions 全部成功、发行附件齐全后，才算发布完成。

## 失败时怎么处理

| 情况 | 处理方式 |
| --- | --- |
| 工作区不干净 | 先完成并提交改动，或妥善暂存，再执行发布 |
| 版本或标签重复 | 选择一个更大的、尚未使用的版本 |
| 本地测试、构建或 lint 失败 | 修复后重试；脚本会撤回它自己的版本文件修改 |
| 版本提交已创建，但推送失败 | 检查本地提交和标签，再执行脚本输出的原子推送重试命令 |
| SSH/HTTPS 无推送权限 | 修正 `origin` 的认证和仓库权限 |
| 标签推送后没有 Actions 运行 | 检查仓库是否启用了 workflow，确认标签推到了 `origin` |
| Actions 发布前失败 | 打开失败步骤查看日志，修复原因；可在运行记录中选择 **Re-run all jobs** |
| Release 已存在但附件不完整 | 先核对现有附件；当前 Create release 步骤并非幂等操作，盲目重跑会遇到重复发行版问题 |

不要只根据终端“推送成功”判断发行完成，最终以 Actions 和 Release 附件为准。

## Workflow 权限

`release.yml` 的权限用途：

- `contents: write`：创建 Release 和上传附件。
- `id-token: write`、`attestations: write`：生成构建来源证明。

发布所用的 `GITHUB_TOKEN` 由 GitHub 自动注入 workflow，不要把个人 token 写进代码或文档。

## GitHub Release 与 Obsidian 社区目录

上述流程发布的是 GitHub 发行版。用户可以下载三个附件手动安装，或使用 `make install` 从源码安装。

Obsidian 社区目录提交是另一项操作，需要通过 [community.obsidian.md](https://community.obsidian.md) 的开发者界面提交并处理审核反馈。推送标签和创建 GitHub Release 不会自动完成社区上架。
本项目的当前准备状态、代码来源条件与社区提交步骤见 [Obsidian 插件发布 SOP](../docs/ob-sop.md)。

## 可扩展的 `.github` 功能

以后需要时可以增加这些配置；当前仓库尚未配置：

| 配置 | 用途 |
| --- | --- |
| `workflows/ci.yml` | 普通 push、PR 时自动测试和 lint |
| `ISSUE_TEMPLATE/` | Bug 报告和功能请求模板 |
| `pull_request_template.md` | PR 说明模板 |
| `CODEOWNERS` | 指定目录的评审负责人 |
| `dependabot.yml` | 自动提出依赖更新 PR |

更多操作参考 [GitHub Actions 文档](https://docs.github.com/actions) 和 [GitHub Releases 文档](https://docs.github.com/repositories/releasing-projects-on-github/about-releases)。
