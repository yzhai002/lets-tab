import {
  loadSettings, isProtectedTab, groupTabsByDomain, findDuplicates,
  hostKeyOf, GROUP_COLORS,
} from '../src/lib.js';
import { listSnapshots, saveSnapshot, deleteSnapshot, restoreSnapshot } from '../src/snapshots.js';

const els = {
  stats: document.getElementById('stats'),
  btnOptions: document.getElementById('btnOptions'),
  btnGroup: document.getElementById('btnGroup'),
  btnDedup: document.getElementById('btnDedup'),
  btnSnapshot: document.getElementById('btnSnapshot'),
  message: document.getElementById('message'),
  list: document.getElementById('list'),
  search: document.getElementById('search'),
  snapshotList: document.getElementById('snapshotList'),
};

let settings = null;
let currentTabs = [];
let dupIds = new Set();
let dupCount = 0;
// 分组折叠状态（域名 → 是否折叠），只存在 popup 生命周期内
const collapsed = new Set();
const COLLAPSE_THRESHOLD = 5; // 超过这么多个标签的分组默认折叠

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
  // 按钮计数只统计当前窗口里可见的重复（全局去重由按钮动作跨窗口执行）
  const currentIds = new Set(currentTabs.map((t) => t.id));
  dupCount = toClose.filter((t) => currentIds.has(t.id)).length;
  render();
  renderSnapshots();
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

function renderSiteGroup(group, searchActive) {
  const section = document.createElement('section');
  section.className = 'site';

  const isCollapsed = collapsed.has(group.domain) ||
    (!searchActive && group.tabs.length >= COLLAPSE_THRESHOLD && !collapsed.has('!' + group.domain));

  const head = document.createElement('div');
  head.className = 'site-head';

  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = '▼';
  head.append(chevron);
  head.append(faviconEl(group.tabs[0]));

  const name = document.createElement('span');
  name.className = 'site-name';
  name.textContent = group.displayName || group.domain;
  head.append(name);

  if (group.tabs.length >= 2) {
    const btn = document.createElement('button');
    btn.className = 'mini';
    btn.textContent = '分组';
    btn.title = '把这些标签页合并成一个分组';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      groupDomains([group.domain]);
    });
    head.append(btn);
  }

  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = group.tabs.length + ' 个';
  head.append(count);

  head.addEventListener('click', () => {
    // 折叠状态记忆：显式展开/折叠优先于按数量的默认折叠
    if (collapsed.has(group.domain)) collapsed.delete(group.domain);
    else if (collapsed.has('!' + group.domain)) { collapsed.delete('!' + group.domain); collapsed.add(group.domain); }
    else if (isCollapsed) collapsed.delete('!' + group.domain);
    else collapsed.add(group.domain);
    render();
  });

  section.append(head);

  const rows = document.createElement('div');
  rows.className = 'tab-rows';
  if (!isCollapsed) {
    for (const tab of group.tabs) rows.append(renderTabRow(tab));
  }
  section.append(rows);
  if (isCollapsed) section.classList.add('collapsed');
  return section;
}

function render() {
  const query = els.search.value.trim().toLowerCase();
  const searchActive = !!query;

  let groups = groupTabsByDomain(currentTabs, settings);
  if (searchActive) {
    groups = groups
      .map((g) => ({
        ...g,
        tabs: g.tabs.filter((t) =>
          (t.title || '').toLowerCase().includes(query) ||
          (t.url || '').toLowerCase().includes(query) ||
          g.domain.includes(query)),
      }))
      .filter((g) => g.tabs.length);
  }
  const others = currentTabs.filter((t) => isProtectedTab(t, settings) &&
    (!searchActive || (t.title || '').toLowerCase().includes(query) || (t.url || '').toLowerCase().includes(query)));

  const visibleCount = groups.reduce((n, g) => n + g.tabs.length, 0) + others.length;
  els.stats.textContent = searchActive
    ? `找到 ${visibleCount} 个标签`
    : `本窗口 ${currentTabs.length} 个标签 · ${groups.length} 个网站 · ${dupCount} 个重复`;
  els.btnGroup.disabled = !searchActive && groups.filter((g) => g.tabs.length >= 2).length === 0;
  const globalDupCount = dupIds.size;
  els.btnDedup.disabled = globalDupCount === 0;
  els.btnDedup.textContent = globalDupCount
    ? `🔥 关闭 ${globalDupCount} 个重复${dupCount < globalDupCount ? '（含其它窗口）' : ''}`
    : '🔥 关闭重复';

  els.list.textContent = '';
  if (!visibleCount) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = searchActive ? '没有匹配的标签页' : '当前窗口没有标签页';
    els.list.append(empty);
    return;
  }
  for (const group of groups) {
    els.list.append(renderSiteGroup(group, searchActive));
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

async function renderSnapshots() {
  const list = await listSnapshots();
  els.snapshotList.textContent = '';
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'snapshot-empty';
    empty.textContent = '还没有快照，点上方 📸 保存当前标签页';
    els.snapshotList.append(empty);
    return;
  }
  for (const snap of list.slice(0, 10)) {
    const item = document.createElement('div');
    item.className = 'snapshot-item';
    const title = document.createElement('span');
    title.className = 'snap-title';
    title.textContent = snap.title;
    title.title = `${snap.count} 个标签页`;
    item.append(title);
    const count = document.createElement('span');
    count.className = 'snap-count';
    count.textContent = snap.count + ' 页';
    item.append(count);
    const restore = document.createElement('button');
    restore.className = 'mini';
    restore.textContent = '恢复';
    restore.addEventListener('click', async () => {
      try {
        const n = await restoreSnapshot(snap.id);
        showMessage(`已恢复 ${n} 个标签页`);
      } catch (err) {
        showMessage('恢复失败：' + err.message, false);
      }
    });
    item.append(restore);
    const del = document.createElement('button');
    del.className = 'mini';
    del.textContent = '删';
    del.addEventListener('click', async () => {
      await deleteSnapshot(snap.id);
      renderSnapshots();
    });
    item.append(del);
    els.snapshotList.append(item);
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
        title: g.displayName || g.domain,
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
els.btnSnapshot.addEventListener('click', async () => {
  const snap = await saveSnapshot();
  showMessage(`已保存快照：${snap.count} 个标签页`);
  renderSnapshots();
});
els.btnOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
els.search.addEventListener('input', render);

refresh();
