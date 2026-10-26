// The WebDAV surface the config-sync plugin uses.
// Trimmed from obsidian-nextcloud-sync-yanc's IWebDAVClient (MIT): the config-sync
// engine only needs listing / stat / read / write / delete / mkcol — no version
// history, no file locking, no chunked upload, no sync tokens.

import { NextcloudFeatures, RemoteFileInfo, RemoteDirInfo, FileVersion, VaultRootOutcome } from '../types';

export interface IWebDAVClient {
  /** Verify connectivity and detect server capabilities. */
  connect(): Promise<NextcloudFeatures>;

  /**
   * The COMPLETE listing beneath `path` (the sync root when `path` is '').
   * - 207 with no children → [] (folder exists and is empty)
   * - 404 on the ROOT ('') → throws RemoteRootMissingError
   * - 404 on a subpath     → []
   * - any other non-207    → throws NetworkError
   */
  getFiles(path: string): Promise<RemoteFileInfo[]>;

  /** Remote state of ONE file (PROPFIND Depth:0), or null when the path holds no file. */
  statFile(remotePath: string): Promise<RemoteFileInfo | null>;

  /** Root-ETag short-circuit; plain WebDAV returns null so the engine always full-scans. */
  getRootEtag(): Promise<string | null>;

  /** List the collections beneath `path`, recursive. */
  getDirectories(path: string): Promise<RemoteDirInfo[]>;

  /** True iff the collection at `path` has no children. */
  isRemoteDirEmpty(path: string): Promise<boolean>;

  /** Create a directory (collection) and any missing ancestors via MKCOL. */
  createDirectory(path: string): Promise<void>;

  /** Create the sync root and REPORT whether it had to be created. */
  createVaultRoot(): Promise<VaultRootOutcome>;

  /** DELETE a directory (collection). Callers MUST confirm emptiness first. */
  deleteCollection(path: string): Promise<void>;

  /** Download a remote file and RETURN its bytes. */
  downloadFile(remotePath: string): Promise<ArrayBuffer>;

  /**
   * Upload via single PUT.
   * @param mtime ms epoch — when provided, sent as X-OC-MTime so Nextcloud preserves the timestamp.
   */
  uploadFile(remotePath: string, data: ArrayBuffer, mtime?: number): Promise<void>;

  moveFile(oldPath: string, newPath: string): Promise<void>;

  deleteFile(path: string, expectedRemoteId: string): Promise<void>;

  /** Targeted existence check (PROPFIND Depth 0). Conservative: true unless a definitive 404. */
  remoteExists(remotePath: string): Promise<boolean>;

  // ── Version history (servers that don't support it throw FeatureUnsupportedError) ──
  listVersions(fileId: string): Promise<FileVersion[]>;
  getVersionContent(version: FileVersion, fileId: string): Promise<ArrayBuffer>;
  restoreVersion(version: FileVersion, fileId: string): Promise<void>;
}