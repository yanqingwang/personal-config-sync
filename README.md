# Plugin Sync (obsidian-config-sync)

Obsidian 插件：**只同步 Obsidian 配置（`.obsidian/`）** 的 WebDAV 同步插件。

> 插件名 **Plugin Sync**，id `obsidian-config-sync`。

与笔记内容同步（如 [nextcloud-sync-yanc](https://github.com/yanqingwang/obsidian-nextcloud-sync-yanc)）完全独立：
两个插件各自在远端占一个目录，互不越界 —— 内容线只管笔记，本插件只管配置。

- 默认预填**坚果云 (jianguoyun)** 的 WebDAV 地址，你只需填账号 + 应用密码。
- 默认**全部配置同步**，但内置排除规则自动跳过设备本地文件。
- 可按文件夹 / 文件 / 扩展名粒度配置排除，也可切到「白名单」只同步选中的文件夹。
- 文本配置（json/md/css）冲突走 diff3 三方合并；非文本冲突保留双方副本。
- **同步前自动做网络连通性测试**，失败即给出具体原因（网络 / 认证 / URL 错误），不盲目开同步。

## 安装（开发）

```bash
pnpm install
pnpm build          # 生成 main.js（esbuild 内联 node-diff3，无运行时依赖）
```

把 `main.js`、`manifest.json`、`styles.css` 三个文件放进：
`<你的Vault>/.obsidian/plugins/obsidian-config-sync/`

然后在 Obsidian「设置 → 第三方插件 → obsidian-config-sync」启用。

## 配置

进入插件设置页：

| 字段 | 说明 |
|---|---|
| **服务器地址** | 默认 `https://dav.jianguoyun.com/dav/`，其他 WebDAV 服务商自行填 |
| **用户名** | 坚果云账号（邮箱） |
| **密码** | **应用密码**（坚果云网页 → 账户信息 → 安全选项 → 添加应用密码），不是登录密码 |
| **远端配置目录** | 默认 `<vault>-config`，独立于笔记内容目录 |
| **自动同步间隔** | 0 = 仅手动/事件触发 |
| **同步范围模式** | 全部（默认） / 白名单 / 反向 |
| **排除的插件** | checkbox 列表勾选，勾选后整个插件文件夹都不同步 |
| **排除文件夹** | 每行一个 |
| **排除文件** | 每行一个，支持 `*` 通配 |
| **排除文件类型** | 逗号分隔 |
| **冲突策略** | 三方合并（默认） / 保留双方 / 本地优先 / 远端优先 |
| **测试连接** | 按钮，先测连通性再决定是否同步 |

密码只保存在本机 vault 的 `data.json`，**不会**被同步到远端（本插件的默认排除规则覆盖自身状态文件）。

## 同步边界（安全设计）

默认**永远不同步**（设备本地状态，同步会弄坏别的设备）：

- `workspace.json`、`backlink.json`、`graph.json` —— 窗口布局 / 图缓存
- `plugins/*/data.json`、`plugins/*/cache`、`plugins/*/main.js`、`plugins/*/styles.css`、`plugins/*/manifest.json` —— 各插件本机状态与代码

会**同步**：`app.json`、`appearance.json`、`core-plugins.json`、`community-plugins.json`、`themes/`、`plugins/*/` 下你新增的配置/数据文件。

**重要**：如果你的内容同步插件（nextcloud-sync-yanc）也在跑，请在它的设置 → 「排除文件夹」里加入 `.obsidian`，让内容线完全避开配置目录。

## 冲突处理

- `merge`（默认）：下载远端 → diff3 三方合并 → 本地写入合并结果并上传。冲突区域插入 `<<<<<<< LOCAL / ======= / >>>>>>> REMOTE` 标记，同时把远端版本另存为 `<file>.conflict-<ts>`。
- `keep-both`：本地保持原样，远端副本存为 `<file>.conflict-<ts>`。
- `local-win` / `remote-win`：直接覆盖。

## 测试

```bash
pnpm test:filter     # 验证同步范围/排除规则逻辑
```

## 目录结构

```
src/
├── main.ts                  # 插件入口：事件、命令、状态栏、定时器
├── settings.ts              # 设置面板 + 坚果云默认值 + 文件夹选择
├── types.ts                 # 最小类型层（纯 WebDAV）
├── sync/
│   ├── engine.ts            # diff + 上传/下载/删除 + 冲突处理
│   └── filter.ts            # 范围/排除规则引擎
├── util/
│   ├── excludedFolders.ts   # 文件夹排除（复用 nextcloud-sync-yanc, MIT）
│   ├── excludedExtensions.ts# 扩展名排除（复用 nextcloud-sync-yanc, MIT）
│   └── retry.ts             # 网络重试（复用 nextcloud-sync-yanc, MIT）
└── webdav/
    ├── StandardWebDAVClient.ts  # WebDAV 客户端（fork 自 nextcloud-sync-yanc, MIT）
    ├── IWebDAVClient.ts         # 精简接口
    ├── RemoteDirCache.ts        # 已建目录缓存
    ├── remotePath.ts            # URL 编码 / 祖先目录创建
    ├── requestWithTimeout.ts    # 超时请求
    ├── errorMessages.ts         # 友好错误提示
    ├── noCacheHeaders.ts
    └── dav/propfind.ts          # PROPFIND XML 解析
```

WebDAV 客户端层 fork 自 [nextcloud-sync-yanc](https://github.com/yanqingwang/obsidian-nextcloud-sync-yanc)（MIT），已去掉 Nextcloud 专属的版本历史、文件锁、分块上传、sync token，保留纯标准 WebDAV 能力。

## License

MIT