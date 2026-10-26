import { shouldSyncPath, effectiveRules } from '/home/wang/wk/code/obsidian-config-sync/src/sync/filter';

// Default: nothing excluded.
const defaults = effectiveRules({ excludePlugins: [] });

// Exclude two plugins.
const excl = effectiveRules({ excludePlugins: ['nextcloud-sync-yanc', 'vault-agent'] });

const cases: Array<[string, ReturnType<typeof effectiveRules>, boolean, string]> = [
  // ── default: everything syncs except built-in device-local files ──
  ['app.json', defaults, true, '核心配置 app.json → 应同步'],
  ['appearance.json', defaults, true, '外观配置 → 应同步'],
  ['core-plugins.json', defaults, true, '核心插件启用 → 应同步'],
  ['community-plugins.json', defaults, true, '社区插件启用 → 应同步'],
  ['themes/Wide View/manifest.json', defaults, true, '主题配置 → 应同步'],
  ['themes/Wide View/theme.css', defaults, true, '主题样式 → 应同步'],
  ['plugins/dataview/versions.json', defaults, true, '插件普通数据 → 应同步'],
  ['plugins/excalidraw/snippets.md', defaults, true, '插件新数据 → 应同步'],

  // ── built-in device-local exclusions ──
  ['workspace.json', defaults, false, '设备态 workspace.json → 内置排除'],
  ['backlink.json', defaults, false, '设备态 backlink.json → 内置排除'],
  ['graph.json', defaults, false, '设备态 graph.json → 内置排除'],
  ['plugins/dataview/data.json', defaults, false, '插件本机 data.json → 内置排除'],
  ['plugins/dataview/main.js', defaults, false, '插件代码 main.js → 内置排除'],
  ['plugins/dataview/manifest.json', defaults, false, '插件清单 → 内置排除'],
  ['plugins/dataview/styles.css', defaults, false, '插件样式 → 内置排除'],

  // ── user-excluded plugins: whole folder skipped ──
  ['plugins/nextcloud-sync-yanc/data.json', excl, false, '被排除插件的 data.json → 排除'],
  ['plugins/nextcloud-sync-yanc/sync-history.json', excl, false, '被排除插件的状态文件 → 排除'],
  ['plugins/nextcloud-sync-yanc/anything.json', excl, false, '被排除插件的任何文件 → 排除'],
  ['plugins/vault-agent/history.db', excl, false, '被排除插件的数据库 → 排除'],
  ['plugins/vault-agent/data.json', excl, false, '被排除插件的 data.json → 排除'],
  ['plugins/quadrant-chart/data.json', excl, false, '未排除插件的 data.json → 仍被内置排除（默认，因为 plugins/*/data.json）'],
  ['plugins/quadrant-chart/snippets.md', excl, true, '未排除插件的普通文件 → 应同步'],
];

let pass = 0, fail = 0;
for (const [p, rules, expected, desc] of cases) {
  const got = shouldSyncPath(p, rules);
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅' : '❌'} ${desc}  → ${got}  (期望 ${expected})`);
}
console.log(`\n${pass}/${pass + fail} 通过`);