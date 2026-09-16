// lib.js 核心逻辑单元测试：node tests/run.mjs
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libPath = path.join(root, 'extension/src/lib.js');
const lib = await import(libPath);

const S = { ...lib.DEFAULT_SETTINGS };

function tab(id, url, extra = {}) {
  return { id, url, pinned: false, title: 't', ...extra };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('✓', name);
}

test('hostKeyOf 去掉 www. 并转小写', () => {
  assert.equal(lib.hostKeyOf('https://WWW.Example.com/a'), 'example.com');
  assert.equal(lib.hostKeyOf('not a url'), '');
});

test('isSpecialUrl 识别浏览器内部页面', () => {
  assert.ok(lib.isSpecialUrl('chrome://settings'));
  assert.ok(lib.isSpecialUrl('edge://extensions'));
  assert.ok(lib.isSpecialUrl('chrome-extension://abc/popup.html'));
  assert.ok(lib.isSpecialUrl(undefined));
  assert.ok(!lib.isSpecialUrl('https://example.com'));
});

test('normalizeUrl 去掉锚点与追踪参数', () => {
  const a = lib.normalizeUrl('https://e.com/p?utm_source=x&utm_campaign=y&keep=1#top', S);
  assert.equal(a, 'https://e.com/p?keep=1');
});

test('normalizeUrl 去掉末尾斜杠并清空 search', () => {
  assert.equal(lib.normalizeUrl('https://e.com/p/', S), 'https://e.com/p');
  assert.equal(lib.normalizeUrl('https://e.com/p?utm_source=x', S), 'https://e.com/p');
});

test('normalizeUrl 可选规则关闭时保留差异', () => {
  const off = { ...S, ignoreHash: false, ignoreTracking: false, ignoreTrailingSlash: false };
  assert.equal(lib.normalizeUrl('https://e.com/p?utm_source=x#top', off), 'https://e.com/p?utm_source=x#top');
  assert.equal(lib.normalizeUrl('https://e.com/p/', off), 'https://e.com/p/');
});

test('normalizeUrl 对非 http(s) 原样返回', () => {
  assert.equal(lib.normalizeUrl('chrome://settings', S), 'chrome://settings');
});

test('黑名单匹配域名及子域名', () => {
  const s = { ...S, blacklist: 'github.com\nDocs.Google.com' };
  assert.ok(lib.isBlacklisted('https://github.com/a', s));
  assert.ok(lib.isBlacklisted('https://gist.github.com/a', s));
  assert.ok(lib.isBlacklisted('https://docs.google.com/x', s));
  assert.ok(!lib.isBlacklisted('https://example.com', s));
  // 类似但不同域名不应误匹配
  assert.ok(!lib.isBlacklisted('https://mygithub.com.evil.io/x', s));
});

test('保护规则：pinned / 内部页 / 黑名单', () => {
  const s = { ...S, blacklist: 'github.com' };
  assert.ok(lib.isProtectedTab(tab(1, 'https://github.com/x', { pinned: true }), s));
  assert.ok(lib.isProtectedTab(tab(2, 'chrome://newtab'), s));
  assert.ok(lib.isProtectedTab(tab(3, 'https://github.com/x'), s));
  assert.ok(!lib.isProtectedTab(tab(4, 'https://example.com/x'), s));
});

test('groupTabsByDomain 聚合并跳过受保护标签', () => {
  const s = { ...S };
  const groups = lib.groupTabsByDomain([
    tab(1, 'https://www.a.com/1'),
    tab(2, 'https://a.com/2'),
    tab(3, 'https://b.com/1'),
    tab(4, 'chrome://settings'),
    tab(5, 'https://b.com/2', { pinned: true }),
  ], s);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].domain, 'a.com');
  assert.equal(groups[0].tabs.length, 2);
  const b = groups.find((g) => g.domain === 'b.com');
  assert.equal(b.tabs.length, 1);
});

test('findDuplicates 跨域去重、保留最小 id', () => {
  const s = { ...S };
  const { dupGroups, toClose } = lib.findDuplicates([
    tab(10, 'https://e.com/p#top'),
    tab(5, 'https://e.com/p'),
    tab(9, 'https://e.com/p?utm_source=x'),
    tab(8, 'https://e.com/other'),
    tab(7, 'chrome://settings'),
    tab(6, 'https://e.com/p', { pinned: true }),
  ], s);
  assert.equal(dupGroups.length, 1);
  assert.equal(dupGroups[0][0].id, 5);
  assert.equal(toClose.length, 2);
  assert.deepEqual(toClose.map((t) => t.id).sort((a, b) => a - b), [9, 10]);
});

test('findDuplicates 忽略 pinned 的重复页', () => {
  const s = { ...S };
  const { toClose } = lib.findDuplicates([
    tab(1, 'https://e.com/p', { pinned: true }),
    tab(2, 'https://e.com/p'),
  ], s);
  assert.equal(toClose.length, 0);
});

test('findDuplicates 非完整 URL 参数逐一比较', () => {
  const s = { ...S };
  const { toClose } = lib.findDuplicates([
    tab(1, 'https://e.com/p?a=1'),
    tab(2, 'https://e.com/p?a=2'),
  ], s);
  assert.equal(toClose.length, 0);
});

test('manifest 声明了代码用到的全部权限与图标', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('tabs'), '缺少 tabs 权限');
  assert.ok(manifest.permissions.includes('tabGroups'), '缺少 tabGroups 权限（popup 分组功能必需）');
  assert.ok(manifest.permissions.includes('storage'), '缺少 storage 权限');
  for (const size of [16, 32, 48, 128]) {
    assert.ok(fs.existsSync(path.join(root, `extension/icons/${size}.png`)), `缺少图标 ${size}.png`);
  }
});

console.log(`\n${passed} 个测试全部通过 ✅`);
