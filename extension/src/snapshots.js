// LetsTab 快照：保存/恢复/删除全部标签页（含分组信息）。
// 数据存 chrome.storage.local，上限 20 条，纯本地不上传。
import { isSpecialUrl } from './lib.js';

const SNAPSHOT_KEY = 'snapshots';
const MAX_SNAPSHOTS = 20;

export async function listSnapshots() {
  const stored = await chrome.storage.local.get(SNAPSHOT_KEY);
  const list = stored[SNAPSHOT_KEY];
  return Array.isArray(list) ? list : [];
}

export async function saveSnapshot(title) {
  const tabs = await chrome.tabs.query({});
  const groups = await chrome.tabGroups.query({});
  const groupIdToName = {};
  for (const g of groups) groupIdToName[g.id] = g.title || '';
  const items = tabs
    .filter((t) => !isSpecialUrl(t.url))
    .map((t) => ({
      url: t.url,
      title: t.title,
      pinned: !!t.pinned,
      group: t.groupId && groupIdToName[t.groupId] !== undefined ? groupIdToName[t.groupId] : '',
    }));
  const snap = { id: Date.now(), title: title || new Date().toLocaleString(), count: items.length, items };
  const list = await listSnapshots();
  list.unshift(snap);
  if (list.length > MAX_SNAPSHOTS) list.length = MAX_SNAPSHOTS;
  const toStore = {};
  toStore[SNAPSHOT_KEY] = list;
  await chrome.storage.local.set(toStore);
  return snap;
}

export async function deleteSnapshot(id) {
  const list = (await listSnapshots()).filter((s) => s.id !== id);
  const toStore = {};
  toStore[SNAPSHOT_KEY] = list;
  await chrome.storage.local.set(toStore);
}

// 恢复快照：重新打开全部标签，并按原组名重建分组
export async function restoreSnapshot(id) {
  const snap = (await listSnapshots()).find((s) => s.id === id);
  if (!snap) throw new Error('快照不存在');
  let restored = 0;
  const byGroup = {};
  for (const item of snap.items) {
    if (isSpecialUrl(item.url)) continue;
    const tab = await chrome.tabs.create({ url: item.url, pinned: item.pinned, active: false });
    restored++;
    if (item.group) {
      if (!byGroup[item.group]) byGroup[item.group] = [];
      byGroup[item.group].push(tab.id);
    }
  }
  for (const title of Object.keys(byGroup)) {
    try {
      const gid = await chrome.tabs.group({ tabIds: byGroup[title] });
      await chrome.tabGroups.update(gid, { title });
    } catch (err) {
      // 个别分组重建失败不影响标签恢复
    }
  }
  return restored;
}
