import {
  loadSettings, isProtectedTab, groupTabsByDomain, findDuplicates,
  hostKeyOf, GROUP_COLORS,
} from '../src/lib.js';

const els = {
  stats: document.getElementById('stats'),
  btnOptions: document.getElementById('btnOptions'),
  btnGroup: document.getElementById('btnGroup'),
  btnDedup: document.getElementById('btnDedup'),
  message: document.getElementById('message'),
  list: document.getElementById('list'),
};

let settings = null;
let currentTabs = [];
let dupIds = new Set();
let dupCount = 0;

function showMessage(text, ok = true) {
  els.message.textContent = text;
  els.message.className = 'message ' + (ok ? 'ok' : 'err');
  els.message.hidden = false;
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(() => { els.message.hidden = true; }, 2600);
}

async function refresh() {
  settings = await loadSettings();
  currentTabs = await chrome.tabs.query({ currentWindow: true });
  // 重复检测覆盖所有窗口（重复页经常散落在不同窗口里）
  const allTabs = await chrome.tabs.query({});
  const { toClose } = findDuplicates(allTabs, settings);
  dupIds = new Set(toClose.map((t) => t.id));
  dupCount = toClose.length;
  render();
}

function faviconEl(tab, cls = 'fav') {
  const span = document.createElement('span');
  span.className = cls;
  const letter = (hostKeyOf(tab.url) || '?').charAt(0).toUpperCase();
  if (tab.favIconUrl) {
    const img = document.createElement('img');
    img.src = tab.favIconUrl;
    img.alt = '';
    img.onerror = () => {
      span.textContent = letter;
      span.style.background = letterColor(tab.url);
    };
    span.append(img);
  } else {
    span.textContent = letter;
    span.style.background = letterColor(tab.url);
  }
  return span;
}

function letterColor(url) {
  const host = hostKeyOf(url) || '?';
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) % 360;
  // 哈希映射到暖色相区间（0°-60°：红→橙→黄）
  h = (h % 61) * 0.95;
  return `hsl(${h}, 55%, 46%)`;
}

function tabPath(url) {
  try {
    const u = new URL(url);
    return (u.pathname === '/' ? '' : u.pathname) + u.search;
  } catch {
    return url;
  }
}

function renderTabRow(tab) {
  const row = document.createElement('div');
  row.className = 'tab' + (dupIds.has(tab.id) ? ' dup' : '');
  row.title = tab.url;
  row.addEventListener('click', () => {
    chrome.tabs.update(tab.id, { active: true });
    window.close();
  });

  row.append(faviconEl(tab));

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || hostKeyOf(tab.url) || '(无标题)';
  const path = document.createElement('span');
  path.className = 'path';
  path.textContent = tabPath(tab.url) || '/';
  title.append(path);
  row.append(title);

  if (dupIds.has(tab.id)) {
    const badge = document.createElement('span');
    badge.className = 'badge-dup';
    badge.textContent = '重复';
    row.append(badge);
  }

  const close = document.createElement('button');
  close.className = 'tab-close';
  close.textContent = '×';
  close.title = '关闭此标签页';
  close.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await chrome.tabs.remove(tab.id);
    } catch { /* 已被关闭 */ }
    refresh();
  });
  row.append(close);

  return row;
}

function renderSiteGroup(group) {
  const section = document.createElement('section');
  section.className = 'site';

  const head = document.createElement('div');
  head.className = 'site-head';
  head.append(faviconEl(group.tabs[0]));

  const name = document.createElement('span');
  name.className = 'site-name';
  name.textContent = group.domain;
  head.append(name);

  if (group.tabs.length >= 2) {
    const btn = document.createElement('button');
    btn.className = 'mini';
    btn.textContent = '分组';
    btn.title = '把这些标签页合并成一个分组';
    btn.addEventListener('click', () => groupDomains([group.domain]));
    head.append(btn);
  }

  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = group.tabs.length + ' 个';
  head.append(count);

  section.append(head);
  for (const tab of group.tabs) section.append(renderTabRow(tab));
  return section;
}

function render() {
  const groups = groupTabsByDomain(currentTabs, settings);
  const multiGroups = groups.filter((g) => g.tabs.length >= 2);
  const others = currentTabs.filter((t) => isProtectedTab(t, settings));

  els.stats.textContent =
    `${currentTabs.length} 个标签 · ${groups.length} 个网站 · ${dupCount} 个重复`;
  els.btnGroup.disabled = multiGroups.length === 0;
  els.btnDedup.disabled = dupCount === 0;
  els.btnDedup.textContent = dupCount ? `🔥 关闭 ${dupCount} 个重复` : '🔥 关闭重复';

  els.list.textContent = '';
  if (!currentTabs.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '当前窗口没有标签页';
    els.list.append(empty);
    return;
  }
  for (const group of groups) {
    els.list.append(renderSiteGroup(group));
  }
  if (others.length) {
    const title = document.createElement('p');
    title.className = 'section-title';
    title.textContent = `受保护 · ${others.length} 个（不参与整理）`;
    els.list.append(title);
    const section = document.createElement('section');
    section.className = 'site';
    for (const tab of others) section.append(renderTabRow(tab));
    els.list.append(section);
  }
}

async function groupDomains(domainList) {
  const groups = groupTabsByDomain(currentTabs, settings)
    .filter((g) => domainList.includes(g.domain) && g.tabs.length >= 2);
  if (!groups.length) {
    showMessage('没有可合并的网站（同一网站至少要有 2 个标签页）');
    return;
  }
  try {
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const groupId = await chrome.tabs.group({ tabIds: g.tabs.map((t) => t.id) });
      await chrome.tabGroups.update(groupId, {
        title: g.domain,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
      });
    }
    showMessage(`已将 ${groups.length} 个网站的标签页合并为分组`);
  } catch (err) {
    showMessage('分组失败：' + (err && err.message ? err.message : String(err)), false);
  }
  refresh();
}

async function closeDuplicates() {
  const allTabs = await chrome.tabs.query({});
  const { toClose } = findDuplicates(allTabs, settings);
  if (!toClose.length) {
    showMessage('没有发现重复的网页 🎉');
    return;
  }
  try {
    await chrome.tabs.remove(toClose.map((t) => t.id));
    showMessage(`已关闭 ${toClose.length} 个重复标签页（保留最早打开的）`);
  } catch (err) {
    showMessage('关闭失败：' + (err && err.message ? err.message : String(err)), false);
  }
  refresh();
}

els.btnGroup.addEventListener('click', () => {
  const groups = groupTabsByDomain(currentTabs, settings).filter((g) => g.tabs.length >= 2);
  groupDomains(groups.map((g) => g.domain));
});
els.btnDedup.addEventListener('click', closeDuplicates);
els.btnOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

refresh();
