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
  // 自定义分组规则，每行一条：域名[|域名2...] => 组名
  // 例：bilibili.com => B站
  //     github.com|gist.github.com => 开发
  groupRules: '',
};

// 解析自定义分组规则，返回 [{ domains: [array], name: string }]
export function parseGroupRules(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('=>');
      const domains = parts[0].split('|')
        .map((d) => d.trim().toLowerCase().replace(/^www\./, ''))
        .filter(Boolean);
      const name = (parts[1] || '').trim();
      return domains.length ? { domains, name } : null;
    })
    .filter(Boolean);
}

function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

function hostMatchesDomain(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

// 命中规则时返回组名（规则无名则返回空串表示只归并不改名）
export function ruleNameFor(host, rules) {
  const h = normalizeHost(host);
  for (let i = 0; i < rules.length; i++) {
    for (let j = 0; j < rules[i].domains.length; j++) {
      if (hostMatchesDomain(h, rules[i].domains[j])) return rules[i].name;
    }
  }
  return null;
}

// 归并键：命中规则的域名们共用规则首个域名作为聚合键，未命中返回 null
export function ruleKeyFor(host, rules) {
  const h = normalizeHost(host);
  for (let i = 0; i < rules.length; i++) {
    for (let j = 0; j < rules[i].domains.length; j++) {
      if (hostMatchesDomain(h, rules[i].domains[j])) return rules[i].domains[0];
    }
  }
  return null;
}

// chrome.tabGroups.update 支持的颜色里挑暖色系，避免标签栏出现冷色调
export const GROUP_COLORS = ['orange', 'yellow', 'red', 'pink', 'grey'];

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

// 按域名聚合（去掉 www. 前缀），只统计可处理的标签。
// settings.groupRules 的规则会把不同域名归并到同一组并改名。
export function groupTabsByDomain(tabs, settings) {
  const rules = parseGroupRules(settings.groupRules);
  const map = new Map();
  for (const tab of tabs) {
    if (isProtectedTab(tab, settings)) continue;
    if (!isHttpUrl(tab.url)) continue;
    const host = hostKeyOf(tab.url);
    if (!host) continue;
    // 规则优先：命中规则的标签归并到规则键下，组名用规则名
    const ruleKey = rules.length ? ruleKeyFor(host, rules) : null;
    const key = ruleKey || host;
    if (!map.has(key)) map.set(key, { domain: key, displayName: key, tabs: [] });
    map.get(key).tabs.push(tab);
    const ruleName = ruleKey ? ruleNameFor(host, rules) : null;
    if (ruleKey && ruleName) map.get(key).displayName = ruleName;
  }
  const groups = [...map.values()];
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
