// Minimal type layer for the config-sync plugin.
// Ported from obsidian-nextcloud-sync-yanc (MIT), trimmed to plain-WebDAV essentials:
// no file locking, no version history, no sync tokens, no Nextcloud checksums.

// ── Server capabilities detected at connect() ──────────────────────────────
export interface NextcloudFeatures {
  isNextcloud: boolean;
  version: string;
  hasChecksums: boolean;
  hasFilesLocking: boolean;
  /** Server advertises (or feature-probed positive for) the bulk-upload endpoint. */
  hasBulkUpload: boolean;
  syncToken: string | null;
}

// ── Remote entities ─────────────────────────────────────────────────────────
export interface RemoteFileInfo {
  path: string;
  fileId: string | null;
  checksum: string | null;
  etag: string | null;
  size: number;
  lastModified: number;
}

export interface RemoteDirInfo {
  path: string;
  fileId: string | null;
  etag: string | null;
  lastModified: number;
}

export interface SyncChanges {
  modified: RemoteFileInfo[];
  deleted: string[];
  newSyncToken: string;
}

export interface FileVersion {
  path: string;
  fileId: string | null;
  version: string;
  size: number;
  lastModified: number;
  displayName: string;
}

// ── Settings ────────────────────────────────────────────────────────────────
/** The WebDAV connection settings used by the ported StandardWebDAVClient. */
export interface DavSyncSettings {
  serverUrl: string;
  username: string;
  /** seconds; 0 = unbounded */
  networkTimeoutSeconds?: number;
}

// ── Errors ──────────────────────────────────────────────────────────────────
export class SyncTokenExpiredError extends Error {
  constructor() {
    super('sync-token expired (HTTP 410)');
    this.name = 'SyncTokenExpiredError';
  }
}
export class ConflictError extends Error {
  constructor(public readonly path: string) {
    super(`Conflict at ${path}`);
    this.name = 'ConflictError';
  }
}
export class NetworkError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly method?: string,
  ) {
    super(method ? `HTTP ${status} (${method})` : `HTTP ${status}`);
    this.name = 'NetworkError';
  }
}
export class RemoteRootMissingError extends NetworkError {
  constructor() {
    super(404, '', 'PROPFIND');
    this.name = 'RemoteRootMissingError';
  }
}
export class RemoteListingUnreadableError extends NetworkError {
  readonly op: string;
  readonly path: string;
  readonly bodyLength: number;
  readonly reason: string;
  readonly fragment: string;
  constructor(
    ctx: { op: string; path: string; status: number; method: 'PROPFIND' | 'REPORT' },
    xml: string,
    reason: string,
  ) {
    super(ctx.status, '', ctx.method);
    this.name = 'RemoteListingUnreadableError';
    this.op = ctx.op;
    this.path = ctx.path;
    this.reason = reason;
    this.bodyLength = new TextEncoder().encode(xml).length;
    this.fragment = xml.slice(0, 256).replace(/\s+/g, ' ').trim();
    this.message =
      `Remote listing unreadable: ${ctx.method} ${ctx.op} '${ctx.path}' → HTTP ${ctx.status}, ` +
      `${this.bodyLength} bytes, ${reason}; body starts: ${this.fragment}`;
  }
}
export class RemoteDirCreateError extends NetworkError {
  readonly dirPath: string;
  constructor(dirPath: string, status: number, detail?: string) {
    super(status, '', 'MKCOL');
    this.name = 'RemoteDirCreateError';
    this.dirPath = dirPath;
    this.message =
      `Could not create the remote folder '${dirPath}': MKCOL ${status === 0 ? 'failed' : `→ HTTP ${status}`}` +
      (detail ? ` (${detail})` : '');
  }
}
export class ServerLockedError extends NetworkError {
  constructor(
    public readonly path: string,
    method: 'PUT' | 'DELETE',
    public readonly lockOwner: string | null,
  ) {
    super(423, '', method);
    this.name = 'ServerLockedError';
    this.message = this.lockOwner
      ? `HTTP 423 (${method}) — locked on the server by "${this.lockOwner}"`
      : `HTTP 423 (${method}) — locked on the server (owner unknown)`;
  }
}
export class MaintenanceModeError extends Error {
  constructor() {
    super('server is in maintenance mode');
    this.name = 'MaintenanceModeError';
  }
}
export class CredentialsNotFoundError extends Error {
  constructor() {
    super('credentials not found');
    this.name = 'CredentialsNotFoundError';
  }
}
export class FeatureUnsupportedError extends Error {
  constructor(feature?: string) {
    super(feature ? `feature not supported by this server: ${feature}` : 'feature not supported by this server');
    this.name = 'FeatureUnsupportedError';
  }
}
export class FileLockedError extends Error {
  constructor() {
    super('file is locked by this plugin');
    this.name = 'FileLockedError';
  }
}
export class PreconditionFailedError extends Error {
  constructor(public readonly path?: string) {
    super(path ? `HTTP 412 Precondition Failed at ${path}` : 'HTTP 412 Precondition Failed');
    this.name = 'PreconditionFailedError';
  }
}

export type VaultRootOutcome = 'created' | 'exists';