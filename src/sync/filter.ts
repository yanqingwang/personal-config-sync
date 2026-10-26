// Sync-scope filter engine: decides which vault files take part in config sync.
//
// Two independent rule sets:
//   * INCLUDE (whitelist) — when syncMode is 'whitelist', ONLY these paths are synced.
//   * EXCLUDE            — in 'all' / 'whitelist' mode, these paths are never synced.
//     In 'exclude' (sync-only-excluded) mode the meaning flips: only EXCLUDED paths are synced.
//
// Defaults: syncMode = 'all' (everything synced), with a small machine-managed DEFAULT exclusion
// list so device-local config files never clobber another device:
//   * workspace.json / backlink.json        — window layout & state, device-specific
//   * plugins/<id>/data.json, cache, main.js — each plugin's local state
//   * graph.json, themes/<name>/style.css    — local render caches
//
// All paths are vault-relative, "/"-separated, no leading slash. Case-sensitive.

import { isUnderExcludedFolder, normalizeExcludedFolder } from '../util/excludedFolders';
import { isExcludedExtension, normalizeExtension } from '../util/excludedExtensions';

export type SyncMode = 'all' | 'whitelist' | 'exclude';

/** Default machine-managed exclusions (device-local files that must never sync). */
export const DEFAULT_EXCLUDED_FILES: readonly string[] = [
  'workspace.json',
  'backlink.json',
  'graph.json',
  'plugins/*/data.json',
  'plugins/*/cache',
  'plugins/*/main.js',
  'plugins/*/styles.css',
  'plugins/*/manifest.json',
];

/** Default excluded extensions (never meaningful to sync across devices). */
export const DEFAULT_EXCLUDED_EXTENSIONS: readonly string[] = ['tmp', 'lock'];

/**
 * Convert a stored path pattern into a normalized pattern, or null when it denotes the
 * vault root / is empty. Handles the single `*` wildcard used by the defaults above.
 */
function normalizePattern(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  // Strip a leading "./" and collapse slashes.
  let p = trimmed.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '');
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (p.length === 0 || p === '.') return null;
  return p;
}

/**
 * True when path matches a glob-lite pattern that may contain exactly one star wildcard
 * that matches within a single path segment (no slash).
 * Example: plugins/any/data.json matches plugins/dataview/data.json but not a nested folder.
 */
function matchesWildcard(path: string, pattern: string): boolean {
  const star = pattern.indexOf('*');
  if (star < 0) return false;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return false;
  // The wildcard must not cross a path segment.
  const mid = path.slice(prefix.length, path.length - suffix.length);
  return mid.indexOf('/') < 0;
}

/** True when `path` matches any stored exclusion FILE pattern (exact or single-`*` wildcard). */
function matchesExcludedFile(path: string, patterns: readonly string[]): boolean {
  for (const raw of patterns) {
    if (!raw) continue;
    const pat = normalizePattern(raw);
    if (pat === null) continue;
    if (pat === path) return true;
    if (pat.includes('*') && matchesWildcard(path, pat)) return true;
    // A trailing '/' pattern is a folder rule (handled by folder exclusion); skip here.
  }
  return false;
}

/** True when any folder segment of `path` matches a stored excluded FOLDER pattern. */
function matchesExcludedFolder(path: string, folders: readonly string[]): boolean {
  // Reuse the proven folder-boundary matcher from the ported util.
  if (isUnderExcludedFolder(path, folders)) return true;
  // Folder patterns with a single trailing '*' (e.g. 'plugins/*/cache') match any one segment.
  for (const raw of folders) {
    if (!raw) continue;
    const pat = normalizePattern(raw);
    if (pat === null) continue;
    if (!pat.includes('*')) continue;
    if (matchesWildcard(path, pat)) return true;
  }
  return false;
}

/**
 * The single decision function. `path` is vault-relative, "/"-separated.
 *
 * @param mode       'all' → everything except exclude; 'whitelist' → only include; 'exclude' → only exclude
 * @param include    whitelist entries (used in 'whitelist' and 'exclude' modes)
 * @param excludeFolders   excluded folder entries
 * @param excludeFiles     excluded file patterns
 * @param excludeExtensions excluded extensions
 */
export function shouldSyncPath(
  path: string,
  opts: {
    mode: SyncMode;
    include: readonly string[];
    excludeFolders: readonly string[];
    excludeFiles: readonly string[];
    excludeExtensions: readonly string[];
    /** Plugin ids whose WHOLE folder is excluded: 'plugins/<id>/…' never syncs. */
    excludePlugins?: readonly string[];
  },
): boolean {
  const base = path.split('/').pop() ?? '';
  const inExclude =
    matchesExcludedFile(path, opts.excludeFiles) ||
    matchesExcludedFolder(path, opts.excludeFolders) ||
    isExcludedExtension(base, opts.excludeExtensions) ||
    isExcludedPlugin(path, opts.excludePlugins);

  if (opts.mode === 'exclude') {
    // Sync ONLY the excluded set (an "ignore the rest" escape hatch).
    return inExclude;
  }
  if (opts.mode === 'whitelist') {
    if (!isUnderAny(path, opts.include)) return false;
    return !inExclude;
  }
  // 'all' — default: everything, minus exclusions.
  return !inExclude;
}

/** True when `path` lives inside an excluded plugin's folder, e.g. 'plugins/nextcloud-sync-yanc/…'. */
function isExcludedPlugin(path: string, plugins: readonly string[] | undefined): boolean {
  if (!plugins || plugins.length === 0) return false;
  if (!path.startsWith('plugins/')) return false;
  const rest = path.slice('plugins/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return false; // it IS a plugin folder entry itself, not inside one
  const pluginId = rest.slice(0, slash);
  return plugins.includes(pluginId);
}

function isUnderAny(path: string, entries: readonly string[]): boolean {
  if (!entries || entries.length === 0) return false;
  for (const raw of entries) {
    const e = normalizeExcludedFolder(raw);
    if (e === null) continue;
    if (path === e || path.startsWith(e + '/')) return true;
  }
  return false;
}

/**
 * Fold the configured rule sets together with the built-in defaults.
 * User entries are always merged in front of defaults so defaults remain enforced.
 */
export function effectiveRules(cfg: {
  mode: SyncMode;
  includeFolders: readonly string[];
  excludeFolders: readonly string[];
  excludePlugins?: readonly string[];
  excludeFiles: readonly string[];
  excludeExtensions: readonly string[];
}): { mode: SyncMode; include: string[]; excludeFolders: string[]; excludeFiles: string[]; excludeExtensions: string[]; excludePlugins: string[] } {
  const excludeFiles = [...cfg.excludeFiles, ...DEFAULT_EXCLUDED_FILES];
  const excludeExtensions = [...cfg.excludeExtensions, ...DEFAULT_EXCLUDED_EXTENSIONS];
  return {
    mode: cfg.mode,
    include: [...cfg.includeFolders],
    excludeFolders: [...cfg.excludeFolders],
    excludeFiles,
    excludeExtensions,
    excludePlugins: [...(cfg.excludePlugins ?? [])],
  };
}

export { normalizeExtension, normalizeExcludedFolder };