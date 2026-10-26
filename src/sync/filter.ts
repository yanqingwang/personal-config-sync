// Sync-scope filter engine (simplified): decides which vault files take part in config sync.
//
// After the product decision, the only user-facing choice is per-plugin:
//   * excludePlugins — the ids of plugins whose WHOLE folder must NOT sync.
//
// Everything else syncs by default, EXCEPT a small machine-managed built-in exclusion list that
// keeps device-local files from clobbering another device:
//   * workspace.json / backlink.json / graph.json — window layout & state, device-specific
//   * plugins/<id>/data.json, cache, main.js, styles.css, manifest.json — each plugin's own state
//
// All paths are vault-relative, "/"-separated, no leading slash. Case-sensitive.

import { isExcludedExtension } from '../util/excludedExtensions';

/** Built-in machine-managed exclusions (device-local files that must never sync). */
const BUILTIN_EXCLUDED_FILES: readonly string[] = [
  'workspace.json',
  'backlink.json',
  'graph.json',
  'plugins/*/data.json',
  'plugins/*/cache',
  'plugins/*/main.js',
  'plugins/*/styles.css',
  'plugins/*/manifest.json',
];

/** Built-in excluded extensions (never meaningful to sync across devices). */
const BUILTIN_EXCLUDED_EXTENSIONS: readonly string[] = ['tmp', 'lock'];

/** Normalize a stored pattern; null when it denotes the vault root / is empty. */
function normalizePattern(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  let p = trimmed.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '');
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (p.length === 0 || p === '.') return null;
  return p;
}

/** True when `path` matches a glob-lite pattern with exactly one `*` wildcard within one segment. */
function matchesWildcard(path: string, pattern: string): boolean {
  const star = pattern.indexOf('*');
  if (star < 0) return false;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return false;
  const mid = path.slice(prefix.length, path.length - suffix.length);
  return mid.indexOf('/') < 0;
}

/** True when `path` matches a built-in exclusion FILE pattern (exact or single-`*` wildcard). */
function matchesBuiltinFile(path: string): boolean {
  for (const raw of BUILTIN_EXCLUDED_FILES) {
    const pat = normalizePattern(raw);
    if (pat === null) continue;
    if (pat === path) return true;
    if (pat.includes('*') && matchesWildcard(path, pat)) return true;
  }
  return false;
}

/** True when `path` lives inside an excluded plugin's folder, e.g. 'plugins/nextcloud-sync-yanc/…'. */
function isExcludedPlugin(path: string, excludePlugins: readonly string[]): boolean {
  if (!excludePlugins || excludePlugins.length === 0) return false;
  if (!path.startsWith('plugins/')) return false;
  const rest = path.slice('plugins/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return false; // it IS a plugin folder entry, not inside one
  const pluginId = rest.slice(0, slash);
  return excludePlugins.includes(pluginId);
}

export interface SyncRules {
  /** Plugin ids whose whole folder must not sync. */
  excludePlugins: string[];
}

/**
 * The single decision function. `path` is vault-relative, "/"-separated.
 * Returns true when the path should be part of config sync.
 */
export function shouldSyncPath(path: string, rules: SyncRules): boolean {
  const base = path.split('/').pop() ?? '';

  // User choice: an excluded plugin's whole folder is skipped.
  if (isExcludedPlugin(path, rules.excludePlugins)) return false;

  // Built-in safety: device-local files never sync.
  if (matchesBuiltinFile(path)) return false;
  if (isExcludedExtension(base, BUILTIN_EXCLUDED_EXTENSIONS)) return false;

  // Everything else syncs by default.
  return true;
}

/** Fold the configured plugin exclusions into a ready-to-use rule set. */
export function effectiveRules(cfg: { excludePlugins: readonly string[] }): SyncRules {
  return {
    excludePlugins: [...(cfg.excludePlugins ?? [])],
  };
}