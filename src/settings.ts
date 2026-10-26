// Plugin settings: defaults + the Obsidian Settings tab.
//
// The server URL is pre-filled with Jianguoyun (坚果云) WebDAV, which is the most common
// plain-WebDAV target for Chinese Obsidian users. The user only has to supply their
// credentials and pick a remote folder — everything else ships with sane defaults.

import { App, PluginSettingTab, Setting, TFile, TFolder, Modal, setIcon, Notice } from 'obsidian';
import type ObsidianConfigSyncPlugin from './main';
import type { SyncMode } from './sync/filter';

/** Jianguoyun's WebDAV endpoint. Users must create an App Password (应用密码) in their account. */
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

  // ── Sync scope ──
  syncMode: SyncMode;
  /** Whitelist folders (used in 'whitelist' and 'exclude' modes). */
  includeFolders: string[];
  /** Excluded folders (used in 'all' and 'whitelist' modes). */
  excludeFolders: string[];
  /** Excluded file patterns (supports a single `*` wildcard). */
  excludeFiles: string[];
  /** Excluded extensions. */
  excludeExtensions: string[];

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

  syncMode: 'all',
  includeFolders: [],
  excludeFolders: [],
  excludeFiles: [],
  excludeExtensions: [],

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
    containerEl.createEl('h2', { text: 'WebDAV 配置同步' });

    this.renderConnection(containerEl);
    this.renderScope(containerEl);
    this.renderConflict(containerEl);
    this.renderActions(containerEl);
  }

  private renderConnection(el: HTMLElement): void {
    el.createEl('h3', { text: 'WebDAV 连接（坚果云已预填）' });
    el.createEl('p', {
      cls: 'setting-item-description',
      text: '服务器地址已预填坚果云。用户名是你的坚果云邮箱；密码请使用「应用密码」（坚果云网页 → 账户信息 → 安全选项 → 添加应用密码），不是登录密码。其他 WebDAV 服务商自行填写地址即可。',
    });

    new Setting(el)
      .setName('服务器地址')
      .setDesc('默认 https://dav.jianguoyun.com/dav/')
      .addText((t) => {
        t.inputEl.addClass('obsidian-config-sync--wide');
        t.setPlaceholder('https://dav.jianguoyun.com/dav/')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (v) => {
            this.plugin.settings.serverUrl = v.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(el)
      .setName('用户名')
      .setDesc('坚果云账号（邮箱）')
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
      .setDesc('坚果云「应用密码」。密码只保存在本机 vault 的 data.json，不会被同步到远端。')
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
      .setDesc('远端存放配置的文件夹，默认 <vault>-config。会独立于笔记内容目录，互不干扰。')
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

  private renderScope(el: HTMLElement): void {
    el.createEl('h3', { text: '同步范围（默认全部同步）' });
    el.createEl('p', {
      cls: 'setting-item-description',
      text: '默认同步 `.obsidian/` 下所有配置。以下文件因是设备本地状态而**永远不同步**：workspace.json、backlink.json、graph.json、各插件的 data.json / main.js / cache。你可以再排除更多。',
    });

    new Setting(el)
      .setName('同步范围模式')
      .setDesc('全部：默认同步所有配置，只排除你列出的；白名单：只同步你选中的文件夹；反向排除：只同步被排除的那些。')
      .addDropdown((d) => {
        const modes: { value: SyncMode; label: string }[] = [
          { value: 'all', label: '全部（默认）' },
          { value: 'whitelist', label: '白名单（只同步选中）' },
          { value: 'exclude', label: '反向（只同步排除项）' },
        ];
        for (const m of modes) d.addOption(m.value, m.label);
        d.setValue(this.plugin.settings.syncMode).onChange(async (v) => {
          this.plugin.settings.syncMode = v as SyncMode;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(el).setName('排除的文件夹（每行一个）').addTextArea((t) => {
      t.setPlaceholder('如 .trash\nplugins/*/cache').setValue(this.plugin.settings.excludeFolders.join('\n'));
      t.onChange(async (v) => {
        this.plugin.settings.excludeFolders = v.split('\n').map((s) => s.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      });
    });

    new Setting(el).setName('排除的文件（每行一个，支持 * 通配）').addTextArea((t) => {
      t.setPlaceholder('如 plugins/dataview/data.json').setValue(this.plugin.settings.excludeFiles.join('\n'));
      t.onChange(async (v) => {
        this.plugin.settings.excludeFiles = v.split('\n').map((s) => s.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      });
    });

    new Setting(el)
      .setName('排除的文件类型（逗号分隔）')
      .addText((t) => {
        t.setPlaceholder('如 tmp, lock').setValue(this.plugin.settings.excludeExtensions.join(', '));
        t.onChange(async (v) => {
          this.plugin.settings.excludeExtensions = v
            .split(/[,;\s]+/)
            .map((s) => s.trim().replace(/^\./, '').toLowerCase())
            .filter(Boolean);
          await this.plugin.saveSettings();
        });
      });

    // Whitelist folder picker (only meaningful in 'whitelist' / 'exclude' modes).
    new Setting(el)
      .setName('白名单文件夹（同步范围内选中这些）')
      .setDesc('在 whitelist 模式下只有这些文件夹会被同步。')
      .addButton((b) => {
        b.setButtonText('添加文件夹').setCta().onClick(async () => {
          const picked = await pickFolder(this.app, this.app.vault.getRoot(), (p) => p);
          if (picked && !this.plugin.settings.includeFolders.includes(picked)) {
            this.plugin.settings.includeFolders.push(picked);
            await this.plugin.saveSettings();
            this.display();
          }
        });
      });
    const list = this.plugin.settings.includeFolders;
    if (list.length > 0) {
      const wrap = el.createEl('div', { cls: 'obsidian-config-sync--folder-list' });
      for (const f of list) {
        new Setting(wrap)
          .setName(f)
          .addButton((b) => b.setButtonText('移除').setWarning().onClick(async () => {
            this.plugin.settings.includeFolders = this.plugin.settings.includeFolders.filter((x) => x !== f);
            await this.plugin.saveSettings();
            this.display();
          }));
      }
    }
  }

  private renderConflict(el: HTMLElement): void {
    el.createEl('h3', { text: '冲突处理' });

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
    el.createEl('h3', { text: '操作' });

    new Setting(el)
      .setName('立即同步')
      .setDesc(`上次同步：${this.plugin.settings.lastSyncAt ? new Date(this.plugin.settings.lastSyncAt).toLocaleString() : '从未'}。状态：${this.plugin.settings.lastSyncStatus || '—'}`)
      .addButton((b) =>
        b.setButtonText('同步').setCta().onClick(async () => {
          try {
            const result = await this.plugin.syncNow();
            new Notice(`配置同步完成：上传 ${result.uploaded}，下载 ${result.downloaded}，删除 ${result.deleted}，冲突 ${result.conflicts}`);
            this.display();
          } catch (e) {
            new Notice(`配置同步失败：${(e as Error).message}`, 8000);
            this.plugin.settings.lastSyncStatus = (e as Error).message;
            await this.plugin.saveSettings();
            this.display();
          }
        }),
      );

    new Setting(el)
      .setName('重置为默认')
      .addButton((b) =>
        b.setButtonText('重置').setWarning().onClick(async () => {
          this.plugin.settings = { ...DEFAULT_SETTINGS, remoteConfigRoot: defaultRemoteRoot(this.app.vault.getName()) };
          await this.plugin.saveSettings();
          this.display();
        }),
      );
  }
}

// ── Folder picker (Obsidian Suggester-style modal, no extra deps) ──────────
function pickFolder(app: App, root: TFolder, onChange: (p: string) => string): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new FolderPickerModal(app, root, onChange, resolve);
    modal.open();
  });
}

class FolderPickerModal extends Modal {
  private query = '';
  private result: string | null = null;

  constructor(
    app: App,
    private root: TFolder,
    private _onChange: (p: string) => string,
    private done: (v: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: '选择要同步的文件夹' });
    const input = contentEl.createEl('input', { type: 'text', placeholder: '输入过滤…', cls: 'obsidian-config-sync--wide' });
    const list = contentEl.createEl('div', { cls: 'obsidian-config-sync--folder-list' });

    const render = () => {
      list.empty();
      const q = this.query.toLowerCase();
      const walk = (folder: TFolder, prefix: string) => {
        for (const child of folder.children) {
          if (!(child instanceof TFolder)) continue;
          const path = prefix + child.name;
          if (q.length === 0 || path.toLowerCase().includes(q)) {
            const row = list.createEl('div', { cls: 'obsidian-config-sync--folder-row' });
            row.createSpan({ text: path });
            row.createEl('button', { text: '选择', cls: 'mod-cta' }).onclick = () => {
              this.result = path;
              this.close();
            };
          }
          walk(child, path + '/');
        }
      };
      walk(this.root, '');
    };

    input.oninput = () => {
      this.query = input.value;
      render();
    };
    render();
  }

  onClose(): void {
    this.done(this.result);
  }
}