// LetsTab 共享逻辑：设置、URL 规范化、按域名聚合、重复检测。
// 所有处理都在本地完成，不做任何网络请求。

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_source_platform', 'gclid', 'gbraid', 'wbraid',
  'fbclid', 'msclkid', 'yclid', 'igshid', 'mc_eid', 'mc_cid', 'ref_src',
]);

export const DEFAULT_SETTINGS = {
  ignoreHash: true,
  ignoreTracking: true,
  ignoreTrailingSlash: true,
  protectPinned: true,
  blacklist: '',
};

// chrome.tabGroups.update 支持的颜色
export const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'orange', 'purple', 'grey'];

export async function loadSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

export function isHttpUrl(url) {
  return /^https?:/i.test(url || '');
}

// 浏览器内部页面、扩展页等，永远不参与分组与去重
export function isSpecialUrl(url) {
  return !url || /^(chrome|edge|about|devtools|view-source|chrome-extension|extension|moz-extension|javascript|data|blob):/i.test(url);
}

export function hostKeyOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function blacklistEntries(settings) {
  return String(settings.blacklist || '')
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isBlacklisted(url, settings) {
  const host = hostKeyOf(url);
  if (!host) return false;
  return blacklistEntries(settings).some((entry) => host === entry || host.endsWith('.' + entry));
}

// 受保护标签：固定（pinned）、浏览器内部页、黑名单网站
export function isProtectedTab(tab, settings) {
  if (settings.protectPinned && tab.pinned) return true;
  if (isSpecialUrl(tab.url)) return true;
  if (isBlacklisted(tab.url, settings)) return true;
  return false;
}

// 重复判定用的 URL 规范化形式
export function normalizeUrl(rawUrl, settings) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return rawUrl;
  if (settings.ignoreTracking) {
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (TRACKING_PARAMS.has(k) || k.startsWith('utm_')) u.searchParams.delete(key);
    }
    if ([...u.searchParams.keys()].length === 0) u.search = '';
  }
  if (settings.ignoreHash) u.hash = '';
  if (settings.ignoreTrailingSlash) {
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  }
  return u.href;
}

// 按域名聚合（去掉 www. 前缀），只统计可处理的标签
export function groupTabsByDomain(tabs, settings) {
  const map = new Map();
  for (const tab of tabs) {
    if (isProtectedTab(tab, settings)) continue;
    if (!isHttpUrl(tab.url)) continue;
    const key = hostKeyOf(tab.url);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tab);
  }
  const groups = [...map.entries()].map(([domain, groupTabs]) => ({ domain, tabs: groupTabs }));
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.domain.localeCompare(b.domain));
  return groups;
}

// 重复检测：同 URL 组保留打开最早的（id 最小），其余视为可关闭
export function findDuplicates(tabs, settings) {
  const map = new Map();
  for (const tab of tabs) {
    if (isProtectedTab(tab, settings)) continue;
    if (!isHttpUrl(tab.url)) continue;
    const key = normalizeUrl(tab.url, settings);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tab);
  }
  const dupGroups = [];
  for (const group of map.values()) {
    if (group.length > 1) {
      group.sort((a, b) => a.id - b.id);
      dupGroups.push(group);
    }
  }
  return { dupGroups, toClose: dupGroups.flatMap((group) => group.slice(1)) };
}
