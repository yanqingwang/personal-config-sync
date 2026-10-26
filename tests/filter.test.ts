import { shouldSyncPath, effectiveRules } from '/home/wang/wk/code/obsidian-config-sync/src/sync/filter';

const cfg = effectiveRules({
  mode: 'all',
  includeFolders: [],
  excludeFolders: [],
  excludeFiles: [],
  excludeExtensions: [],
});

const cases = [
  ['app.json', '核心配置 app.json → 应同步'],
  ['appearance.json', '外观配置 → 应同步'],
  ['themes/Wide View/manifest.json', '主题配置 → 应同步'],
  ['workspace.json', '设备态 workspace.json → 应排除'],
  ['backlink.json', '设备态 backlink.json → 应排除'],
  ['plugins/dataview/data.json', '插件本机数据 → 应排除'],
  ['plugins/dataview/main.js', '插件代码 → 应排除'],
  ['plugins/quadrant-chart/manifest.json', '插件清单 → 应排除'],
  ['plugins/excalidraw/Something.new', '插件其他文件 → 应同步'],
  ['core-plugins.json', '核心插件启用状态 → 应同步'],
];

for (const [p, desc] of cases) {
  const r = shouldSyncPath(p, cfg);
  console.log(`${r ? '✅ 同步' : '❌ 排除'}  ${p.padEnd(40)} ${desc} → ${r}`);
}
