// 图标角标：实时显示所有窗口中重复标签页的数量
// 快捷键命令：Alt+G 合并分组 / Alt+D 关闭重复 / 快照保存
import { findDuplicates, loadSettings, groupTabsByDomain, GROUP_COLORS } from './src/lib.js';
import { saveSnapshot } from './src/snapshots.js';

const DEBOUNCE_MS = 300;

async function refreshBadge() {
  try {
    const settings = await loadSettings();
    const tabs = await chrome.tabs.query({});
    const { toClose } = findDuplicates(tabs, settings);
    await chrome.action.setBadgeBackgroundColor({ color: '#C94F38' });
    await chrome.action.setBadgeText({ text: toClose.length ? String(toClose.length) : '' });
  } catch {
    // service worker 生命周期切换中可能报错，忽略即可
  }
}

let timer;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(refreshBadge, DEBOUNCE_MS);
}

for (const event of ['onCreated', 'onUpdated', 'onRemoved', 'onReplaced', 'onAttached', 'onDetached']) {
  chrome.tabs[event].addListener(schedule);
}

// 快捷键触发时给个可见反馈：短暂改角标
async function flashBadge(text, ms = 1200) {
  try {
    await chrome.action.setBadgeText({ text });
    setTimeout(refreshBadge, ms);
  } catch { /* 忽略 */ }
}

// 当前窗口一键合并分组（与 popup 中逻辑一致）
async function groupCurrentWindow() {
  const settings = await loadSettings();
  const [win] = await chrome.windows.getLastFocused();
  const tabs = await chrome.tabs.query({ windowId: win.id });
  const groups = groupTabsByDomain(tabs, settings).filter((g) => g.tabs.length >= 2);
  let merged = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const groupId = await chrome.tabs.group({ tabIds: g.tabs.map((t) => t.id) });
    await chrome.tabGroups.update(groupId, {
      title: g.displayName || g.domain,
      color: GROUP_COLORS[i % GROUP_COLORS.length],
    });
    merged++;
  }
  return merged;
}

async function closeAllDuplicates() {
  const settings = await loadSettings();
  const tabs = await chrome.tabs.query({});
  const { toClose } = findDuplicates(tabs, settings);
  if (toClose.length) {
    await chrome.tabs.remove(toClose.map((t) => t.id));
  }
  return toClose.length;
}

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'group-tabs') {
      const merged = await groupCurrentWindow();
      await flashBadge(merged ? 'G' + merged : 'OK');
    } else if (command === 'close-duplicates') {
      const closed = await closeAllDuplicates();
      await flashBadge('D' + closed);
    } else if (command === 'save-snapshot') {
      await saveSnapshot();
      await flashBadge('S');
    }
  } catch {
    // 快捷键失败静默处理，不打断用户
  }
});

refreshBadge();
