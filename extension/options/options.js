import { DEFAULT_SETTINGS, loadSettings } from '../src/lib.js';

const els = {
  ignoreHash: document.getElementById('ckIgnoreHash'),
  ignoreTracking: document.getElementById('ckIgnoreTracking'),
  ignoreSlash: document.getElementById('ckIgnoreSlash'),
  protectPinned: document.getElementById('ckProtectPinned'),
  blacklist: document.getElementById('taBlacklist'),
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
}

els.save.addEventListener('click', async () => {
  await chrome.storage.sync.set({
    ignoreHash: els.ignoreHash.checked,
    ignoreTracking: els.ignoreTracking.checked,
    ignoreTrailingSlash: els.ignoreSlash.checked,
    protectPinned: els.protectPinned.checked,
    blacklist: els.blacklist.value.trim(),
  });
  els.status.textContent = '已保存 ✓';
  els.status.classList.add('show');
  setTimeout(() => els.status.classList.remove('show'), 2000);
});

load();
