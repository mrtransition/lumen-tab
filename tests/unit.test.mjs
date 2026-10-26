import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'product', 'js');
const U = require(path.join(root, 'util.js'));
const Icons = require(path.join(root, 'icons.js'));
const D = require(path.join(root, 'data.js'));
const Store = require(path.join(root, 'store.js'));
const AIApi = require(path.join(root, 'ai-api.js'));
const Markdown = require(path.join(root, 'markdown.js'));
const Weather = require(path.join(root, 'weather.js'));
const WeTab = require(path.join(root, 'webtab-import.js'));

function memStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map
  };
}

const FIXED = new Date(2026, 9, 23, 9, 5, 0).getTime();

test('util: 日期工具', () => {
  assert.equal(U.todayKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(U.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(U.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(U.daysUntil('2027-01-01', new Date(2026, 9, 23)), 70);
  assert.equal(U.daysUntil('2026-10-23', new Date(2026, 9, 23)), 0);
  assert.equal(U.daysUntil('2025-05-20', new Date(2026, 9, 23)), -521);
  assert.equal(U.dayOfYear(new Date(2026, 0, 1)), 1);
  assert.equal(U.yearProgress(new Date(2024, 11, 31)).total, 366);
  assert.equal(U.yearProgress(new Date(2026, 11, 31)).left, 0);
  assert.equal(U.lastNDays(3, new Date(2026, 9, 23)).join(','), '2026-10-21,2026-10-22,2026-10-23');
  assert.equal(U.fmtClock(new Date(2026, 9, 23, 7, 4, 9), true), '07:04:09');
  assert.equal(U.fmtClock(new Date(2026, 9, 23, 7, 4, 9), false), '07:04');
  assert.equal(U.fmtDateZh(new Date(2026, 9, 23)), '10月23日 周五');
  assert.equal(U.greeting(new Date(2026, 9, 23, 7, 0)), '早上好');
  assert.equal(U.greeting(new Date(2026, 9, 23, 23, 30)), '夜深了');
});

test('util: 种子随机可复现', () => {
  const a = U.seeded('lumen-2026-10-23')();
  const b = U.seeded('lumen-2026-10-23')();
  assert.equal(a, b);
  assert.notEqual(a, U.seeded('lumen-2026-10-24')());
  assert.ok(a >= 0 && a < 1);
  const rnd = U.mulberry32(42);
  const seq = [rnd(), rnd(), rnd()].map((n) => Math.round(n * 1e6));
  const rnd2 = U.mulberry32(42);
  assert.deepEqual(seq, [rnd2(), rnd2(), rnd2()].map((n) => Math.round(n * 1e6)));
  assert.equal(U.hashStr('abc'), U.hashStr('abc'));
  assert.notEqual(U.hashStr('abc'), U.hashStr('abd'));
});

test('util: URL 归一化与搜索地址', () => {
  assert.equal(U.normalizeUrl('  https://a.com/x?y=1 '), 'https://a.com/x?y=1');
  assert.equal(U.normalizeUrl('example.com/a'), 'https://example.com/a');
  assert.equal(U.normalizeUrl('localhost:8080'), 'https://localhost:8080');
  assert.equal(U.normalizeUrl('随便一句话'), null);
  assert.equal(U.normalizeUrl(''), null);
  assert.equal(U.normalizeWebUrl('example.com'), 'https://example.com');
  assert.equal(U.normalizeWebUrl('javascript:alert(1)'), null);
  assert.equal(U.normalizeWebUrl('edge://settings'), null);
  assert.equal(U.normalizeWebUrl('file:///C:/x.html'), null);
  assert.equal(U.firstGrapheme('🧑‍💻 设计师'), '🧑‍💻');
  assert.equal(U.firstGrapheme('  '), '');
  const url = U.buildSearchUrl(D.ENGINES[0].url, '新 标签 页');
  assert.ok(url.startsWith('https://www.bing.com/search?q='));
  assert.ok(url.includes(encodeURIComponent('新 标签 页')));
});

test('util: 转义与文本', () => {
  assert.equal(U.escapeHtml('<b>"x"&\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;&lt;/b&gt;');
  assert.equal(U.daysText(3), '还有 3 天');
  assert.equal(U.daysText(0), '就是今天');
  assert.equal(U.daysText(-5), '已过去 5 天');
  assert.equal(U.formatDuration(1500), '25:00');
  assert.equal(U.formatDuration(9), '00:09');
});

test('data: 静态数据不变量', () => {
  const ids = (list) => list.map((x) => x.id);
  assert.equal(new Set(ids(D.ENGINES)).size, D.ENGINES.length);
  assert.equal(new Set(ids(D.WALLPAPERS)).size, D.WALLPAPERS.length);
  assert.equal(new Set(ids(D.ACCENTS)).size, D.ACCENTS.length);
  assert.equal(new Set(ids(D.CITIES)).size, D.CITIES.length);
  assert.equal(new Set(ids(D.HOT_SOURCES)).size, D.HOT_SOURCES.length);
  assert.equal(new Set(ids(D.DEFAULT_SHORTCUTS)).size, D.DEFAULT_SHORTCUTS.length);

  D.ENGINES.forEach((e) => assert.match(e.url, /^https:\/\//));
  D.WALLPAPERS.forEach((w) => assert.ok(w.css.includes('gradient'), w.id));
  D.CONDITIONS.forEach((c) => assert.ok(Icons.has(c.icon), '缺少图标 ' + c.icon));
  D.CITIES.forEach((c) => {
    assert.ok(c.base > -30 && c.base < 45, c.id);
    assert.match(c.wind, /风/);
  });
  assert.equal(new Set(D.QUOTES.map((q) => q.text)).size, D.QUOTES.length);
  D.QUOTES.forEach((q) => {
    assert.ok(q.text.length >= 6 && q.text.length <= 40, q.text);
    assert.ok(q.author.length > 0);
  });
  D.HOT_SOURCES.forEach((s) => {
    assert.equal(s.items.length, 10, s.id);
    assert.equal(new Set(s.items).size, 10, s.id);
  });
  D.DEFAULT_SHORTCUTS.forEach((s) => {
    assert.match(s.url, /^https:\/\//);
    assert.match(s.color, /^#[0-9a-f]{6}$/i);
  });
});

test('data: 默认布局合法性', () => {
  const types = D.DEFAULT_LAYOUT.map((w) => w.type);
  assert.equal(new Set(types).size, types.length);
  D.DEFAULT_LAYOUT.forEach((w) => assert.ok(Store.SIZES.includes(w.size), w.type));
});

test('data: 默认分类与网站', () => {
  const cats = D.defaultCategories();
  assert.equal(cats.length, 5);
  assert.equal(cats[0].id, 'cat-home');
  assert.equal(new Set(cats.map((c) => c.id)).size, cats.length);
  assert.equal(cats[0].items.length, 10);
  assert.equal(new Set(cats[0].items.map((i) => i.type)).size, 10);

  const allIds = cats.flatMap((c) => c.items.map((i) => i.id));
  assert.equal(new Set(allIds).size, allIds.length, '条目 id 必须唯一');

  cats.slice(1).forEach((cat) => {
    assert.ok(cat.items.length >= 6, cat.id + ' 网站太少');
    assert.ok(cat.emoji.length > 0, cat.id);
    cat.items.forEach((site) => {
      assert.equal(site.kind, 'site', cat.id);
      assert.match(site.url, /^https:\/\//, site.name);
      assert.ok(site.emoji.length > 0, site.name);
      assert.match(site.color, /^#[0-9a-f]{6}$/i, site.name);
    });
  });
});

test('data: 默认状态结构', () => {
  const s = D.defaultState(FIXED);
  assert.equal(s.version, 2);
  assert.ok(Array.isArray(s.categories) && s.categories.length === 5);
  assert.equal(s.activeCategory, 'cat-home');
  assert.equal('layout' in s, false, 'v2 不再使用单一 layout');
  assert.ok(s.habits.length >= 3);
  s.habits.forEach((h) => {
    h.dates.forEach((d) => assert.match(d, /^\d{4}-\d{2}-\d{2}$/));
    assert.equal(new Set(h.dates).size, h.dates.length, '习惯日期不应重复');
  });
  s.countdowns.forEach((c) => {
    assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['countdown', 'anniversary'].includes(c.kind));
  });
  s.todos.forEach((t) => assert.equal(typeof t.done, 'boolean'));
  assert.equal(s.searchHistory.length, 0);
  assert.ok(s.settings.wallpaper.preset);
  assert.equal(s.settings.railCollapsed, false);
  JSON.parse(JSON.stringify(s)); // 必须可序列化
});

test('store: 待办增改删', () => {
  const store = Store({ storage: memStorage() });
  const before = store.get().todos.length;
  const item = store.addTodo('  写测试  ');
  assert.equal(item.text, '写测试');
  assert.equal(store.get().todos.length, before + 1);
  assert.equal(store.get().todos[0].id, item.id);
  store.toggleTodo(item.id);
  assert.equal(store.get().todos.find((t) => t.id === item.id).done, true);
  store.removeTodo(item.id);
  assert.equal(store.get().todos.length, before);
  assert.equal(store.addTodo('   '), null);
});

test('store: 持久化数据中的异常集合被清洗', () => {
  const storage = memStorage();
  storage.setItem('lumenTab.v1', JSON.stringify({
    version: 2,
    categories: [{ id: 'cat-home', name: '主页', emoji: '🏠', items: [] }],
    activeCategory: 'cat-home',
    settings: { theme: 'neon' },
    todos: [{ nope: 1 }],
    notes: [{ body: '文本' }],
    countdowns: [{ title: '坏', date: 'x' }],
    habits: [{ name: '坏习惯', dates: { '2026-10-20': true, x: 1 } }],
    pomodoro: { focus: 'abc', running: true, endsAt: 'x' },
    aiMessages: [{ text: 42 }],
    searchHistory: 'nope',
    water: { date: 'bad', cups: -3 },
    quoteFav: ['x', 0]
  }));
  const store = Store({ storage });
  const s = store.get();
  assert.equal(s.settings.theme, 'dark');
  assert.deepEqual(s.todos, []);
  assert.equal(s.notes[0].title, '未命名');
  assert.equal(s.notes[0].body, '文本');
  assert.deepEqual(s.countdowns, []);
  assert.deepEqual(s.habits[0].dates, ['2026-10-20']);
  assert.equal(s.pomodoro.focus, 25);
  assert.equal(s.pomodoro.running, false);
  assert.equal(s.pomodoro.endsAt, null);
  assert.deepEqual(s.aiMessages, []);
  assert.deepEqual(s.searchHistory, []);
  assert.equal(s.water.cups, 0);
  assert.deepEqual(s.quoteFav, [0]);
});

test('store: 持久化与重新加载', () => {
  const storage = memStorage();
  const a = Store({ storage });
  a.addTodo('跨会话');
  a.flush();
  assert.ok(storage.getItem('lumenTab.v1'));
  const b = Store({ storage });
  assert.ok(b.get().todos.some((t) => t.text === '跨会话'));
  a.patchSettings({ theme: 'light' });
  a.flush();
  const c = Store({ storage });
  assert.equal(c.get().settings.theme, 'light');
});

test('store: 分类内容动作', () => {
  const store = Store({ storage: memStorage() });
  const st = store.get();
  assert.equal(st.version, 2);
  assert.equal(store.getActiveCategory().id, 'cat-home');
  assert.equal(store.hasWidget('todo'), true);

  store.removeWidget('todo');
  assert.equal(store.hasWidget('todo'), false);
  const w = store.addWidget('todo', 'l');
  assert.ok(w && w.size === 'l');
  assert.equal(store.addWidget('todo', 'm'), null, '重复组件应被忽略');

  const catId = store.get().activeCategory;
  const cat = store.getCategory(catId);
  const firstId = cat.items[0].id;
  store.moveItem(catId, 0, 2);
  assert.equal(store.getCategory(catId).items[2].id, firstId);

  const beforeReverse = store.getCategory(catId).items.map((i) => i.id);
  store.reorderItems(catId, beforeReverse.slice().reverse());
  assert.deepEqual(store.getCategory(catId).items.map((i) => i.id), beforeReverse.slice().reverse());

  const widgetId = store.getCategory(catId).items.find((i) => i.kind === 'widget').id;
  store.setItemSize(catId, widgetId, 'l');
  assert.equal(store.getCategory(catId).items.find((i) => i.id === widgetId).size, 'l');
  store.setItemSize(catId, widgetId, 'huge');
  assert.equal(store.getCategory(catId).items.find((i) => i.id === widgetId).size, 'l');

  const c = store.addCategory('测试', '🧪');
  assert.equal(c.name, '测试');
  assert.equal(c.items.length, 0);
  assert.equal(store.setActiveCategory(c.id), true);
  assert.equal(store.getActiveCategory().id, c.id);

  const site = store.addSite(c.id, { name: '站点', url: 'example.com', emoji: 'E' });
  assert.equal(site.url, 'https://example.com');
  store.updateSite(c.id, site.id, { name: '改名' });
  assert.equal(store.getCategory(c.id).items[0].name, '改名');

  const folder = store.addFolder(c.id, '资料');
  assert.ok(folder && folder.kind === 'folder');
  const sub = store.addSiteToFolder(c.id, folder.id, { name: '子站', url: 'sub.example.com' });
  assert.equal(sub.url, 'https://sub.example.com');
  store.updateFolderSite(c.id, folder.id, sub.id, { name: '子站2' });
  assert.equal(store.getCategory(c.id).items.find((i) => i.id === folder.id).sites[0].name, '子站2');
  store.renameFolder(c.id, folder.id, '资料2');
  assert.equal(store.getCategory(c.id).items.find((i) => i.id === folder.id).name, '资料2');
  store.removeSiteFromFolder(c.id, folder.id, sub.id);
  assert.equal(store.getCategory(c.id).items.find((i) => i.id === folder.id).sites.length, 0);

  const moved = store.moveItemToCategory(c.id, site.id, 'cat-home');
  assert.equal(moved.ok, true);
  assert.ok(store.getCategory('cat-home').items.some((i) => i.id === site.id));
  assert.ok(!store.getCategory(c.id).items.some((i) => i.id === site.id));

  assert.equal(store.removeCategory(c.id), true);
  assert.equal(store.get().categories.length, 5);
  assert.ok(store.get().categories.some((x) => x.id === store.get().activeCategory));

  const solo = Store({ storage: memStorage() });
  const rest = solo.get().categories.slice(1);
  rest.forEach((x) => solo.removeCategory(x.id));
  assert.equal(solo.get().categories.length, 1);
  assert.equal(solo.removeCategory(solo.get().categories[0].id), false, '至少保留一个分类');
});

test('store: v1 备份迁移到分类页', () => {
  const legacy = {
    version: 1,
    settings: { theme: 'light' },
    layout: [{ type: 'weather', size: 'm' }, { type: 'todo', size: 's' }],
    shortcuts: [],
    todos: [],
    habits: [],
    countdowns: []
  };
  const res = Store.validateImport(JSON.parse(JSON.stringify(legacy)));
  assert.equal(res.ok, true);
  assert.equal(res.state.version, 2);
  assert.equal('layout' in res.state, false);
  assert.equal(res.state.activeCategory, 'cat-home');
  const home = res.state.categories.find((c) => c.id === 'cat-home');
  assert.deepEqual(home.items.map((i) => i.type), ['weather', 'todo']);
  assert.deepEqual(home.items.map((i) => i.size), ['m', 's']);
  assert.ok(res.state.categories.some((c) => c.id === 'cat-work'));
  assert.equal(res.state.settings.theme, 'light');

  const storage = memStorage();
  storage.setItem('lumenTab.v1', JSON.stringify(legacy));
  const store = Store({ storage });
  assert.equal(store.get().version, 2);
  assert.equal(store.getCategory('cat-home').items.length, 2);
});

test('store: Dock 动作', () => {
  const store = Store({ storage: memStorage() });
  const n = store.get().shortcuts.length;
  const sc = store.addShortcut({ name: '测试站', url: 'test.com', emoji: '🧪' });
  assert.equal(sc.url, 'https://test.com');
  assert.equal(store.get().shortcuts.length, n + 1);
  store.updateShortcut(sc.id, { name: '改名' });
  assert.equal(store.get().shortcuts.find((s) => s.id === sc.id).name, '改名');
  store.moveShortcut(n, 0);
  assert.equal(store.get().shortcuts[0].id, sc.id);
  store.removeShortcut(sc.id);
  assert.equal(store.get().shortcuts.length, n);
  assert.equal(store.addShortcut({ name: '', url: 'x.com' }), null);
});

test('store: 习惯与倒计时', () => {
  const store = Store({ storage: memStorage() });
  const h = store.addHabit('冥想');
  store.toggleHabitDate(h.id, '2026-10-23');
  assert.deepEqual(store.get().habits.find((x) => x.id === h.id).dates, ['2026-10-23']);
  store.toggleHabitDate(h.id, '2026-10-23');
  assert.deepEqual(store.get().habits.find((x) => x.id === h.id).dates, []);
  const cd = store.addCountdown('项目上线', '2026-12-31', 'countdown');
  assert.ok(cd);
  assert.equal(store.addCountdown('坏日期', '2026-13-99'), null);
  store.removeCountdown(cd.id);
  assert.ok(!store.get().countdowns.some((c) => c.id === cd.id));
});

test('store: 导入导出与校验', () => {
  const store = Store({ storage: memStorage() });
  store.addTodo('导出项');
  const dump = store.exportJSON();
  const res = Store.validateImport(JSON.parse(JSON.stringify(dump)));
  assert.equal(res.ok, true);
  assert.ok(res.state.todos.some((t) => t.text === '导出项'));

  assert.equal(Store.validateImport(null).ok, false);
  assert.equal(Store.validateImport([1, 2, 3]).ok, false);
  assert.equal(Store.validateImport({ foo: 1 }).ok, false);

  const messy = Store.validateImport({
    settings: {},
    layout: [{ type: 'todo', size: 'xl' }, { type: 'todo', size: 'm' }, { type: 'weather', size: 's' }, { nope: 1 }],
    shortcuts: [{ name: 'A', url: 'https://a.com' }, { name: 'B' }],
    todos: 'not-an-array'
  });
  assert.equal(messy.ok, true);
  const messyHome = messy.state.categories.find((c) => c.id === 'cat-home');
  assert.deepEqual(messyHome.items.map((i) => i.type + ':' + i.size), ['todo:m', 'weather:s']);
  assert.equal(messy.state.categories.length, 5);
  assert.equal(messy.state.shortcuts.length, 1);
  assert.ok(Array.isArray(messy.state.todos));
  assert.equal(store.replace({ foo: 1 }).ok, false);
});

test('store: 拒绝危险协议与空分类数据', () => {
  const store = Store({ storage: memStorage() });
  const res = Store.validateImport({
    settings: {},
    shortcuts: [
      { name: '危险', url: 'javascript:alert(1)' },
      { name: '正常', url: 'example.com' }
    ],
    categories: [
      { id: 'c1', name: '测试', emoji: '🧑‍💻', items: [
        { kind: 'site', name: '坏站', url: 'javascript:alert(1)' },
        { kind: 'site', name: '好站', url: 'https://ok.example.com' }
      ] }
    ]
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.shortcuts.map((s) => s.name), ['正常']);
  assert.equal(res.state.shortcuts[0].url, 'https://example.com');
  assert.deepEqual(res.state.categories[0].items.map((i) => i.name), ['好站']);
  assert.equal(res.state.categories[0].emoji, '🧑‍💻');
  const cat = store.get().categories.find((c) => c.items.some((i) => i.kind === 'site'));
  const site = cat.items.find((i) => i.kind === 'site');
  assert.equal(store.updateSite(cat.id, site.id, { url: 'javascript:alert(1)' }), null);
  assert.equal(store.get().categories.find((c) => c.id === cat.id).items.find((i) => i.id === site.id).url, site.url);
});

test('store: 设置与壁纸导入白名单', () => {
  const defaults = D.defaultState(FIXED).settings;
  const res = Store.validateImport({
    settings: {
      theme: 'neon',
      accent: 'nope',
      searchEngine: 'nope',
      weatherSource: 'nope',
      density: 'huge',
      railCollapsed: 'yes',
      openInNewTab: false,
      showSeconds: false,
      name: '  测试用户  ',
      wallpaper: {
        preset: 'not-a-preset',
        image: 'javascript:alert(1)',
        blur: 99,
        dim: -5,
        daily: 'yes'
      }
    },
    categories: [{ id: 'c1', name: '测试', items: [] }]
  });
  assert.equal(res.ok, true);
  const s = res.state.settings;
  assert.equal(s.theme, 'dark');
  assert.equal(s.accent, 'cyan');
  assert.equal(s.searchEngine, 'bing');
  assert.equal(s.weatherSource, 'live', '非法天气源回退实时');
  assert.equal(Store.sanitizeSettings({ ...defaults, weatherSource: 'demo' }, defaults).weatherSource, 'demo');
  assert.equal(s.density, 'cozy');
  assert.equal(s.railCollapsed, false);
  assert.equal(s.openInNewTab, false);
  assert.equal(s.showSeconds, false);
  assert.equal(s.name, '测试用户');
  assert.equal(s.wallpaper.preset, 'aurora');
  assert.equal(s.wallpaper.image, null);
  assert.equal(s.wallpaper.blur, 24);
  assert.equal(s.wallpaper.dim, 0);
  assert.equal(s.wallpaper.daily, false);

  const validImage = 'data:image/png;base64,' + 'A'.repeat(32);
  const ok = Store.validateImport({
    settings: { wallpaper: { preset: 'dusk', image: validImage, blur: 4, dim: 50, daily: true } },
    categories: [{ id: 'c1', name: '测试', items: [] }]
  });
  assert.equal(ok.state.settings.wallpaper.preset, 'dusk');
  assert.equal(ok.state.settings.wallpaper.image, validImage);
  assert.equal(ok.state.settings.wallpaper.daily, true);
});

test('store: 内容集合导入清洗', () => {
  const res = Store.validateImport({
    settings: {},
    categories: [{ id: 'c1', name: '测试', items: [] }],
    todos: [
      { id: 't1', text: '  保留  ', done: true, createdAt: 123 },
      { text: '   ', done: false },
      { nope: 1 }
    ],
    notes: [
      { id: 'n1', title: 'A', body: 'B', updatedAt: 9 },
      { title: 42, body: 123 }
    ],
    countdowns: [
      { id: 'cd1', title: '元旦', date: '2027-01-01', kind: 'countdown' },
      { title: '坏日期', date: '2027/01/01' }
    ],
    habits: [
      { id: 'h1', name: '早起', dates: { '2026-10-20': true, bad: true, '2026-10-21': false } }
    ],
    pomodoro: { focus: 999, rest: 0, mode: 'rest', running: true, endsAt: 0, remaining: -5 },
    aiMessages: [
      { role: 'user', text: '你好', ts: 'x' },
      { role: 'ai', text: '答', reasoning: ' 先想 ', ts: 'y' },
      { text: '   ' }
    ],
    searchHistory: [' 搜索 ', 42, ''],
    water: { date: 'bad', cups: 99 },
    hotSource: 'nope',
    quoteOffset: '3',
    quoteFav: [0, 0, -1, 9999]
  });
  assert.equal(res.ok, true);
  const s = res.state;
  assert.deepEqual(s.todos.map((t) => t.text), ['保留']);
  assert.equal(s.todos[0].done, true);
  assert.equal(s.notes.length, 1);
  assert.equal(s.notes[0].title, 'A');
  assert.deepEqual(s.countdowns.map((c) => c.title), ['元旦']);
  assert.deepEqual(s.habits[0].dates, ['2026-10-20']);
  assert.equal(s.pomodoro.focus, 90);
  assert.equal(s.pomodoro.mode, 'rest');
  assert.equal(s.pomodoro.running, false);
  assert.equal(s.pomodoro.endsAt, null);
  assert.equal(s.aiMessages.length, 2);
  assert.equal(s.aiMessages[0].role, 'user');
  assert.equal(typeof s.aiMessages[0].ts, 'number');
  assert.equal(s.aiMessages[1].reasoning, '先想');
  assert.deepEqual(s.searchHistory, ['搜索']);
  assert.equal(s.water.cups, 20);
  assert.equal(s.hotSource, 'weibo');
  assert.equal(s.quoteOffset, 3);
  assert.deepEqual(s.quoteFav, [0]);
});

test('store: 重置回到默认', () => {
  const store = Store({ storage: memStorage() });
  store.addTodo('临时');
  store.patchSettings({ theme: 'light' });
  store.reset();
  assert.equal(store.get().settings.theme, 'dark');
  assert.ok(!store.get().todos.some((t) => t.text === '临时'));
});

test('store: 无存储时降级不抛错', () => {
  const store = Store({ storage: null });
  assert.equal(store.isPersistent(), false);
  store.addTodo('内存');
  assert.ok(store.get().todos.some((t) => t.text === '内存'));
  assert.equal(store.flush(), false);
});

test('util: AI 接口地址与模型名', () => {
  assert.equal(U.normalizeApiBaseUrl('api.example.com/v1/'), 'https://api.example.com/v1');
  assert.equal(U.normalizeApiBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(U.normalizeApiBaseUrl('localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(U.normalizeApiBaseUrl('javascript:alert(1)'), '');
  assert.equal(U.normalizeApiBaseUrl('https://user:pass@a.com/v1'), '');
  assert.equal(U.normalizeApiBaseUrl('https://a.com/v1?x=1'), '');
  assert.equal(U.normalizeApiBaseUrl('https://a.com/v1/?'), 'https://a.com/v1');
  assert.equal(U.normalizeModelName(' deepseek-chat '), 'deepseek-chat');
  assert.equal(U.normalizeModelName('qwen2.5:7b'), 'qwen2.5:7b');
  assert.equal(U.normalizeModelName('bad model'), '');
  assert.equal(U.normalizeModelName('x\ny'), '');
});

test('store: AI 配置清洗、密钥导出与导入保留', () => {
  const defaults = D.defaultState(FIXED).settings;
  const s = Store.sanitizeSettings({
    ...defaults,
    ai: {
      mode: 'api',
      baseUrl: 'api.example.com/v1/',
      model: 'deepseek-chat',
      apiKey: ' sk-test ',
      instructions: ' 回答先给结论。\n\n再解释。 ',
      temperature: 5,
      maxTokens: 99999
    }
  }, defaults);
  assert.equal(s.ai.mode, 'api');
  assert.equal(s.ai.baseUrl, 'https://api.example.com/v1');
  assert.equal(s.ai.model, 'deepseek-chat');
  assert.equal(s.ai.apiKey, 'sk-test');
  assert.equal(s.ai.instructions, '回答先给结论。\n\n再解释。');
  assert.equal(s.ai.temperature, 2);
  assert.equal(s.ai.maxTokens, 4096);

  const bad = Store.sanitizeSettings({
    ...defaults,
    ai: {
      mode: 'wat', baseUrl: 'javascript:alert(1)', model: 'bad model', apiKey: 'a\nb',
      instructions: 'a\u0000b\u0007c', temperature: -3, maxTokens: 0
    }
  }, defaults);
  assert.equal(bad.ai.mode, 'local');
  assert.equal(bad.ai.baseUrl, '');
  assert.equal(bad.ai.model, '');
  assert.equal(bad.ai.apiKey, '');
  assert.equal(bad.ai.instructions, 'abc');
  assert.equal(bad.ai.temperature, 0);
  assert.equal(bad.ai.maxTokens, 1);

  const long = Store.sanitizeSettings({
    ...defaults,
    ai: { ...defaults.ai, instructions: 'x'.repeat(2100) }
  }, defaults);
  assert.equal(long.ai.instructions.length, 2000);

  const store = Store({ storage: memStorage() });
  store.patchSettings({ ai: {
    mode: 'api', baseUrl: 'https://api.test/v1', model: 'm', apiKey: 'sk-current',
    instructions: '先给结论', temperature: 0.3, maxTokens: 64
  } });
  const backup = store.exportJSON();
  assert.equal(backup.settings.ai.apiKey, '', '导出不应包含 Key');
  assert.equal(backup.settings.ai.instructions, '先给结论');
  store.replace(backup);
  assert.equal(store.get().settings.ai.apiKey, 'sk-current', '导入无 Key 备份应保留本机 Key');
  assert.equal(store.get().settings.ai.model, 'm');
  assert.equal(store.get().settings.ai.instructions, '先给结论');
});

test('ai-api: 地址、SSE 流式、非流式与错误', async () => {
  assert.equal(AIApi.endpointFor('https://api.test/v1'), 'https://api.test/v1/chat/completions');
  assert.equal(AIApi.endpointFor('https://api.test/v1/chat/completions'), 'https://api.test/v1/chat/completions');
  assert.match(AIApi.configError({}), /接口地址/);
  assert.match(AIApi.configError({ baseUrl: 'https://a/v1', model: 'bad model' }), /模型/);

  const config = { baseUrl: 'https://api.test/v1', model: 'mock-1', apiKey: 'sk-x', temperature: 0.5, maxTokens: 128 };
  let captured = null;
  const sse = [
    'data: {"model":"mock-1","choices":[{"delta":{"reasoning_content":"先想"}}]}',
    '',
    'data: {"choices":[{"delta":{"reasoning_content":"一下"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"你好"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"，世界"}}]}',
    '',
    'data: [DONE]',
    ''
  ].join('\n');
  const deltas = [];
  const reasons = [];
  const streamed = await AIApi.chat(config, [{ role: 'user', content: 'hi' }], {
    fetch: async (url, init) => {
      captured = { url, init };
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    },
    onDelta: (p) => deltas.push(p),
    onReasoning: (p) => reasons.push(p)
  });
  assert.equal(streamed.text, '你好，世界');
  assert.equal(streamed.reasoning, '先想一下');
  assert.deepEqual(deltas, ['你好', '，世界']);
  assert.deepEqual(reasons, ['先想', '一下']);
  assert.equal(captured.url, 'https://api.test/v1/chat/completions');
  assert.equal(captured.init.headers.Authorization, 'Bearer sk-x');
  const payload = JSON.parse(captured.init.body);
  assert.equal(payload.model, 'mock-1');
  assert.equal(payload.stream, true);
  assert.equal(payload.temperature, 0.5);
  assert.equal(payload.max_tokens, 128);

  const plain = await AIApi.chat(config, [{ role: 'user', content: 'hi' }], {
    stream: false,
    fetch: async () => new Response(JSON.stringify({
      model: 'mock-1',
      choices: [{ message: { reasoning_content: '想一想', content: '普通回复' } }],
      usage: { total_tokens: 3 }
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal(plain.text, '普通回复');
  assert.equal(plain.reasoning, '想一想');
  assert.equal(plain.usage.total_tokens, 3);

  await assert.rejects(
    () => AIApi.chat(config, [{ role: 'user', content: 'hi' }], {
      stream: false,
      fetch: async () => new Response('{"error":{"message":"bad key"}}', {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    }),
    /401.*bad key/
  );
});

test('ai-api: 内联 think 标签跨 chunk 拆分', async () => {
  const config = { baseUrl: 'https://api.test/v1', model: 'mock-1', apiKey: '' };
  const sse = [
    'data: {"choices":[{"delta":{"content":"开头<thi"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"nk>先想一下</thi"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"nk>正文结束"}}]}',
    '',
    'data: [DONE]',
    ''
  ].join('\n');
  const answerPieces = [];
  const thinkPieces = [];
  const res = await AIApi.chat(config, [{ role: 'user', content: 'hi' }], {
    fetch: async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    onDelta: (p) => answerPieces.push(p),
    onReasoning: (p) => thinkPieces.push(p)
  });
  assert.equal(res.text, '开头正文结束');
  assert.equal(res.reasoning, '先想一下');
  assert.deepEqual(answerPieces, ['开头', '正文结束']);
  assert.deepEqual(thinkPieces, ['先想一下']);

  const plain = await AIApi.chat(config, [{ role: 'user', content: 'hi' }], {
    stream: false,
    fetch: async () => new Response(JSON.stringify({
      choices: [{ message: { content: '  <thinking>思考</thinking>回答  ' } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal(plain.text, '回答');
  assert.equal(plain.reasoning, '思考');
});

test('util: 新标签页打开失败也不替换当前页', () => {
  const oldWindow = globalThis.window;
  const oldLocation = globalThis.location;
  const calls = [];
  const navigated = [];
  globalThis.window = {
    open(url, target, features) {
      calls.push({ url, target, features });
      return null;
    }
  };
  globalThis.location = {};
  Object.defineProperty(globalThis.location, 'href', {
    configurable: true,
    get() { return 'https://current.test/'; },
    set(value) { navigated.push(value); }
  });
  try {
    assert.equal(U.openUrl('https://example.com/search', true), true);
    assert.deepEqual(navigated, [], '不能回退到当前页');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.com/search');
    assert.equal(calls[0].target, '_blank');
    assert.match(calls[0].features, /noopener/);
  } finally {
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
  }
});

test('weather: 实时数据解析、缓存与离线回退', async () => {
  const city = D.CITIES.find((c) => c.id === 'beijing');
  const payload = {
    current: {
      temperature_2m: 18.6,
      relative_humidity_2m: 77,
      weather_code: 61,
      wind_speed_10m: 20,
      wind_direction_10m: 180
    },
    daily: {
      time: ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'],
      weather_code: [61, 0, 3, 71, 95],
      temperature_2m_max: [20.4, 22.1, 19.8, 4.2, 17.6],
      temperature_2m_min: [12.1, 11.8, 10.4, -1.2, 9.5]
    }
  };

  assert.match(Weather.endpointFor(city), /open-meteo\.com.*latitude=39\.9042.*longitude=116\.4074/);
  assert.equal(Weather.conditionFor(61).key, 'rain');
  assert.equal(Weather.conditionFor(0).key, 'sunny');
  assert.equal(Weather.conditionFor(45).key, 'fog');
  assert.equal(Weather.windText(20, 180), '南风 4 级');

  const parsed = Weather.parsePayload(payload, FIXED);
  assert.equal(parsed.current.temp, 19);
  assert.equal(parsed.current.cond.key, 'rain');
  assert.equal(parsed.current.humidity, 77);
  assert.equal(parsed.current.high, 20);
  assert.equal(parsed.current.low, 12);
  assert.equal(parsed.days.length, 5);
  assert.equal(parsed.days[3].fc.cond.key, 'snow');

  let requested = null;
  const fetched = await Weather.fetchWeather(city, {
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  assert.ok(requested.url.includes('open-meteo.com'));
  assert.equal(requested.init.method, 'GET');
  assert.equal(fetched.current.temp, 19);

  const storage = memStorage();
  let calls = 0;
  const live = await Weather.load(city, {
    storage,
    fetch: async () => {
      calls++;
      return new Response(JSON.stringify(payload), { status: 200 });
    }
  });
  assert.equal(live.current.temp, 19);
  assert.equal(calls, 1);
  const cached = await Weather.load(city, {
    storage,
    fetch: async () => { throw new Error('不应该再联网'); }
  });
  assert.equal(cached.current.temp, 19);
  assert.equal(calls, 1, '10 分钟内应命中缓存');

  const raw = JSON.parse(storage.getItem(Weather.CACHE_KEY));
  raw.cities[city.id].ts = Date.now() - 20 * 60 * 1000;
  storage.setItem(Weather.CACHE_KEY, JSON.stringify(raw));
  const stale = await Weather.load(city, {
    storage,
    fetch: async () => { throw new Error('offline'); }
  });
  assert.equal(stale.stale, true);
  assert.match(stale.error.message, /offline/);
});

test('markdown: 标题、强调、链接、列表与表格', () => {
  const html = Markdown.render([
    '# 标题',
    '',
    '这是**粗体**、*斜体*、~~删除~~和 `code`。',
    '',
    '- 第一项',
    '- 第二项',
    '',
    '| 名称 | 数量 |',
    '| :--- | ---: |',
    '| 苹果 | 2 |',
    '',
    '[站点](https://example.com)',
    '',
    '<img src=x onerror=alert(1)>'
  ].join('\n'));
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<del>删除<\/del>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul><li>第一项<\/li><li>第二项<\/li><\/ul>/);
  assert.match(html, /<th class="md-align-left">名称<\/th>/);
  assert.match(html, /<td class="md-align-right">2<\/td>/);
  assert.match(html, /<a href="https:\/\/example\.com\/" target="_blank" rel="noopener noreferrer">站点<\/a>/);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), '原始 HTML 必须转义');
  assert.ok(!html.includes('<img'), '不能执行原始 HTML');
});

test('markdown: 代码块、换行与危险链接', () => {
  const code = Markdown.render('```js\nconst x = "<tag>";\n```');
  assert.match(code, /class="md-code"/);
  assert.match(code, /class="language-js"/);
  assert.match(code, /const x = &quot;&lt;tag&gt;&quot;;/);
  assert.ok(!code.includes('<tag>'));

  const safe = Markdown.render('第一行\n第二行');
  assert.equal(safe, '<p>第一行<br>第二行</p>');

  const danger = Markdown.render('[点我](javascript:alert(1)) [正常](https://a.test/x)');
  assert.ok(!danger.includes('href="javascript:'));
  assert.match(danger, /\[点我\]\(javascript:alert\(1\)\)/);
  assert.match(danger, /href="https:\/\/a\.test\/x"/);
});

test('webtab: 备份识别、转换与清洗', () => {
  const backup = {
    version: '2.2.50',
    platform: 'edge',
    data: {
      'store-icon': {
        icons: [
          {
            id: 'cat-work',
            iconClass: 'icon-keji',
            name: '工作',
            children: [
              {
                type: 'site', id: 'site-github', name: 'GitHub',
                target: 'https://github.com/',
                bgType: 'image', bgImage: 'https://static.example/icon.png'
              },
              {
                type: 'site', id: 'site-example', name: '',
                target: 'https://example.com/a',
                bgType: 'color', bgColor: 'rgba(28, 28, 30, 1)'
              },
              { type: 'site', id: 'site-local', name: '本地文件', target: 'C:/docs/index.html' },
              { type: 'widget', id: 'w-ai', name: 'AI', widgetName: 'widget-chatgpt' }
            ]
          },
          {
            id: 'cat-empty',
            iconClass: 'i:stars-28-outline-bold',
            name: 'AI办公',
            children: [{ type: 'widget', id: 'w-more', name: 'PPT', widgetName: 'widget-aippt' }]
          }
        ],
        dockIdList: ['site-github', 'missing-id']
      },
      'store-setting': {
        followSystem: true,
        theme: 'dark',
        leftBarDisplayStatus: 'hide',
        iconOpenMethod: 'new-tab'
      },
      'store-weather': {
        activeCityId: '101110101',
        addedCity: [{ id: '101110101', name: '西安', lat: '34.34321', lon: '108.93965' }]
      },
      'store-wallpaper': {
        bgType: 'image',
        src: 'https://static.example/wallpaper.jpg',
        blur: 6
      }
    }
  };

  assert.equal(WeTab.isWeTab(backup), true);
  assert.equal(WeTab.isWeTab({ settings: {}, categories: [] }), false);
  assert.equal(WeTab.isWeTab({ data: { 'store-icon': { icons: [] } } }), true);
  assert.equal(WeTab.convert({ data: { 'store-icon': { icons: [] } } }).ok, false);
  assert.equal(WeTab.convert({}).ok, false);

  const res = WeTab.convert(backup);
  assert.equal(res.ok, true);
  assert.equal(res.meta.categories, 2);
  assert.equal(res.meta.sites, 2);
  assert.equal(res.meta.invalidSites, 1);
  assert.equal(res.meta.widgetsSkipped, 2);
  assert.equal(res.meta.emptyCategories, 1);
  assert.equal(res.meta.imageIcons, 1);
  assert.equal(res.meta.dockTotal, 2);
  assert.equal(res.meta.dockImported, 1);
  assert.equal(res.meta.wallpaperImported, false);
  assert.equal(res.meta.wallpaperSkipped, true);
  assert.equal(res.meta.weatherMapped, true);
  assert.equal(res.meta.weatherCity, '西安');

  const checked = Store.validateImport(res.state);
  assert.equal(checked.ok, true);
  const s = checked.state;
  assert.equal(s.categories.length, 2);
  assert.equal(s.categories[0].name, '工作');
  assert.equal(s.categories[0].emoji, '💼');
  assert.equal(s.categories[0].items.length, 2);
  assert.equal(s.categories[0].items[0].name, 'GitHub');
  assert.equal(s.categories[0].items[0].url, 'https://github.com/');
  assert.equal(s.categories[0].items[0].emoji, 'G');
  assert.match(s.categories[0].items[0].color, /^#[0-9a-f]{6}$/);
  assert.equal(s.categories[0].items[1].name, 'example.com');
  assert.equal(s.categories[0].items[1].emoji, 'e');
  assert.equal(s.categories[0].items[1].color, '#1c1c1e');
  assert.equal(s.categories[1].items.length, 0);
  assert.equal(s.settings.theme, 'auto');
  assert.equal(s.settings.railCollapsed, true);
  assert.equal(s.settings.openInNewTab, true);
  assert.equal(s.weatherCity, 'xian');
  assert.equal(s.shortcuts.length, 1);
  assert.equal(s.shortcuts[0].name, 'GitHub');
  assert.equal(s.todos.length, 0, 'WeTab 导入不应带入 Lumen 示例待办');
  assert.equal(Store.sanitizeSettings({ theme: 'auto' }, D.defaultState(FIXED).settings).theme, 'auto');

  assert.equal(WeTab.parseColor('rgba(28, 28, 30, 1)'), '#1c1c1e');
  assert.equal(WeTab.parseColor('rgb(28, 28, 30)'), '#1c1c1e');
  assert.equal(WeTab.parseColor('rgba(28, 28, 30, 0.2)'), null);
  assert.equal(WeTab.parseColor('#abc'), '#aabbcc');
});

test('图标库完整', () => {
  ['sun', 'cloud', 'rain', 'snow', 'settings', 'grid', 'sparkles', 'plus', 'x', 'check', 'search', 'stop'].forEach((n) => {
    assert.ok(Icons.has(n), n);
    assert.ok(Icons.svg(n, 20).includes('<svg'), n);
  });
  assert.ok(Icons.svg('不存在').includes('<svg'));
});

test('扩展清单与资源完整', () => {
  const productDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'product');
  const mf = JSON.parse(fs.readFileSync(path.join(productDir, 'manifest.json'), 'utf8'));

  assert.equal(mf.manifest_version, 3);
  assert.match(mf.name, /Lumen Tab/);
  assert.match(mf.version, /^\d+\.\d+\.\d+$/);
  assert.equal(mf.chrome_url_overrides.newtab, 'index.html');
  assert.ok(fs.existsSync(path.join(productDir, mf.chrome_url_overrides.newtab)));
  Object.entries(mf.icons).forEach(([size, rel]) => {
    const file = path.join(productDir, rel);
    assert.ok(fs.existsSync(file), rel);
    assert.ok(fs.statSync(file).size > 200, size + ' 图标为空');
  });
  assert.equal(mf.permissions.length, 0, '不应申请任何权限');
  assert.ok(Array.isArray(mf.host_permissions), 'API 模式需要 host_permissions');
  assert.ok(mf.host_permissions.some((p) => p.startsWith('https://')), '应允许 https API');

  ['index.html', 'css/base.css', 'css/widgets.css', 'css/pages.css', 'css/panels.css'].forEach((rel) => {
    assert.ok(fs.existsSync(path.join(productDir, rel)), rel);
  });
  ['icons', 'util', 'data', 'store', 'widgets-core', 'widgets-prod', 'search', 'ui', 'pages', 'ai', 'ai-api', 'markdown', 'weather', 'webtab-import', 'app'].forEach((name) => {
    assert.ok(fs.existsSync(path.join(productDir, 'js', name + '.js')), name + '.js');
  });
});

test('外部请求只来自 AI API 与实时天气模块', () => {
  const productDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'product');
  const html = fs.readFileSync(path.join(productDir, 'index.html'), 'utf8');
  assert.ok(!/<script[^>]+src="https?:/i.test(html), '不应远程加载脚本');
  assert.ok(!/<link[^>]+href="https?:/i.test(html), '不应远程加载样式');
  assert.ok(!/<img[^>]+src="https?:/i.test(html), '不应远程加载图片');

  const networkFiles = ['ai-api.js', 'weather.js'];
  const jsDir = path.join(productDir, 'js');
  fs.readdirSync(jsDir).filter((f) => f.endsWith('.js') && !networkFiles.includes(f)).forEach((file) => {
    const code = fs.readFileSync(path.join(jsDir, file), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(code), file + ' 不应调用 fetch');
    assert.ok(!/XMLHttpRequest/.test(code), file + ' 不应使用 XHR');
    assert.ok(!/sendBeacon/.test(code), file + ' 不应上报数据');
    assert.ok(!/new WebSocket/.test(code), file + ' 不应建立 WebSocket');
  });
  const client = fs.readFileSync(path.join(jsDir, 'ai-api.js'), 'utf8');
  assert.match(client, /fetchImpl\(/, 'AI 客户端应通过 fetch 调用接口');
  assert.ok(!/sendBeacon|new WebSocket/.test(client), 'AI 客户端不应使用上报或 WebSocket');
  const weather = fs.readFileSync(path.join(jsDir, 'weather.js'), 'utf8');
  assert.match(weather, /fetchImpl\(/, '天气模块应通过 fetch 获取 Open-Meteo');
  assert.match(weather, /api\.open-meteo\.com/, '天气模块只使用 Open-Meteo');
  assert.ok(!/sendBeacon|new WebSocket/.test(weather), '天气模块不应使用上报或 WebSocket');
});
