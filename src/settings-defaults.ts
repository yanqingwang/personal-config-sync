// Settings shape + defaults, kept in a leaf module so both main.ts and settings.ts can import it
// without a cycle (settings.ts imports main.ts for the plugin type).

export type SyncMode = 'all' | 'whitelist' | 'exclude';

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

/** Jianguoyun's WebDAV endpoint; the default because it is the most common plain-WebDAV target. */
export const JIANGUOYUN_DEFAULT_URL = 'https://dav.jianguoyun.com/dav/';

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