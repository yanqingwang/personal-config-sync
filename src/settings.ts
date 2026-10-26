// Plugin settings: defaults + the declarative Obsidian Settings tab.
//
// Deliberately minimal. The only sync-scope choice the user makes is PER PLUGIN: a checkbox list of
// every installed plugin, tick = that plugin's whole folder is excluded from sync. Everything else
// syncs by default (with a hidden built-in safety list that keeps device-local files out).
//
// The tab is fully declarative (getSettingDefinitions + render callbacks), which is what Obsidian
// 1.13+ expects: `display()` is deprecated, and re-calling it does not refresh declarative settings.
// The plugin checkbox list uses a `render` callback because it has no declarative control equivalent.

import { App, PluginSettingTab, Setting, Notice, type SettingDefinitionItem } from 'obsidian';
import { defaultRemoteRoot, DEFAULT_SETTINGS, type ConfigSyncSettings } from './settings-defaults';
import type ObsidianConfigSyncPlugin from './main';

/** Jianguoyun's WebDAV endpoint; the default because it is the most common plain-WebDAV target. */
export const JIANGUOYUN_DEFAULT_URL = 'https://dav.jianguoyun.com/dav/';

export class ConfigSyncSettingTab extends PluginSettingTab {
  plugin: ObsidianConfigSyncPlugin;

  constructor(app: App, plugin: ObsidianConfigSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;

    return [
      {
        type: 'group',
        heading: 'WebDAV 连接',
        items: [
          {
            name: '服务器地址',
            desc: '默认 https://dav.jianguoyun.com/dav/，Nextcloud 填 /remote.php/dav/files/<user>/',
            aliases: ['server', 'url', 'webdav'],
            control: { type: 'text', key: 'serverUrl', placeholder: JIANGUOYUN_DEFAULT_URL, defaultValue: s.serverUrl },
          },
          {
            name: '用户名',
            desc: '坚果云账号（邮箱）或 Nextcloud 用户名',
            aliases: ['user', 'login', 'account'],
            control: { type: 'text', key: 'username' },
          },
          {
            name: '密码',
            desc: '应用密码。只保存在本机 vault 的 data.json，不会被同步到远端。',
            aliases: ['app password', 'credential', 'secret'],
            control: { type: 'secret', key: 'password' },
          },
          {
            name: '远端配置目录',
            desc: '远端存放配置的文件夹，默认 <vault>-config。独立于笔记内容目录。',
            aliases: ['remote', 'folder', 'directory', 'path'],
            control: { type: 'text', key: 'remoteConfigRoot', placeholder: defaultRemoteRoot(this.app.vault.getName()) },
          },
          {
            name: '自动同步间隔（分钟）',
            desc: '0 = 仅手动 / 事件触发；大于 0 则每 N 分钟自动同步一次。',
            aliases: ['interval', 'schedule', 'timer', 'auto'],
            control: { type: 'number', key: 'autoSyncIntervalMinutes', defaultValue: 0 },
          },
          {
            name: '网络超时（秒）',
            desc: '单请求超时。',
            aliases: ['timeout', 'network'],
            control: { type: 'number', key: 'networkTimeoutSeconds', defaultValue: 30 },
          },
        ],
      },

      {
        type: 'group',
        heading: '同步范围（按插件）',
        cls: 'personal-config-sync--plugins-group',
        items: [
          {
            name: '排除的插件',
            desc: '默认所有插件都同步。勾选某个插件 = 整个插件文件夹都不同步（包括它的 data.json、main.js、状态文件）。内置安全规则会自动排除设备本地文件（workspace.json、backlink.json 等），无需手动配置。',
            aliases: ['exclude', 'plugin', 'scope', 'filter'],
            searchable: false,
            render: (setting) => this.renderPluginList(setting),
          },
        ],
      },

      {
        type: 'group',
        heading: '冲突处理',
        items: [
          {
            name: '冲突策略',
            desc: '三方合并：文本用 diff3 智能合并；保留双方：生成 xxx (conflict) 副本；本地/远端优先：直接覆盖。',
            aliases: ['conflict', 'merge', 'strategy'],
            control: {
              type: 'dropdown',
              key: 'conflictStrategy',
              defaultValue: 'merge',
              options: {
                merge: '三方合并（推荐）',
                'keep-both': '保留双方副本',
                'local-win': '本地优先',
                'remote-win': '远端优先',
              },
            },
          },
        ],
      },

      {
        type: 'group',
        heading: '操作',
        items: [
          {
            name: '立即同步',
            desc: `上次同步：${s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : '从未'}。状态：${s.lastSyncStatus || '—'}`,
            aliases: ['sync', 'run', 'now'],
            render: (setting) => this.renderSyncButton(setting),
          },
          {
            name: '测试连接',
            desc: '先测服务器连通性 + WebDAV 端点认证，再同步。失败会给出具体原因（网络 / 认证 / URL 错误）。',
            aliases: ['test', 'connection', 'ping'],
            render: (setting) => this.renderTestButton(setting),
          },
          {
            name: '重置为默认',
            desc: '恢复连接与范围设置到默认值（保留远端目录）。',
            aliases: ['reset', 'default', 'restore'],
            render: (setting) => this.renderResetButton(setting),
          },
        ],
      },
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
    // Interval changes must re-arm the timer.
    if (key === 'autoSyncIntervalMinutes') this.plugin.updateAutoTimer();
  }

  /** The per-plugin checkbox list — no declarative equivalent, so it is rendered imperatively. */
  private renderPluginList(setting: Setting): void {
    const container = setting.controlEl.createDiv({ cls: 'personal-config-sync--plugin-list' });

    const renderList = async (): Promise<void> => {
      container.empty();
      let pluginIds: string[] = [];
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
          void this.plugin.saveSettings().catch(() => undefined);
        });
      }
    };

    void renderList().catch(() => undefined);
  }

  private renderSyncButton(setting: Setting): void {
    setting.addButton((b) =>
      b.setButtonText('同步').setCta().onClick(() => {
        void (async () => {
          try {
            const result = await this.plugin.syncNow();
            new Notice(`配置同步完成：上传 ${result.uploaded}，下载 ${result.downloaded}，删除 ${result.deleted}，冲突 ${result.conflicts}`);
            this.update();
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            new Notice(`配置同步失败：${message}`, 8000);
            this.plugin.settings.lastSyncStatus = message;
            await this.plugin.saveSettings();
            this.update();
          }
        })();
      }),
    );
  }

  private renderTestButton(setting: Setting): void {
    setting.addButton((b) =>
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
  }

  private renderResetButton(setting: Setting): void {
    setting.addButton((b) =>
      b.setButtonText('重置').setDestructive().onClick(() => {
        void (async () => {
          this.plugin.settings = { ...DEFAULT_SETTINGS, remoteConfigRoot: defaultRemoteRoot(this.app.vault.getName()) };
          await this.plugin.saveSettings();
          this.update();
        })();
      }),
    );
  }
}