// Plugin settings: defaults + the Obsidian Settings tab.
//
// Deliberately minimal. The only sync-scope choice the user makes is PER PLUGIN: a checkbox list of
// every installed plugin, tick = that plugin's whole folder is excluded from sync. Everything else
// syncs by default (with a hidden built-in safety list that keeps device-local files out).
//
// The server URL ships pre-filled with a sane WebDAV default so users only supply credentials.

import { App, PluginSettingTab, Setting, Notice, type SettingDefinitionItem } from 'obsidian';
import type ObsidianConfigSyncPlugin from './main';

/** Jianguoyun's WebDAV endpoint (a common plain-WebDAV target; Nextcloud URLs also work as-is). */
export const JIANGUOYUN_DEFAULT_URL = 'https://dav.jianguoyun.com/dav/';

export interface ConfigSyncSettings {
  // ── WebDAV connection ──
  serverUrl: string;
  username: string;
  password: string;
  /** Base remote folder for config sync, Vault-name-derived by default. */
  remoteConfigRoot: string;
  /** Request timeout in seconds; 0 = unbounded. */
  networkTimeoutSeconds: number;
  /** Interval in minutes between periodic syncs; 0 = manual only. */
  autoSyncIntervalMinutes: number;

  // ── Sync scope (per-plugin only) ──
  /** Plugin ids whose whole folder must NOT sync. Tick a plugin in the list = exclude it. */
  excludePlugins: string[];

  // ── Conflict handling ──
  /** 'merge' = diff3 three-way merge for text; 'keep-both' = save local + remote copies. */
  conflictStrategy: 'merge' | 'keep-both' | 'local-win' | 'remote-win';

  // ── Runtime state (not user-edited) ──
  lastSyncAt: number;
  lastSyncStatus: string;
}

export const DEFAULT_SETTINGS: ConfigSyncSettings = {
  serverUrl: JIANGUOYUN_DEFAULT_URL,
  username: '',
  password: '',
  remoteConfigRoot: '',
  networkTimeoutSeconds: 30,
  autoSyncIntervalMinutes: 0,

  excludePlugins: [],

  conflictStrategy: 'merge',

  lastSyncAt: 0,
  lastSyncStatus: '',
};

/** Suggest a remote root folder name from the Vault name: "<vault>-config". */
export function defaultRemoteRoot(vaultName: string): string {
  const safe = vaultName.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'vault';
  return `${safe}-config`;
}

export class ConfigSyncSettingTab extends PluginSettingTab {
  plugin: ObsidianConfigSyncPlugin;

  constructor(app: App, plugin: ObsidianConfigSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Use the Setting heading API instead of raw <h2>/<h3> elements (Obsidian review requirement).
    new Setting(containerEl).setName('Config Sync').setHeading();

    void this.renderConnection(containerEl);
    void this.renderPlugins(containerEl);
    this.renderConflict(containerEl);
    this.renderActions(containerEl);
  }

  /**
   * Declarative settings surface (Obsidian 1.13+). Without this, the tab's settings never appear in
   * Obsidian's settings search. The rendered tab above stays the source of truth for the interactive
   * controls (including the per-plugin checkbox list, which has no declarative equivalent).
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { type: 'group', name: 'WebDAV connection', items: [
        { name: 'Server address', desc: 'WebDAV endpoint. Default is Jianguoyun (https://dav.jianguoyun.com/dav/). For Nextcloud use https://<host>/remote.php/dav/files/<user>/', aliases: ['url', 'webdav', 'server'], control: { type: 'text', key: 'serverUrl', placeholder: 'https://dav.jianguoyun.com/dav/' } },
        { name: 'Username', desc: 'Jianguoyun account (email) or Nextcloud username.', aliases: ['user', 'login'], control: { type: 'text', key: 'username' } },
        { name: 'Password', desc: 'App password. Stored locally in data.json and never synced to the remote.', aliases: ['app password', 'credential'], control: { type: 'secret', key: 'password' } },
        { name: 'Remote config folder', desc: 'Folder on the server that holds the configuration. Defaults to <vault>-config.', aliases: ['remote', 'directory', 'path'], control: { type: 'text', key: 'remoteConfigRoot' } },
        { name: 'Auto-sync interval (minutes)', desc: '0 = manual / event-triggered only.', aliases: ['interval', 'schedule', 'timer'], control: { type: 'number', key: 'autoSyncIntervalMinutes', defaultValue: 0 } },
        { name: 'Network timeout (seconds)', desc: 'Per-request timeout. 0 = unbounded.', aliases: ['timeout'], control: { type: 'number', key: 'networkTimeoutSeconds', defaultValue: 30 } },
      ] },
      { type: 'group', name: 'Sync scope', items: [
        { name: 'Conflict strategy', desc: 'Three-way merge for text; keep-both saves both copies; local/remote-win overwrite.', aliases: ['merge', 'conflict'], control: { type: 'dropdown', key: 'conflictStrategy', options: {
          merge: 'Three-way merge (recommended)',
          'keep-both': 'Keep both copies',
          'local-win': 'Local wins',
          'remote-win': 'Remote wins',
        } } },
      ] },
    ];
  }

  /** Read a declarative control's value from this plugin's settings. */
  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  /** Persist a declarative control's value into this plugin's settings. */
  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
  }

  private renderConnection(el: HTMLElement): void {
    new Setting(el).setName('WebDAV 连接').setHeading();
    el.createEl('p', {
      cls: 'setting-item-description',
      text: '支持坚果云、Nextcloud 及任何标准 WebDAV 服务器。坚果云用户请填「应用密码」（坚果云网页 → 账户信息 → 安全选项 → 添加应用密码），不是登录密码。',
    });

    new Setting(el)
      .setName('服务器地址')
      .setDesc('默认 https://dav.jianguoyun.com/dav/，Nextcloud 填 /remote.php/dav/files/<user>/')
      .addText((t) => {
        t.inputEl.addClass('personal-config-sync--wide');
        t.setPlaceholder('https://dav.jianguoyun.com/dav/')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (v) => {
            this.plugin.settings.serverUrl = v.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(el)
      .setName('用户名')
      .setDesc('坚果云账号（邮箱）或 Nextcloud 用户名')
      .addText((t) =>
        t.setPlaceholder('you@example.com')
          .setValue(this.plugin.settings.username)
          .onChange(async (v) => {
            this.plugin.settings.username = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(el)
      .setName('密码')
      .setDesc('应用密码。只保存在本机 vault 的 data.json，不会被同步到远端。')
      .addText((t) => {
        t.inputEl.type = 'password';
        t.setPlaceholder('应用密码')
          .setValue(this.plugin.settings.password)
          .onChange(async (v) => {
            this.plugin.settings.password = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(el)
      .setName('远端配置目录')
      .setDesc('远端存放配置的文件夹，默认 <vault>-config。独立于笔记内容目录。')
      .addText((t) =>
        t.setPlaceholder(this.plugin.settings.remoteConfigRoot || defaultRemoteRoot(this.app.vault.getName()))
          .setValue(this.plugin.settings.remoteConfigRoot)
          .onChange(async (v) => {
            this.plugin.settings.remoteConfigRoot = v.trim().replace(/^\/+|\/+$/g, '');
            await this.plugin.saveSettings();
          }),
      );

    new Setting(el)
      .setName('自动同步间隔（分钟）')
      .setDesc('0 = 仅手动 / 事件触发；大于 0 则每 N 分钟自动同步一次。')
      .addText((t) => {
        t.inputEl.type = 'number';
        t.setValue(String(this.plugin.settings.autoSyncIntervalMinutes));
        t.onChange(async (v) => {
          const n = parseInt(v, 10);
          this.plugin.settings.autoSyncIntervalMinutes = Number.isFinite(n) && n >= 0 ? n : 0;
          await this.plugin.saveSettings();
          this.plugin.updateAutoTimer();
        });
      });

    new Setting(el)
      .setName('网络超时（秒）')
      .setDesc('单请求超时，0 = 不设超时。')
      .addText((t) => {
        t.inputEl.type = 'number';
        t.setValue(String(this.plugin.settings.networkTimeoutSeconds));
        t.onChange(async (v) => {
          const n = parseInt(v, 10);
          this.plugin.settings.networkTimeoutSeconds = Number.isFinite(n) && n > 0 ? n : 30;
          await this.plugin.saveSettings();
        });
      });
  }

  /**
   * The ONLY sync-scope control: a checkbox list of every installed plugin.
   * Tick = exclude that plugin's whole folder from sync. Unticked (default) = it syncs.
   */
  private async renderPlugins(el: HTMLElement): Promise<void> {
    new Setting(el).setName('同步范围（按插件）').setHeading();
    el.createEl('p', {
      cls: 'setting-item-description',
      text: '默认所有插件都同步。**勾选某个插件 = 整个插件文件夹都不同步**（包括它的 data.json、main.js、状态文件）。\n'
        + '内置安全规则会自动排除设备本地文件（workspace.json、backlink.json 等），无需手动配置。',
    });

    const container = el.createEl('div', { cls: 'personal-config-sync--plugin-list' });
    await this.renderPluginCheckboxes(container);
  }

  private async renderPluginCheckboxes(container: HTMLElement): Promise<void> {
    container.empty();
    let pluginIds: string[] = [];
    // Vault#configDir is configurable by the user — never hardcode '.obsidian'.
    const pluginsDir = `${this.app.vault.configDir}/plugins`;
    try {
      const listing = await this.app.vault.adapter.list(pluginsDir);
      pluginIds = listing.folders
        .map((p) => p.split('/').pop() ?? '')
        .filter((n) => n.length > 0 && n !== 'personal-config-sync')
        .sort();
    } catch {
      pluginIds = [];
    }
    if (pluginIds.length === 0) {
      container.createEl('p', { cls: 'setting-item-description', text: '未发现已安装插件。' });
      return;
    }
    const current = new Set(this.plugin.settings.excludePlugins ?? []);
    for (const id of pluginIds) {
      const row = container.createDiv({ cls: 'personal-config-sync--plugin-row' });
      const label = row.createEl('label', { cls: 'personal-config-sync--plugin-label' });
      const cb = label.createEl('input', { type: 'checkbox' });
      cb.checked = current.has(id);
      label.createSpan({ text: id });
      if (current.has(id)) row.addClass('is-excluded');
      cb.addEventListener('change', () => {
        const set = new Set(this.plugin.settings.excludePlugins ?? []);
        if (cb.checked) set.add(id); else set.delete(id);
        this.plugin.settings.excludePlugins = [...set];
        row.toggleClass('is-excluded', cb.checked);
        // Explicitly void + catch: the listener returns void, so a floating promise is a review warning.
        void this.plugin.saveSettings().catch(() => undefined);
      });
    }
  }

  private renderConflict(el: HTMLElement): void {
    new Setting(el).setName('冲突处理').setHeading();

    new Setting(el)
      .setName('冲突策略')
      .setDesc('三方合并：文本用 diff3 智能合并；保留双方：生成 xxx (conflict) 副本；本地/远端优先：直接覆盖。')
      .addDropdown((d) => {
        const opts = [
          { v: 'merge', l: '三方合并（推荐）' },
          { v: 'keep-both', l: '保留双方副本' },
          { v: 'local-win', l: '本地优先' },
          { v: 'remote-win', l: '远端优先' },
        ];
        for (const o of opts) d.addOption(o.v, o.l);
        d.setValue(this.plugin.settings.conflictStrategy).onChange(async (v) => {
          this.plugin.settings.conflictStrategy = v as ConfigSyncSettings['conflictStrategy'];
          await this.plugin.saveSettings();
        });
      });
  }

  private renderActions(el: HTMLElement): void {
    new Setting(el).setName('操作').setHeading();

    new Setting(el)
      .setName('立即同步')
      .setDesc(`上次同步：${this.plugin.settings.lastSyncAt ? new Date(this.plugin.settings.lastSyncAt).toLocaleString() : '从未'}。状态：${this.plugin.settings.lastSyncStatus || '—'}`)
      .addButton((b) =>
        b.setButtonText('同步').setCta().onClick(() => {
          void (async () => {
            try {
              const result = await this.plugin.syncNow();
              new Notice(`配置同步完成：上传 ${result.uploaded}，下载 ${result.downloaded}，删除 ${result.deleted}，冲突 ${result.conflicts}`);
              this.refresh();
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              new Notice(`配置同步失败：${message}`, 8000);
              this.plugin.settings.lastSyncStatus = message;
              await this.plugin.saveSettings();
              this.refresh();
            }
          })();
        }),
      );

    new Setting(el)
      .setName('测试连接')
      .setDesc('先测服务器连通性 + WebDAV 端点认证，再同步。失败会给出具体原因（网络 / 认证 / URL 错误）。')
      .addButton((b) =>
        b.setButtonText('测试连接').setCta().onClick(() => {
          void (async () => {
            const r = await this.plugin.testConnection();
            if (r.allOk) {
              new Notice(`✅ 连接正常：${r.reachable.detail}；${r.webdav.detail}`);
            } else {
              new Notice(`❌ 连接异常：${r.reachable.detail}；${r.webdav.detail}`, 10000);
            }
          })();
        }),
      );

    new Setting(el)
      .setName('重置为默认')
      .addButton((b) =>
        b.setButtonText('重置').setDestructive().onClick(() => {
          void (async () => {
            this.plugin.settings = { ...DEFAULT_SETTINGS, remoteConfigRoot: defaultRemoteRoot(this.app.vault.getName()) };
            await this.plugin.saveSettings();
            this.refresh();
          })();
        }),
      );
  }

  /** Re-render the tab (internal replacement for the deprecated `display()` call sites). */
  private refresh(): void {
    this.display();
  }
}