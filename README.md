# Config Sync with WebDAV

> 一句话定位：**只同步 vault 配置目录（`.obsidian/`）的 WebDAV 同步插件**，独立于笔记内容同步。
> A WebDAV sync plugin that syncs **only your vault's configuration folder (`.obsidian/`)** — completely independent from notes-content sync.

[中文](#中文) | [English](#english)

---

## 中文

**版本：v0.4.2** · 插件 id：`personal-config-sync`

与笔记内容同步（如 [nextcloud-sync-yanc](https://github.com/yanqingwang/obsidian-nextcloud-sync-yanc)）完全独立：两个插件各自在远端占一个目录，互不越界 —— 内容线只管笔记，本插件只管配置。

### 特性

- **默认预填坚果云 (jianguoyun) 的 WebDAV 地址**，你只需填账号 + 应用密码。其他 WebDAV 服务器（Nextcloud、自建等）也可用。
- **默认所有插件都同步**；同步范围**只按插件粒度选择** —— 复选框列表勾选某个插件 = 该插件整个文件夹都不同步。
- **内置安全规则自动排除设备本地文件**（`workspace.json`、`backlink.json`、各插件 `data.json` / `main.js` 等），无需手动配置。
- **文本配置（json/md/css）冲突走 diff3 三方合并**；非文本冲突保留双方副本。
- **同步前自动做网络连通性测试**，失败即给出具体原因（网络 / 认证 / URL 错误），不盲目开同步。
- 零运行时依赖：`main.js` 已内联 `node-diff3`，不额外占用插件体积。

### 安装

```bash
pnpm install
pnpm build          # 生成 main.js（esbuild 内联 node-diff3，无运行时依赖）
```

把 `main.js`、`manifest.json`、`styles.css` 三个文件放进：

```
<你的Vault>/.obsidian/plugins/personal-config-sync/
```

然后在 Obsidian「设置 → 第三方插件 → Plugin Sync」启用。

### 配置

进入插件设置页：

| 字段 | 说明 |
|---|---|
| **serverUrl**（服务器地址） | 默认 `https://dav.jianguoyun.com/dav/`；Nextcloud 填 `https://<host>/remote.php/dav/files/<user>/` |
| **username**（用户名） | 坚果云账号（邮箱）或 Nextcloud 用户名 |
| **password**（密码） | **应用密码**（坚果云网页 → 账户信息 → 安全选项 → 添加应用密码），不是登录密码 |
| **remoteConfigRoot**（远端配置目录） | 默认 `<vault>-config`，独立于笔记内容目录 |
| **autoSyncIntervalMinutes**（自动同步间隔） | 0 = 仅手动 / 事件触发；大于 0 则每 N 分钟自动同步 |
| **excludePlugins**（排除的插件） | 复选框列表，勾选某个插件 = 整个插件文件夹都不同步（默认全不勾） |
| **conflictStrategy**（冲突策略） | 三方合并（默认）/ 保留双方 / 本地优先 / 远端优先 |
| **测试连接** | 按钮，先测连通性再决定是否同步 |

密码只保存在本机 vault 的 `data.json`，**不会**被同步到远端（本插件的内置排除规则覆盖自身状态文件）。

### 同步边界（安全设计）

**永远不同步**（设备本地状态，同步会弄坏别的设备）—— 内置规则，无需配置：

- `workspace.json`、`backlink.json`、`graph.json` —— 窗口布局 / 图缓存
- `plugins/*/data.json`、`plugins/*/cache`、`plugins/*/main.js`、`plugins/*/styles.css`、`plugins/*/manifest.json` —— 各插件本机状态与代码
- 扩展名 `tmp` / `lock`

**会同步**：`app.json`、`appearance.json`、`core-plugins.json`、`community-plugins.json`、`themes/`、`plugins/*/` 下你新增的配置/数据文件。

**被勾选的插件**：整个文件夹都不同步（包括它的 `data.json`、`main.js`、状态文件）。

### 冲突处理

- **merge**（默认）：下载远端 → diff3 三方合并 → 本地写入合并结果并上传。冲突区域插入 `<<<<<<< LOCAL / ======= / >>>>>>> REMOTE` 标记，同时把远端版本另存为 `<file>.conflict-<ts>`。
- **keep-both**：本地保持原样，远端副本存为 `<file>.conflict-<ts>`。
- **local-win** / **remote-win**：直接覆盖。

### 与内容同步插件的隔离

```
内容同步 (nextcloud-sync-yanc)  →  远端 <vault>/         只管笔记
配置同步 (本插件)              →  远端 <vault>-config/   只管 .obsidian/
```

**重要**：如果你的内容同步插件也在跑，请在其设置 → 「排除文件夹」里加入 `.obsidian`，让内容线完全避开配置目录。

### 测试

```bash
pnpm test:filter     # 验证同步范围/排除规则逻辑（22 用例）
```

### 目录结构

```
src/
├── main.ts                  # 插件入口：事件、命令、状态栏、定时器、连通性预检
├── settings.ts              # 设置面板：连接 + 插件 checkbox 列表 + 冲突 + 操作
├── types.ts                 # 最小类型层（纯 WebDAV）
├── sync/
│   ├── engine.ts            # diff + 上传/下载/删除 + 冲突处理（adapter.list 扫描 .obsidian）
│   └── filter.ts            # 插件级排除 + 内置安全规则
├── util/
│   ├── excludedExtensions.ts# 扩展名排除（复用 nextcloud-sync-yanc, MIT）
│   └── retry.ts             # 网络重试（复用 nextcloud-sync-yanc, MIT）
└── webdav/
    ├── StandardWebDAVClient.ts  # WebDAV 客户端（fork 自 nextcloud-sync-yanc, MIT）
    ├── IWebDAVClient.ts         # 精简接口
    ├── ConnectionTester.ts      # 两阶段连通性测试（fork 自 nextcloud-sync-yanc, MIT）
    ├── RemoteDirCache.ts        # 已建目录缓存
    ├── remotePath.ts            # URL 编码 / 祖先目录创建
    ├── requestWithTimeout.ts    # 超时请求
    ├── errorMessages.ts         # 友好错误提示
    ├── noCacheHeaders.ts
    └── dav/propfind.ts          # PROPFIND XML 解析
```

WebDAV 客户端层 fork 自 [nextcloud-sync-yanc](https://github.com/yanqingwang/obsidian-nextcloud-sync-yanc)（MIT），已去掉 Nextcloud 专属的版本历史、文件锁、分块上传、sync token，保留纯标准 WebDAV 能力。

### License

MIT

---

## English

**Version: v0.4.2** · Plugin id: `personal-config-sync`

Completely independent from notes-content sync (e.g. [nextcloud-sync-yanc](https://github.com/yanqingwang/obsidian-nextcloud-sync-yanc)): each plugin owns its own remote folder and never crosses into the other's. The content plugin handles notes; this plugin handles configuration only.

### Overview

An Obsidian plugin that syncs **only the `.obsidian/` configuration folder** over WebDAV. It does not touch your notes.

### Features

- **Jianguoyun (坚果云) WebDAV address is pre-filled** — you only supply an account and an App Password. Other WebDAV servers (Nextcloud, self-hosted, etc.) work too.
- **All plugins sync by default**; the sync scope is **per-plugin only** — tick a plugin in the checkbox list to exclude its whole folder.
- **Built-in safety rules automatically skip device-local files** (`workspace.json`, `backlink.json`, each plugin's `data.json` / `main.js`, etc.) — no manual configuration needed.
- **Text configs (json/md/css) merge via diff3 three-way merge**; non-text conflicts keep both copies.
- **Automatic network connectivity test before every sync** — on failure it reports a specific cause (network / auth / wrong URL) instead of blindly syncing.
- **Zero runtime dependencies**: `main.js` bundles `node-diff3`; nothing extra to install.

### Install

```bash
pnpm install
pnpm build          # produces main.js (esbuild inlines node-diff3; no runtime deps)
```

Place the three files `main.js`, `manifest.json`, `styles.css` into:

```
<your-vault>/.obsidian/plugins/personal-config-sync/
```

Then enable **Plugin Sync** in Obsidian: **Settings → Community plugins**.

### Configuration

In the plugin settings tab:

| Field | Description |
|---|---|
| **serverUrl** | Default `https://dav.jianguoyun.com/dav/`; for Nextcloud use `https://<host>/remote.php/dav/files/<user>/` |
| **username** | Jianguoyun account (email) or Nextcloud username |
| **password** | **App Password** (Jianguoyun: web → Account Info → Security → Add App Password), NOT the login password |
| **remoteConfigRoot** | Default `<vault>-config`, separate from the notes-content folder |
| **autoSyncIntervalMinutes** | 0 = manual / event-triggered only; > 0 = sync every N minutes |
| **excludePlugins** | Checkbox list; tick a plugin to exclude its entire folder (none ticked by default) |
| **conflictStrategy** | Three-way merge (default) / keep-both / local-win / remote-win |
| **Test Connection** | Button that tests connectivity before you decide to sync |

The password is stored only in the local vault's `data.json` and is **never** synced to the remote (this plugin's built-in exclusion covers its own state files).

### Sync Boundaries (Safety Design)

**Never synced** (device-local state that would corrupt another device) — built-in, no configuration needed:

- `workspace.json`, `backlink.json`, `graph.json` — window layout / graph cache
- `plugins/*/data.json`, `plugins/*/cache`, `plugins/*/main.js`, `plugins/*/styles.css`, `plugins/*/manifest.json` — each plugin's local state & code
- Extensions `tmp` / `lock`

**Synced**: `app.json`, `appearance.json`, `core-plugins.json`, `community-plugins.json`, `themes/`, and any config/data files you add under `plugins/*/`.

**A ticked plugin**: its whole folder is excluded, including its `data.json`, `main.js`, and state files.

### Conflict Handling

- **merge** (default): download remote → diff3 three-way merge → write merged result locally and upload. Conflict regions are marked with `<<<<<<< LOCAL / ======= / >>>>>>> REMOTE`, and the remote version is saved as `<file>.conflict-<ts>`.
- **keep-both**: local stays as-is; remote copy saved as `<file>.conflict-<ts>`.
- **local-win** / **remote-win**: overwrite directly.

### Isolation from Content Sync

```
Content sync (nextcloud-sync-yanc)  →  remote <vault>/         handles notes only
Config sync (this plugin)           →  remote <vault>-config/  handles .obsidian/ only
```

**Important**: if your content sync plugin is also running, add `.obsidian` to its **Excluded folders** so the content line never touches the config directory.

### Testing

```bash
pnpm test:filter     # verifies the sync-scope / exclusion rules (22 cases)
```

### Directory Layout

```
src/
├── main.ts                  # entry: events, commands, status bar, timer, connectivity preflight
├── settings.ts              # settings tab: connection + plugin checkbox list + conflict + actions
├── types.ts                 # minimal type layer (plain WebDAV)
├── sync/
│   ├── engine.ts            # diff + upload/download/delete + conflict (adapter.list over .obsidian)
│   └── filter.ts            # per-plugin exclusion + built-in safety rules
├── util/
│   ├── excludedExtensions.ts# extension exclusion (reused from nextcloud-sync-yanc, MIT)
│   └── retry.ts             # network retry (reused from nextcloud-sync-yanc, MIT)
└── webdav/
    ├── StandardWebDAVClient.ts  # WebDAV client (forked from nextcloud-sync-yanc, MIT)
    ├── IWebDAVClient.ts         # trimmed interface
    ├── ConnectionTester.ts      # two-stage connectivity test (forked, MIT)
    ├── RemoteDirCache.ts        # created-directory cache
    ├── remotePath.ts            # URL encoding / ancestor creation
    ├── requestWithTimeout.ts    # timeout wrapper
    ├── errorMessages.ts         # friendly error text
    ├── noCacheHeaders.ts
    └── dav/propfind.ts          # PROPFIND XML parsing
```

The WebDAV client layer is forked from [nextcloud-sync-yanc](https://github.com/yanqingwang/obsidian-nextcloud-sync-yanc) (MIT), with Nextcloud-only features (version history, file locking, chunked upload, sync tokens) removed to keep pure standard WebDAV.

### Credits

WebDAV client, connection tester, and exclusion utilities forked from [obsidian-nextcloud-sync-yanc](https://github.com/yanqingwang/obsidian-nextcloud-sync-yanc) by Daisuke ITO / yanqingwang (MIT).

### License

MIT