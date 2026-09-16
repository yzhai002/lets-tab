// 图标角标：实时显示所有窗口中重复标签页的数量
import { findDuplicates, loadSettings } from './src/lib.js';

const DEBOUNCE_MS = 300;

async function refreshBadge() {
  try {
    const settings = await loadSettings();
    const tabs = await chrome.tabs.query({});
    const { toClose } = findDuplicates(tabs, settings);
    await chrome.action.setBadgeBackgroundColor({ color: '#E11D48' });
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

refreshBadge();
