// Config sync engine: local .obsidian/ ↔ remote WebDAV folder.
//
// Strategy (deliberately conservative — this is config, not notes):
//   1. Scan the local config root (.obsidian) for candidate files, filtered by the scope rules.
//   2. Full-scan the remote config root via recursive PROPFIND.
//   3. Diff the two trees:
//        - local-only   → upload
//        - remote-only  → download
//        - both sides   → compare size+mtime; if equal skip, else conflict resolution
//        - missing here → delete remote (only if it was previously tracked)
//   4. Text files (json/md/css) with a real conflict go through diff3 three-way merge.
//      Non-text files use the configured conflict strategy.
//
// The engine never touches the notes content folder; it is rooted strictly at
// {vault}/.obsidian → {remoteConfigRoot}.

import { App, Vault } from 'obsidian';
import { diff3Merge as nodeDiff3Merge } from 'node-diff3';
import type { IWebDAVClient } from '../webdav/IWebDAVClient';
import { NetworkError, RemoteRootMissingError } from '../types';
import { shouldSyncPath, effectiveRules } from './filter';

export interface SyncReport {
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  skipped: number;
  error: string | null;
  durationMs: number;
}

export interface EngineOptions {
  app: App;
  client: IWebDAVClient;
  /** vault-relative root to sync, e.g. '.obsidian'. */
  configRoot: string;
  /** remote root path relative to the WebDAV base, e.g. 'MyVault-config'. */
  remoteRoot: string;
  /** scope rules (already folded with defaults). */
  rules: ReturnType<typeof effectiveRules>;
  conflictStrategy: 'merge' | 'keep-both' | 'local-win' | 'remote-win';
}

/** Track files we created/synced so we can distinguish "we never touched it" from "deleted". */
const TRACKED_EXTRA = new Set<string>();

interface LocalEntry {
  path: string; // relative to configRoot
  abs: string;
  mtime: number;
  size: number;
}

interface RemoteEntry {
  path: string; // relative to remoteRoot
  mtime: number;
  size: number;
  etag: string | null;
}

function isTextFile(name: string): boolean {
  return /\.(json|md|css|js|html|txt|xml|yaml|yml|canvas)$/i.test(name);
}

async function readText(vault: Vault, abs: string): Promise<string> {
  const buf = await vault.adapter.readBinary(abs);
  return new TextDecoder().decode(buf);
}

async function writeText(vault: Vault, abs: string, content: string): Promise<void> {
  await vault.adapter.write(abs, content);
}

export async function runSync(opts: EngineOptions): Promise<SyncReport> {
  const start = Date.now();
  const vault = opts.app.vault;
  const report: SyncReport = {
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    conflicts: 0,
    skipped: 0,
    error: null,
    durationMs: 0,
  };

  const configRoot = opts.configRoot.replace(/^\/+|\/+$/g, ''); // '.obsidian'
  const remoteRoot = opts.remoteRoot.replace(/^\/+|\/+$/g, '');
  const prefix = configRoot + '/';

  // 1. Local scan.
  // CRITICAL: the config root (.obsidian) is NOT part of Obsidian's vault file tree —
  // vault.getAbstractFileByPath('.obsidian') returns null and would silently produce an empty
  // local listing (the exact reason a first sync uploaded nothing). The DataAdapter CAN read
  // it, so we walk it with adapter.list(), which returns vault-relative paths including .obsidian.
  const localEntries: LocalEntry[] = [];
  const localDirs = new Set<string>();

  const walkDir = async (dirPath: string) => {
    let listing;
    try {
      listing = await vault.adapter.list(dirPath);
    } catch {
      return; // folder does not exist locally — nothing to sync from here
    }
    for (const filePath of listing.files) {
      if (!filePath.startsWith(prefix)) continue;
      const relUnder = filePath.slice(prefix.length);
      if (!shouldSyncPath(relUnder, opts.rules)) continue;
      const stat = await vault.adapter.stat(filePath).catch(() => null);
      localEntries.push({
        path: relUnder,
        abs: filePath,
        mtime: stat?.mtime ?? Date.now(),
        size: stat?.size ?? 0,
      });
    }
    for (const folderPath of listing.folders) {
      if (!folderPath.startsWith(prefix)) continue;
      localDirs.add(folderPath.slice(prefix.length));
      await walkDir(folderPath);
    }
  };

  try {
    await vault.adapter.stat(configRoot);
    await walkDir(configRoot);
  } catch {
    // .obsidian does not exist — nothing to sync.
  }

  // 2. Remote full scan.
  let remoteFiles: RemoteEntry[] = [];
  let remoteDirs: string[] = [];
  try {
    const files = await opts.client.getFiles(remoteRoot);
    const dirs = await opts.client.getDirectories(remoteRoot);
    remoteFiles = files.map((f) => ({
      path: f.path.replace(remoteRoot + '/', '').replace(new RegExp('^' + remoteRoot + '(/|$)'), ''),
      mtime: f.lastModified,
      size: f.size,
      etag: f.etag,
    }));
    remoteDirs = dirs.map((d) => d.path.replace(remoteRoot + '/', ''));
  } catch (e) {
    if (e instanceof RemoteRootMissingError) {
      // The sync root does not exist yet — create it, then continue with an empty remote listing.
      await opts.client.createVaultRoot();
    } else {
      report.error = `远端扫描失败：${e instanceof Error ? e.message : String(e)}`;
      report.durationMs = Date.now() - start;
      return report;
    }
  }

  const remoteByPath = new Map<string, RemoteEntry>();
  for (const r of remoteFiles) remoteByPath.set(r.path, r);

  // 3. Diff & apply.
  const localByPath = new Map(localEntries.map((l) => [l.path, l]));
  const allPaths = new Set([...localByPath.keys(), ...remoteByPath.keys()]);

  const ensureRemoteDir = async (relPath: string) => {
    const segments = relPath.split('/').slice(0, -1);
    let cur = remoteRoot;
    for (const seg of segments) {
      cur = cur ? `${cur}/${seg}` : seg;
      if (!remoteDirs.includes(cur)) {
        await opts.client.createDirectory(cur);
        remoteDirs.push(cur);
      }
    }
  };

  for (const p of allPaths) {
    const local = localByPath.get(p);
    const remote = remoteByPath.get(p);
    const isText = isTextFile(p);

    try {
      if (local && !remote) {
        // Local-only → upload.
        const data = await vault.adapter.readBinary(local.abs);
        await ensureRemoteDir(remoteRoot ? `${remoteRoot}/${p}` : p);
        await opts.client.uploadFile(`${remoteRoot}/${p}`, data, local.mtime);
        TRACKED_EXTRA.add(`${remoteRoot}/${p}`);
        report.uploaded++;
      } else if (!local && remote) {
        // Remote-only → download (but never delete a file we never touched remotely).
        const data = await opts.client.downloadFile(`${remoteRoot}/${p}`);
        const abs = `${configRoot}/${p}`;
        await ensureLocalParent(vault, abs);
        await vault.adapter.writeBinary(abs, data);
        report.downloaded++;
      } else if (local && remote) {
        const same = local.size === remote.size && Math.abs(local.mtime - remote.mtime) < 2000;
        if (same) {
          report.skipped++;
          continue;
        }
        await resolveConflict(opts, p, local, remote, isText, report);
      }
    } catch (e) {
      if (e instanceof NetworkError) {
        report.error = `同步中断：${(e as Error).message}`;
        break;
      }
      throw e;
    }
  }

  // 4. Deletions: remote file no longer exists locally and we previously saw it.
  for (const r of remoteByPath.values()) {
    if (!localByPath.has(r.path) && TRACKED_EXTRA.has(`${remoteRoot}/${r.path}`)) {
      await opts.client.deleteFile(`${remoteRoot}/${r.path}`, '');
      report.deleted++;
    }
  }

  report.durationMs = Date.now() - start;
  return report;
}

async function ensureLocalParent(vault: Vault, abs: string): Promise<void> {
  // abs is like ".obsidian/themes/Wide View/theme.css" — ensure every ancestor folder exists.
  const slash = abs.lastIndexOf('/');
  if (slash < 0) return;
  const target = abs.slice(0, slash);
  // Walk from the config root downward, creating each missing ancestor. adapter.mkdir creates
  // exactly one level, so a missing grandparent would otherwise throw.
  const root = target.split('/')[0]; // e.g. '.obsidian'
  const segs = target.split('/');
  let cur = root;
  for (let i = 1; i < segs.length; i++) {
    cur = cur + '/' + segs[i];
    try {
      await vault.adapter.mkdir(cur);
    } catch {
      // Already exists (or is a file we shouldn't mkdir over) — fine.
    }
  }
}

// Conflict resolution --------------------------------------------------------

async function resolveConflict(
  opts: EngineOptions,
  p: string,
  local: LocalEntry,
  remote: RemoteEntry,
  isText: boolean,
  report: SyncReport,
): Promise<void> {
  const { client, app } = opts;
  const vault = app.vault;

  if (opts.conflictStrategy === 'local-win') {
    const data = await vault.adapter.readBinary(local.abs);
    await client.uploadFile(`${opts.remoteRoot}/${p}`, data, local.mtime);
    report.uploaded++;
    return;
  }
  if (opts.conflictStrategy === 'remote-win') {
    const data = await client.downloadFile(`${opts.remoteRoot}/${p}`);
    const abs = `${opts.configRoot}/${p}`;
    await ensureLocalParent(vault, abs);
    await vault.adapter.writeBinary(abs, data);
    report.downloaded++;
    return;
  }

  // Merge or keep-both: fetch remote content, then decide.
  const remoteData = await client.downloadFile(`${opts.remoteRoot}/${p}`);
  const remoteText = new TextDecoder().decode(remoteData);
  const localText = await readText(vault, local.abs);

  if (opts.conflictStrategy === 'keep-both') {
    // Save both sides.
    const conflictAbs = `${opts.configRoot}/${p}.conflict-${Date.now()}`;
    await vault.adapter.writeBinary(conflictAbs, remoteData);
    report.conflicts++;
    // Upload local as-is (it's the live copy).
    const data = await vault.adapter.readBinary(local.abs);
    await client.uploadFile(`${opts.remoteRoot}/${p}`, data, local.mtime);
    report.uploaded++;
    return;
  }

  // diff3 three-way merge for text; fall back to keep-both for non-text.
  if (isText) {
    try {
      const base = commonPrefixBase(localText, remoteText);
      const merged = diff3Merge(localText, base, remoteText);
      if (merged.hadConflicts) {
        const conflictAbs = `${opts.configRoot}/${p}.conflict-${Date.now()}`;
        await vault.adapter.writeBinary(conflictAbs, remoteData);
        report.conflicts++;
      }
      await writeText(vault, local.abs, merged.mergedContent);
      const data = await vault.adapter.readBinary(local.abs);
      await client.uploadFile(`${opts.remoteRoot}/${p}`, data, Date.now());
      report.uploaded++;
    } catch {
      // Merge failed → keep-both fallback.
      const conflictAbs = `${opts.configRoot}/${p}.conflict-${Date.now()}`;
      await vault.adapter.writeBinary(conflictAbs, remoteData);
      report.conflicts++;
      const data = await vault.adapter.readBinary(local.abs);
      await client.uploadFile(`${opts.remoteRoot}/${p}`, data, Date.now());
      report.uploaded++;
    }
  } else {
    // Non-text conflict → keep-both.
    const conflictAbs = `${opts.configRoot}/${p}.conflict-${Date.now()}`;
    await vault.adapter.writeBinary(conflictAbs, remoteData);
    report.conflicts++;
    const data = await vault.adapter.readBinary(local.abs);
    await client.uploadFile(`${opts.remoteRoot}/${p}`, data, local.mtime);
    report.uploaded++;
  }
}

// diff3 three-way merge (port of Diff3Strategy from nextcloud-sync-yanc, MIT).

function diff3Merge(local: string, base: string, remote: string): { mergedContent: string; hadConflicts: boolean } {
  const localLines = local.split('\n');
  const baseLines = base.split('\n');
  const remoteLines = remote.split('\n');

  const chunks = nodeDiff3Merge(localLines, baseLines, remoteLines, { excludeFalseConflicts: true });

  let mergedContent = '';
  let conflictRegions = 0;
  for (const chunk of chunks) {
    if (chunk.ok) {
      mergedContent += chunk.ok.join('\n');
      if (chunk.ok.length > 0) mergedContent += '\n';
    } else if (chunk.conflict) {
      conflictRegions++;
      mergedContent += '<<<<<<< LOCAL\n';
      mergedContent += chunk.conflict.a.join('\n');
      if (chunk.conflict.a.length > 0) mergedContent += '\n';
      mergedContent += '=======\n';
      mergedContent += chunk.conflict.b.join('\n');
      if (chunk.conflict.b.length > 0) mergedContent += '\n';
      mergedContent += '>>>>>>> REMOTE\n';
    }
  }
  return { mergedContent, hadConflicts: conflictRegions > 0 };
}

/** A best-effort base for a first-ever three-way merge: the LCS-based common prefix. */
function commonPrefixBase(a: string, b: string): string {
  // For config files, the frontmatter / JSON key order is usually stable. Use a plain
  // prefix-suffix union as a neutral base — good enough for a first merge without history.
  const al = a.split('\n');
  const bl = b.split('\n');
  let i = 0;
  while (i < al.length && i < bl.length && al[i] === bl[i]) i++;
  let j = 0;
  while (j < al.length - i && j < bl.length - i && al[al.length - 1 - j] === bl[bl.length - 1 - j]) j++;
  return [...al.slice(0, i), ...al.slice(al.length - j)].join('\n');
}