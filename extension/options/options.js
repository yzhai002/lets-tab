import { DEFAULT_SETTINGS, loadSettings, parseGroupRules } from '../src/lib.js';

const els = {
  ignoreHash: document.getElementById('ckIgnoreHash'),
  ignoreTracking: document.getElementById('ckIgnoreTracking'),
  ignoreSlash: document.getElementById('ckIgnoreSlash'),
  protectPinned: document.getElementById('ckProtectPinned'),
  blacklist: document.getElementById('taBlacklist'),
  groupRules: document.getElementById('taGroupRules'),
  save: document.getElementById('btnSave'),
  status: document.getElementById('status'),
};

async function load() {
  const s = await loadSettings();
  els.ignoreHash.checked = s.ignoreHash;
  els.ignoreTracking.checked = s.ignoreTracking;
  els.ignoreSlash.checked = s.ignoreTrailingSlash;
  els.protectPinned.checked = s.protectPinned;
  els.blacklist.value = s.blacklist || '';
  els.groupRules.value = s.groupRules || '';
}

els.save.addEventListener('click', async () => {
  const rules = parseGroupRules(els.groupRules.value);
  // 解析结果回写：规范化格式并丢弃空行，让用户看到实际生效的规则
  const normalized = rules
    .map((r) => r.domains.join('|') + (r.name ? ' => ' + r.name : ''))
    .join('\n');
  await chrome.storage.sync.set({
    ignoreHash: els.ignoreHash.checked,
    ignoreTracking: els.ignoreTracking.checked,
    ignoreTrailingSlash: els.ignoreSlash.checked,
    protectPinned: els.protectPinned.checked,
    blacklist: els.blacklist.value.trim(),
    groupRules: normalized,
  });
  els.status.textContent = `已保存 ✓（${rules.length} 条分组规则）`;
  els.status.classList.add('show');
  els.groupRules.value = normalized;
  setTimeout(() => els.status.classList.remove('show'), 2000);
});

load();
