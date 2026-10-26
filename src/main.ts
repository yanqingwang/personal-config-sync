// obsidian-config-sync — sync only the Obsidian configuration (.obsidian/) over WebDAV.
//
// Independent from the notes-content sync plugin (nextcloud-sync-yanc): the two plugins
// each own a remote folder and never touch each other's content.
//
// Portions of the WebDAV client are reused from obsidian-nextcloud-sync-yanc (MIT) —
// see src/webdav/StandardWebDAVClient.ts.

import { Plugin, Notice, TAbstractFile, TFolder, TFile, debounce } from 'obsidian';
import { ConfigSyncSettingTab, DEFAULT_SETTINGS, defaultRemoteRoot, type ConfigSyncSettings } from './settings';
import { StandardWebDAVClient } from './webdav/StandardWebDAVClient';
import { runSync, type SyncReport } from './sync/engine';
import { effectiveRules, type SyncMode } from './sync/filter';

export default class ObsidianConfigSyncPlugin extends Plugin {
  settings!: ConfigSyncSettings;
  private autoTimer: number | null = null;
  private syncInProgress = false;
  private lastReport: SyncReport | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new ConfigSyncSettingTab(this.app, this));

    // Ribbon icon to sync on demand.
    this.addRibbonIcon('refresh-cw', 'WebDAV 配置同步', () => {
      void this.syncNow().then((r) => {
        new Notice(`配置同步完成：↑${r.uploaded} ↓${r.downloaded} 🗑${r.deleted} ⚡${r.conflicts}`);
      }).catch((e) => new Notice(`配置同步失败：${(e as Error).message}`, 8000));
    });

    // Commands.
    this.addCommand({
      id: 'sync-config-now',
      name: '立即同步配置',
      callback: () => {
        void this.syncNow().then((r) => {
          new Notice(`配置同步完成：↑${r.uploaded} ↓${r.downloaded} 🗑${r.deleted} ⚡${r.conflicts}`);
        }).catch((e) => new Notice(`配置同步失败：${(e as Error).message}`, 8000));
      },
    });

    // Status bar.
    const statusEl = this.addStatusBarItem();
    statusEl.setText('Config Sync: —');
    statusEl.addEventListener('click', () => {
      void this.syncNow().catch(() => undefined);
    });

    // Auto-sync: periodic + on any change inside .obsidian (config edits, plugin installs).
    this.updateAutoTimer();
    const onConfigChanged = debounce(() => void this.syncNow().catch(() => undefined), 8000, true);
    const isConfigFile = (f: TAbstractFile) => f.path === '.obsidian' || f.path.startsWith('.obsidian/');
    this.registerEvent(this.app.vault.on('modify', (f) => { if (isConfigFile(f)) onConfigChanged(); }));
    this.registerEvent(this.app.vault.on('create', (f) => { if (isConfigFile(f)) onConfigChanged(); }));
    this.registerEvent(this.app.vault.on('delete', (f) => { if (isConfigFile(f)) onConfigChanged(); }));
    this.registerEvent(this.app.vault.on('rename', (f) => { if (isConfigFile(f)) onConfigChanged(); }));

    // First sync shortly after load.
    this.register(() => {
      if (this.autoTimer !== null) window.clearInterval(this.autoTimer);
    });
    window.setTimeout(() => void this.syncNow().catch(() => undefined), 30000);
  }

  onunload(): void {
    if (this.autoTimer !== null) window.clearInterval(this.autoTimer);
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    const defaults: ConfigSyncSettings = {
      ...DEFAULT_SETTINGS,
      remoteConfigRoot: defaultRemoteRoot(this.app.vault.getName()),
    };
    this.settings = { ...defaults, ...loaded };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Re-arm or cancel the periodic auto-sync timer. */
  updateAutoTimer(): void {
    if (this.autoTimer !== null) {
      window.clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
    const minutes = this.settings.autoSyncIntervalMinutes;
    if (minutes > 0) {
      this.autoTimer = window.setInterval(() => {
        void this.syncNow().catch(() => undefined);
      }, minutes * 60 * 1000);
    }
  }

  /** Build the StandardWebDAVClient with current credentials. */
  private buildClient(): StandardWebDAVClient {
    const s = this.settings;
    return new StandardWebDAVClient(
      { serverUrl: s.serverUrl, username: s.username, networkTimeoutSeconds: s.networkTimeoutSeconds },
      s.password,
      this.remoteRoot(),
    );
  }

  private remoteRoot(): string {
    const s = this.settings;
    const root = s.remoteConfigRoot || defaultRemoteRoot(this.app.vault.getName());
    return root.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Run a full config sync. Returns a report; throws on unrecoverable errors.
   * Never throws on NetworkError — that is captured in the report so the caller can decide.
   */
  async syncNow(): Promise<SyncReport> {
    if (this.syncInProgress) {
      return this.lastReport ?? { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, skipped: 0, error: 'sync already running', durationMs: 0 };
    }
    const s = this.settings;
    if (!s.serverUrl || !s.username || !s.password) {
      this.settings.lastSyncStatus = '请先在设置里填写坚果云账号与应用密码';
      await this.saveSettings();
      return { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, skipped: 0, error: this.settings.lastSyncStatus, durationMs: 0 };
    }

    this.syncInProgress = true;
    try {
      const client = this.buildClient();
      // Verify connectivity before scanning (fail fast with a readable error).
      await client.connect();

      const rules = effectiveRules({
        mode: this.settings.syncMode as SyncMode,
        includeFolders: this.settings.includeFolders,
        excludeFolders: this.settings.excludeFolders,
        excludeFiles: this.settings.excludeFiles,
        excludeExtensions: this.settings.excludeExtensions,
      });

      const report = await runSync({
        app: this.app,
        client,
        configRoot: '.obsidian',
        remoteRoot: this.remoteRoot(),
        rules,
        conflictStrategy: this.settings.conflictStrategy,
      });

      this.lastReport = report;
      this.settings.lastSyncAt = Date.now();
      this.settings.lastSyncStatus = report.error
        ? `失败：${report.error}`
        : `完成 ↑${report.uploaded} ↓${report.downloaded} 🗑${report.deleted} ⚡${report.conflicts} (${report.durationMs}ms)`;
      await this.saveSettings();
      return report;
    } finally {
      this.syncInProgress = false;
    }
  }
}

// Re-export types used by the settings tab's type imports.
export type { ConfigSyncSettings };
export { DEFAULT_SETTINGS };