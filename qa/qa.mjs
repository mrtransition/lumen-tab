/**
 * Lumen Tab — 统一 CDP QA 脚本
 * 依赖 Node.js 22+（内置 WebSocket）与本机 Edge / Chrome。
 * 用法:
 *   node qa/qa.mjs --mode smoke
 *   node qa/qa.mjs --mode targeted
 *   node qa/qa.mjs --mode full --widths 390,768,1440
 *   node qa/qa.mjs --mode full --shots
 *   node qa/qa.mjs --mode extension
 * 可选:
 *   EDGE_PATH=/path/to/msedge node qa/qa.mjs --mode smoke
 *   QA_REAL_WEATHER=1 node qa/qa.mjs --mode smoke   # 跳过天气 mock，验证真实接口
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);
const EDGE = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!EDGE) {
  console.error('未找到 Edge / Chrome。请安装浏览器，或通过 EDGE_PATH 指定可执行文件。');
  process.exit(1);
}
const PAGE_URL = pathToFileURL(path.join(ROOT, 'product', 'index.html')).href;

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}
const MODE = argValue('mode', 'smoke');
const WIDTHS = argValue('widths', '390,768,1440').split(',').map(Number).filter(Boolean);
const SHOTS = args.includes('--shots');
const EXTENSION = args.includes('--extension') || MODE === 'extension';
const KEEP = args.includes('--keep');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ CDP ------------------------------ */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message + ' ' + (msg.error.data || '')));
        else resolve(msg.result);
        return;
      }
      const key = msg.method;
      const list = this.handlers.get(key) || [];
      list.forEach((fn) => fn(msg.params, msg.sessionId));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 20000);
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function waitForEndpoint(port) {
  for (let i = 0; i < 100; i++) {
    try { return await fetchJSON(`http://127.0.0.1:${port}/json/version`); }
    catch { await sleep(120); }
  }
  throw new Error('DevTools endpoint 未就绪');
}

/* ------------------------------ 断言 ------------------------------ */
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}

/* ------------------------------ 主流程 ------------------------------ */
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-qa-'));
const port = 9300 + Math.floor(Math.random() * 500);
let edge = null;
let ws = null;
let client = null;
let sessionId = null;
const consoleErrors = [];

async function evaluate(expression) {
  const res = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }, sessionId);
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error('页面异常: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
  }
  return res.result.value;
}

async function waitForApp() {
  for (let i = 0; i < 80; i++) {
    try {
      const ready = await evaluate('document.readyState');
      const has = await evaluate('!!(window.LumenApp && window.LumenApp.store)');
      if (ready === 'complete' && has) return true;
    } catch { /* ignore */ }
    await sleep(100);
  }
  throw new Error('页面未完成初始化');
}

async function reload() {
  await client.send('Page.reload', { ignoreCache: true }, sessionId);
  await sleep(250);
  await waitForApp();
}

function cleanup() {
  try {
    if (ws && ws.readyState === 1) ws.close();
  } catch { /* ignore */ }
  if (edge && edge.pid) {
    try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  }
  if (!KEEP) {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function main() {
  if (!fs.existsSync(EDGE)) throw new Error('找不到 Edge: ' + EDGE);
  if (!fs.existsSync(path.join(ROOT, 'product', 'index.html'))) throw new Error('找不到 product/index.html');

  const launchArgs = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ];
  if (EXTENSION) {
    const productDir = path.join(ROOT, 'product');
    launchArgs.splice(1, 0, '--load-extension=' + productDir, '--disable-extensions-except=' + productDir);
  }
  edge = spawn(EDGE, launchArgs, { stdio: 'ignore' });

  const version = await waitForEndpoint(port);
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  client = new CDP(ws);

  const target = await client.send('Target.createTarget', { url: 'about:blank' });
  const attached = await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  sessionId = attached.sessionId;

  client.on('Runtime.exceptionThrown', (params) => {
    const d = params.exceptionDetails || {};
    consoleErrors.push('[exception] ' + (d.exception?.description || d.text || 'unknown'));
  });
  client.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error') return;
    const text = (params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (/favicon|ERR_FILE_NOT_FOUND/i.test(text)) return;
    consoleErrors.push('[console.error] ' + text);
  });
  client.on('Log.entryAdded', (params) => {
    const e = params.entry || {};
    if (e.level !== 'error') return;
    if (/favicon/i.test(e.text || '')) return;
    consoleErrors.push('[log] ' + e.text);
  });

  if (EXTENSION) {
    const tab = await client.send('Target.createTarget', { url: 'chrome://newtab/' });
    const att = await client.send('Target.attachToTarget', { targetId: tab.targetId, flatten: true });
    sessionId = att.sessionId;
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await sleep(1500);
    const info = await evaluate(`(() => ({
      title: document.title,
      url: location.href,
      widgets: document.querySelectorAll('.widget').length,
      app: !!(window.LumenApp && window.LumenApp.store),
      manifest: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getManifest().name : null
    }))()`);
    check('扩展新标签页接管', /Lumen Tab/.test(info.title) && info.url.indexOf('chrome-extension://') === 0, info.url);
    check('扩展内页面已完成渲染', info.widgets === 10 && info.app === true, info.widgets);
    check('扩展清单可读取', /Lumen Tab/.test(info.manifest || ''), info.manifest);
    check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    return finish();
  }

  await client.send('Page.enable', {}, sessionId);
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Log.enable', {}, sessionId);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  }, sessionId);

  // 固定天气接口响应，避免 QA 依赖第三方网络或城市天气变化
  // QA_REAL_WEATHER=1 时不注入 mock，用于手工验证真实 Open-Meteo 连通性
  if (process.env.QA_REAL_WEATHER !== '1') {
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const realFetch = window.fetch;
        window.__weatherCalls = 0;
        window.fetch = function (url) {
          if (String(url).indexOf('api.open-meteo.com') >= 0) {
            window.__weatherCalls++;
            const today = new Date();
            const dates = [0, 1, 2, 3, 4].map(i => {
              const d = new Date(today.getTime() + i * 86400000);
              return d.toISOString().slice(0, 10);
            });
            const payload = {
              current: {
                temperature_2m: 18.6, relative_humidity_2m: 77, weather_code: 61,
                wind_speed_10m: 20, wind_direction_10m: 180
              },
              daily: {
                time: dates,
                weather_code: [61, 0, 3, 71, 95],
                temperature_2m_max: [20.4, 22.1, 19.8, 4.2, 17.6],
                temperature_2m_min: [12.1, 11.8, 10.4, -1.2, 9.5]
              }
            };
            return Promise.resolve(new Response(JSON.stringify(payload), {
              status: 200, headers: { 'content-type': 'application/json' }
            }));
          }
          return realFetch.apply(this, arguments);
        };
      })();`
    }, sessionId);
  }

  await client.send('Page.navigate', { url: PAGE_URL }, sessionId);
  await waitForApp();
  await evaluate('localStorage.clear()');
  await reload();
  await sleep(process.env.QA_REAL_WEATHER === '1' ? 3500 : 180);

  /* ---------------- smoke ---------------- */
  const smoke = await evaluate(`(() => {
    const grid = document.getElementById('widgetsGrid');
    const cards = [...grid.querySelectorAll('.widget')];
    const s = LumenApp.store.get();
    const cat = s.categories.find(c => c.id === s.activeCategory);
    const wx = document.querySelector('.widget[data-type="weather"] .wx');
    const wxSource = document.querySelector('.widget[data-type="weather"] .wx__source');
    return {
      title: document.title,
      cards: cards.length,
      categories: s.categories.length,
      activeId: s.activeCategory,
      activeName: cat.name,
      items: cat.items.length,
      railCount: document.querySelectorAll('.rail__item').length,
      railActive: document.querySelector('.rail__item.is-active') && document.querySelector('.rail__item.is-active').dataset.catId,
      pageHead: document.getElementById('pageHead').textContent.replace(/\\s+/g, ' ').trim(),
      addTile: !!document.querySelector('.tile--add'),
      shortcuts: document.querySelectorAll('.dock__item[data-id]').length,
      types: cards.map(c => c.dataset.type),
      sizes: cards.map(c => c.dataset.size),
      clock: document.getElementById('clock').textContent,
      hero: document.getElementById('heroGreeting').textContent,
      searchEngine: document.getElementById('engineName').textContent,
      persistent: LumenApp.store.isPersistent(),
      theme: document.documentElement.dataset.theme,
      bodyHasIcons: document.querySelectorAll('svg.ico').length,
      widgetRegistry: LumenWidgets.ids().length,
      weatherSource: wx && wx.dataset.source,
      weatherSourceText: wxSource && wxSource.textContent,
      weatherTemp: document.querySelector('.widget[data-type="weather"] .wx__temp') && document.querySelector('.widget[data-type="weather"] .wx__temp').textContent,
      weatherCalls: window.__weatherCalls
    };
  })()`);

  check('页面标题', smoke.title.includes('Lumen Tab'), smoke.title);
  check('渲染 10 个小组件', smoke.cards === 10 && smoke.items === 10, `${smoke.cards} 卡片 / ${smoke.items} 项`);
  check('组件类型齐全', smoke.types.length === 10 && new Set(smoke.types).size === 10, smoke.types.join(','));
  check('侧边栏渲染 5 个分类', smoke.categories === 5 && smoke.railCount === 5, `${smoke.categories} / ${smoke.railCount}`);
  check('侧边栏当前项为主页', smoke.railActive === 'cat-home' && smoke.activeName === '主页', smoke.railActive);
  check('页头显示分类与数量', smoke.pageHead.includes('主页') && smoke.pageHead.includes('组件'), smoke.pageHead);
  check('添加磁贴存在', smoke.addTile === true);
  check('Dock 渲染 8 个图标', smoke.shortcuts === 8, smoke.shortcuts);
  check('时钟已渲染', /^\d{2}:\d{2}/.test(smoke.clock), smoke.clock);
  check('问候语已渲染', smoke.hero.length > 0, smoke.hero);
  check('搜索引擎默认必应', smoke.searchEngine === '必应', smoke.searchEngine);
  check('内联图标已渲染', smoke.bodyHasIcons > 20, smoke.bodyHasIcons);
  check('组件注册表 10 个', smoke.widgetRegistry === 10, smoke.widgetRegistry);
  check('localStorage 可用（file://）', smoke.persistent === true, String(smoke.persistent));
  const weatherOk = process.env.QA_REAL_WEATHER === '1'
    ? smoke.weatherSource === 'live' && /Open-Meteo/.test(smoke.weatherSourceText || '') && /\d+/.test(smoke.weatherTemp || '')
    : smoke.weatherSource === 'live' && /Open-Meteo/.test(smoke.weatherSourceText || '') &&
      /19/.test(smoke.weatherTemp || '') && smoke.weatherCalls > 0;
  check('天气联网获取 Open-Meteo', weatherOk,
    `${smoke.weatherSource}/${smoke.weatherSourceText}/${smoke.weatherTemp}/${smoke.weatherCalls}`);

  if (MODE === 'smoke') {
    check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    return finish();
  }

  /* ---------------- targeted: 待办 ---------------- */
  const todoAdd = await evaluate(`(() => {
    const card = document.querySelector('.widget[data-type="todo"]');
    const input = card.querySelector('.todo__input');
    const before = LumenApp.store.get().todos.length;
    input.value = 'QA 新增待办';
    card.querySelector('.todo__form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const after = LumenApp.store.get().todos.length;
    const first = card.querySelector('.todo__item .todo__text');
    return { before, after, firstText: first && first.textContent, count: card.querySelectorAll('.todo__item').length };
  })()`);
  check('待办：表单新增', todoAdd.after === todoAdd.before + 1, `${todoAdd.before} → ${todoAdd.after}`);
  check('待办：列表首项为新增内容', todoAdd.firstText === 'QA 新增待办', todoAdd.firstText);

  const todoToggle = await evaluate(`(() => {
    const card = document.querySelector('.widget[data-type="todo"]');
    card.querySelector('.todo__item [data-act="toggle"]').click();
    const done = LumenApp.store.get().todos.find(t => t.text === 'QA 新增待办');
    const item = document.querySelector('.widget[data-type="todo"] .todo__item');
    const bar = document.querySelector('.widget[data-type="todo"] [data-role="bar"]');
    return { done: done && done.done, cls: item.className, barWidth: bar.style.width };
  })()`);
  check('待办：勾选完成', todoToggle.done === true && todoToggle.cls.includes('is-done'), todoToggle.cls);
  check('待办：进度条更新', todoToggle.barWidth !== '0%' && todoToggle.barWidth !== '', todoToggle.barWidth);

  const todoDel = await evaluate(`(() => {
    const card = document.querySelector('.widget[data-type="todo"]');
    const item = card.querySelector('.todo__item');
    item.querySelector('[data-act="del"]').click();
    return { exists: LumenApp.store.get().todos.some(t => t.text === 'QA 新增待办') };
  })()`);
  check('待办：删除', todoDel.exists === false);

  /* ---------------- targeted: 设置 / 主题 / 壁纸 ---------------- */
  const themeSwitch = await evaluate(`(async () => {
    document.querySelector('[data-open="settings"]').click();
    await new Promise(r => setTimeout(r, 360));
    const panelOpen = document.getElementById('settingsPanel').classList.contains('is-open');
    document.querySelector('#themeSeg [data-value="light"]').click();
    await new Promise(r => setTimeout(r, 120));
    const light = { theme: document.documentElement.dataset.theme, stored: LumenApp.store.get().settings.theme };
    document.querySelector('#themeSeg [data-value="dark"]').click();
    await new Promise(r => setTimeout(r, 120));
    const dark = document.documentElement.dataset.theme;
    const compact = document.getElementById('compactDensity');
    compact.checked = true;
    compact.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const density = {
      attr: document.documentElement.dataset.density,
      stored: LumenApp.store.get().settings.density,
      row: getComputedStyle(document.querySelector('.widgets')).gridAutoRows
    };
    compact.checked = false;
    compact.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));

    const engineSel = document.getElementById('engineSelect');
    const engineOpts = [...engineSel.options].map(o => o.value);
    const engineValueBefore = engineSel.value;
    const engineOptionBg = getComputedStyle(engineSel.options[0]).backgroundColor;
    const engineScheme = getComputedStyle(engineSel).colorScheme;
    engineSel.value = 'google';
    engineSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const engineChanged = LumenApp.store.get().settings.searchEngine === 'google' &&
      document.getElementById('engineName').textContent === 'Google';
    engineSel.value = engineValueBefore;
    engineSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));

    const wxSel = document.getElementById('weatherSourceSelect');
    const wxValueBefore = wxSel.value;
    const wxCallsBefore = window.__weatherCalls;
    wxSel.value = 'demo';
    wxSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 180));
    const demoWeather = document.querySelector('.widget[data-type="weather"] .wx');
    const demoSource = demoWeather && demoWeather.dataset.source;
    const demoCalls = window.__weatherCalls;
    wxSel.value = 'live';
    wxSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 220));
    const liveWeather = document.querySelector('.widget[data-type="weather"] .wx');
    const liveSource = liveWeather && liveWeather.dataset.source;
    const liveCalls = window.__weatherCalls;

    return {
      panelOpen, light, dark, density,
      densityRestored: document.documentElement.dataset.density,
      engineOpts, engineValueBefore, engineChanged,
      engineOptionBg, engineScheme,
      engineValueAfter: engineSel.value,
      wxValueBefore, demoSource, demoCalls, liveSource, liveCalls, wxCallsBefore
    };
  })()`);
  check('设置面板可打开', themeSwitch.panelOpen === true);
  check('主题切换为浅色生效', themeSwitch.light.theme === 'light' && themeSwitch.light.stored === 'light', JSON.stringify(themeSwitch.light));
  check('主题切回深色', themeSwitch.dark === 'dark');
  check('紧凑布局开关生效', themeSwitch.density.attr === 'compact' && themeSwitch.density.stored === 'compact' && themeSwitch.density.row === '88px', JSON.stringify(themeSwitch.density));
  check('紧凑布局可还原', themeSwitch.densityRestored === 'cozy');
  check('设置默认搜索引擎下拉有选项', themeSwitch.engineOpts.join(',') === 'bing,baidu,google,zhihu,bilibili', themeSwitch.engineOpts.join(','));
  check('设置默认搜索引擎有当前值', themeSwitch.engineValueBefore === 'bing', themeSwitch.engineValueBefore);
  check('设置切换搜索引擎同步搜索栏', themeSwitch.engineChanged === true && themeSwitch.engineValueAfter === 'bing', `${themeSwitch.engineValueAfter}/${themeSwitch.engineChanged}`);
  check('搜索引擎下拉列表使用暗色背景', themeSwitch.engineOptionBg === 'rgb(13, 19, 33)' && /dark/.test(themeSwitch.engineScheme), `${themeSwitch.engineOptionBg} / ${themeSwitch.engineScheme}`);
  check('天气可切换演示/实时', themeSwitch.wxValueBefore === 'live' && themeSwitch.demoSource === 'demo' &&
    themeSwitch.liveSource === 'live' && themeSwitch.demoCalls === themeSwitch.wxCallsBefore &&
    themeSwitch.liveCalls === themeSwitch.demoCalls,
    `${themeSwitch.wxValueBefore} → ${themeSwitch.demoSource}(${themeSwitch.demoCalls}) → ${themeSwitch.liveSource}(${themeSwitch.liveCalls})`);

  const wallpaper = await evaluate(`(async () => {
    const before = LumenApp.store.get().settings.wallpaper.preset;
    document.querySelector('.wallpaper-chip[data-preset="sakura"]').click();
    await new Promise(r => setTimeout(r, 100));
    const after = LumenApp.store.get().settings.wallpaper.preset;
    const bg = document.getElementById('wallpaperImg').style.backgroundImage;
    const dimInput = document.getElementById('dimRange');
    dimInput.value = '55';
    dimInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const dim = LumenApp.store.get().settings.wallpaper.dim;
    const accentBefore = document.documentElement.dataset.accent;
    document.querySelector('.swatch[data-accent="violet"]').click();
    await new Promise(r => setTimeout(r, 80));
    return { before, after, bgLen: bg.length, dim, accentBefore, accentAfter: document.documentElement.dataset.accent };
  })()`);
  check('壁纸切换持久化', wallpaper.after === 'sakura', wallpaper.before + ' → ' + wallpaper.after);
  check('壁纸层已应用渐变', wallpaper.bgLen > 40, wallpaper.bgLen);
  check('暗度滑块生效', wallpaper.dim === 55, wallpaper.dim);
  check('主题色切换生效', wallpaper.accentAfter === 'violet', wallpaper.accentAfter);

  const upload = await evaluate(`(async () => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bytes], 'pixel.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('wallpaperFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 450));
    const w = LumenApp.store.get().settings.wallpaper;
    const isData = !!(w.image && w.image.indexOf('data:image/') === 0);
    const applied = document.getElementById('wallpaperImg').style.backgroundImage.indexOf('data:image/') >= 0;
    const chip = !!document.querySelector('.wallpaper-chip[data-preset="__custom"]');
    LumenApp.store.setWallpaper({ image: null });
    return { isData, applied, chip };
  })()`);
  check('上传壁纸写入状态', upload.isData === true);
  check('上传壁纸应用到背景层', upload.applied === true);
  check('自定义壁纸缩略图出现', upload.chip === true);

  /* ---------------- targeted: 组件尺寸 / 隐藏 / 库 ---------------- */
  const sizeMenu = await evaluate(`(async () => {
    const card = document.querySelector('.widget[data-type="quote"]');
    const before = card.dataset.size;
    card.querySelector('[data-card-act="menu"]').click();
    await new Promise(r => setTimeout(r, 60));
    const items = [...document.querySelectorAll('#ctxMenu .menu__item')];
    const target = items.find(b => b.textContent.includes('中尺寸'));
    const menuVisible = !document.getElementById('ctxMenu').hidden;
    if (target) target.click();
    await new Promise(r => setTimeout(r, 160));
    const card2 = document.querySelector('.widget[data-type="quote"]');
    return { before, after: card2.dataset.size, menuVisible, itemCount: items.length };
  })()`);
  check('卡片菜单打开', sizeMenu.menuVisible === true, sizeMenu.itemCount + ' 项');
  check('切换组件尺寸', sizeMenu.before !== sizeMenu.after, sizeMenu.before + ' → ' + sizeMenu.after);

  const reorder = await evaluate(`(async () => {
    const typesBefore = [...document.querySelectorAll('.widget')].map(c => c.dataset.type);
    const from = typesBefore.indexOf('quote');
    const targetType = typesBefore[from - 1];
    const card = document.querySelector('.widget[data-type="quote"]');
    card.querySelector('[data-card-act="menu"]').click();
    await new Promise(r => setTimeout(r, 60));
    const items = [...document.querySelectorAll('#ctxMenu .menu__item')];
    const move = items.find(b => b.textContent.includes('前移'));
    const disabled = move ? move.disabled : null;
    if (move && !move.disabled) move.click();
    await new Promise(r => setTimeout(r, 180));
    const typesAfter = [...document.querySelectorAll('.widget')].map(c => c.dataset.type);
    const storeState = LumenApp.store.get();
    const stored = storeState.categories.find(c => c.id === storeState.activeCategory).items
      .filter(i => i.kind === 'widget').map(i => i.type);
    return { typesBefore, typesAfter, targetType, disabled, storedMatches: stored.join(',') === typesAfter.join(',') };
  })()`);
  check('组件前移可用', reorder.disabled === false, 'disabled=' + reorder.disabled);
  check('组件顺序变更并持久化',
    reorder.typesAfter.indexOf('quote') === reorder.typesBefore.indexOf('quote') - 1 && reorder.storedMatches,
    reorder.typesAfter.join(','));

  const hideWidget = await evaluate(`(async () => {
    const card = document.querySelector('.widget[data-type="hotlist"]');
    card.querySelector('[data-card-act="menu"]').click();
    await new Promise(r => setTimeout(r, 60));
    const items = [...document.querySelectorAll('#ctxMenu .menu__item')];
    const hide = items.find(b => b.textContent.includes('隐藏此组件'));
    hide.click();
    await new Promise(r => setTimeout(r, 180));
    const afterHide = document.querySelectorAll('.widget').length;
    document.querySelector('[data-open="library"]').click();
    await new Promise(r => setTimeout(r, 120));
    const libOpen = !document.getElementById('libraryModal').hidden;
    const btn = document.querySelector('#libGrid [data-add="hotlist"]');
    btn.click();
    await new Promise(r => setTimeout(r, 180));
    const afterAdd = document.querySelectorAll('.widget').length;
    document.querySelector('#libraryModal [data-close="modal"]').click();
    return { afterHide, afterAdd, libOpen, disabledBefore: btn.disabled };
  })()`);
  check('隐藏组件', hideWidget.afterHide === 9, hideWidget.afterHide);
  check('组件库可打开并加回', hideWidget.libOpen === true && hideWidget.afterAdd === 10, hideWidget.afterAdd);

  /* ---------------- targeted: Dock ---------------- */
  const dock = await evaluate(`(async () => {
    const before = LumenApp.store.get().shortcuts.length;
    document.querySelector('.dock__item--add').click();
    await new Promise(r => setTimeout(r, 120));
    const dialogOpen = !document.getElementById('dialogModal').hidden;
    document.getElementById('scName').value = 'QA 站点';
    document.getElementById('scUrl').value = 'qa.example.com';
    document.getElementById('scForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 180));
    const list = LumenApp.store.get().shortcuts;
    const added = list.find(s => s.name === 'QA 站点');
    const domNames = [...document.querySelectorAll('.dock__item[data-id] .dock__name')].map(e => e.textContent);
    if (added) {
      LumenApp.store.removeShortcut(added.id);
      LumenSearch.renderDock();
    }
    return { before, after: list.length, dialogOpen, url: added && added.url, domNames };
  })()`);
  check('新增站点弹窗', dock.dialogOpen === true);
  check('快捷方式写入状态', dock.after === dock.before + 1 && dock.url === 'https://qa.example.com', dock.url);
  check('Dock DOM 同步', dock.domNames.includes('QA 站点') === true, dock.domNames.slice(-2).join(','));

  const dockOpen = await evaluate(`(async () => {
    const realOpen = window.open;
    const opened = [];
    window.open = (u) => { opened.push(u); return {}; };
    document.querySelector('.dock__item[data-id]').click();
    await new Promise(r => setTimeout(r, 80));
    window.open = realOpen;
    return { opened, expected: LumenApp.store.get().shortcuts[0].url };
  })()`);
  check('点击 Dock 打开对应网站', dockOpen.opened[0] === dockOpen.expected, dockOpen.opened[0]);

  /* ---------------- targeted: 搜索 ---------------- */
  const search = await evaluate(`(async () => {
    const input = document.getElementById('searchInput');
    input.focus();
    input.value = '新标签页';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const suggestVisible = !document.getElementById('suggest').hidden;
    const suggestCount = document.querySelectorAll('#suggest .suggest__item').length;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 60));
    const imeSuggestionKept = !document.getElementById('suggest').hidden;
    const engineBefore = document.getElementById('engineName').textContent;
    document.getElementById('engineBtn').click();
    await new Promise(r => setTimeout(r, 60));
    const menuVisible = !document.getElementById('engineMenu').hidden;
    const menuEl = document.getElementById('engineMenu');
    const menuRect = menuEl.getBoundingClientRect();
    const menuHit = document.elementFromPoint(menuRect.left + menuRect.width / 2, menuRect.bottom - 12);
    const menuBg = getComputedStyle(menuEl).backgroundColor;
    const rgba = menuBg.match(/rgba?\(([^)]+)\)/);
    const bgAlpha = rgba ? (rgba[1].split(',').length === 4 ? Number(rgba[1].split(',')[3]) : 1) : 0;
    const menuHitInside = !!(menuHit && menuEl.contains(menuHit));
    const menuHitInfo = menuHit ? (menuHit.tagName + '.' + (menuHit.className || '')) : 'null';
    document.querySelector('#engineMenu [data-id="baidu"]').click();
    await new Promise(r => setTimeout(r, 120));
    return {
      suggestVisible, suggestCount, imeSuggestionKept, engineBefore,
      menuHitInside,
      menuHitInfo,
      menuBg, bgAlpha,
      engineAfter: document.getElementById('engineName').textContent,
      stored: LumenApp.store.get().settings.searchEngine,
      settingsSelect: document.getElementById('engineSelect').value,
      menuVisible
    };
  })()`);
  check('搜索联想出现', search.suggestVisible === true, search.suggestCount + ' 条');
  check('输入法组合中 Enter 不误选联想', search.imeSuggestionKept === true);
  check('搜索引擎下拉有实体背景且不被下方图标穿透', search.menuHitInside === true && search.bgAlpha > 0.85, `${search.menuBg} / hit=${search.menuHitInfo} / inside=${search.menuHitInside} / alpha=${search.bgAlpha}`);
  check('搜索引擎菜单', search.menuVisible === true);
  check('切换搜索引擎', search.engineAfter === '百度' && search.stored === 'baidu', search.engineAfter);
  check('设置下拉与搜索栏同步', search.settingsSelect === 'baidu', search.settingsSelect);

  const searchOpen = await evaluate(`(async () => {
    const before = location.href;
    const realOpen = window.open;
    const opened = [];
    const targets = [];
    // noopener 窗口返回 null 是规范行为，页面不应因此回退到当前页
    window.open = (u, t, f) => { opened.push(u); targets.push({ target: t, features: f }); return null; };
    const input = document.getElementById('searchInput');
    const form = document.getElementById('searchForm');
    input.value = '新 标签页';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 80));
    input.value = 'example.com';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 80));
    window.open = realOpen;
    return { opened, targets, samePage: location.href === before, history: LumenApp.store.get().searchHistory };
  })()`);
  check('搜索使用当前引擎', (searchOpen.opened[0] || '').startsWith('https://www.baidu.com/s?wd='), searchOpen.opened[0]);
  check('搜索在新标签页打开且保留当前页', searchOpen.samePage === true &&
    searchOpen.targets.every(t => t.target === '_blank' && /noopener/.test(t.features || '')),
    JSON.stringify(searchOpen.targets));
  check('搜索关键词已编码', decodeURIComponent(searchOpen.opened[0] || '').includes('新 标签页'), searchOpen.opened[0]);
  check('输入网址直接跳转', searchOpen.opened[1] === 'https://example.com', searchOpen.opened[1]);
  check('搜索历史记录', searchOpen.history[0] === 'example.com', searchOpen.history.join(','));
  await evaluate(`(() => { const i = document.getElementById('searchInput'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);

  /* ---------------- targeted: 其它组件交互 ---------------- */
  const widgets = await evaluate(`(async () => {
    const out = {};
    // 名句切换
    const q = document.querySelector('.widget[data-type="quote"] .quote__text');
    const qBefore = q.textContent;
    document.querySelector('.widget[data-type="quote"] [data-role="next"]').click();
    await new Promise(r => setTimeout(r, 100));
    out.quoteChanged = q.textContent !== qBefore;
    // 日历翻月
    const monthBefore = document.querySelector('.widget[data-type="calendar"] .cal__month').textContent;
    document.querySelector('.widget[data-type="calendar"] [data-nav="1"]').click();
    await new Promise(r => setTimeout(r, 120));
    out.monthBefore = monthBefore;
    out.monthAfter = document.querySelector('.widget[data-type="calendar"] .cal__month').textContent;
    // 习惯打卡
    const row = document.querySelector('.widget[data-type="habits"] .hb__row');
    const dot = row.querySelector('.hb__dot.is-today');
    const beforeDates = LumenApp.store.get().habits.find(h => h.id === row.dataset.id).dates.length;
    dot.click();
    await new Promise(r => setTimeout(r, 120));
    out.habitBefore = beforeDates;
    out.habitAfter = LumenApp.store.get().habits.find(h => h.id === row.dataset.id).dates.length;
    // 番茄钟
    document.querySelector('.widget[data-type="pomodoro"] [data-role="toggle"]').click();
    await new Promise(r => setTimeout(r, 450));
    out.pomodoroRunning = LumenApp.store.get().pomodoro.running;
    out.pomodoroTime = document.querySelector('.widget[data-type="pomodoro"] [data-role="time"]').textContent;
    document.querySelector('.widget[data-type="pomodoro"] [data-role="toggle"]').click();
    await new Promise(r => setTimeout(r, 200));
    out.pomodoroPaused = !LumenApp.store.get().pomodoro.running;
    document.querySelector('.widget[data-type="pomodoro"] [data-role="reset"]').click();
    // 天气换城市
    const sel = document.querySelector('.widget[data-type="weather"] .wx__city');
    sel.value = 'guangzhou';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    out.weatherCity = LumenApp.store.get().weatherCity;
    out.weatherTemp = document.querySelector('.widget[data-type="weather"] .wx__temp').textContent;
    return out;
  })()`);
  check('名句可切换', widgets.quoteChanged === true);
  check('日历可翻月', widgets.monthBefore !== widgets.monthAfter, widgets.monthAfter);
  check('习惯打卡切换', Math.abs(widgets.habitAfter - widgets.habitBefore) === 1, `${widgets.habitBefore} → ${widgets.habitAfter}`);
  check('番茄钟开始', widgets.pomodoroRunning === true && /^\d{2}:\d{2}$/.test(widgets.pomodoroTime), widgets.pomodoroTime);
  check('番茄钟暂停', widgets.pomodoroPaused === true);
  check('天气切换城市', widgets.weatherCity === 'guangzhou', widgets.weatherTemp);

  const countdown = await evaluate(`(async () => {
    const card = document.querySelector('.widget[data-type="countdown"]');
    const before = LumenApp.store.get().countdowns.length;
    card.querySelector('[data-role="toggle-form"]').click();
    await new Promise(r => setTimeout(r, 80));
    const form = card.querySelector('.cd__form');
    const overflow = card.scrollWidth > card.clientWidth + 1;
    form.querySelector('input[type="text"]').value = 'QA 倒数日';
    form.querySelector('input[type="date"]').value = '2027-06-01';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 140));
    const added = LumenApp.store.get().countdowns.find(c => c.title === 'QA 倒数日');
    const after = LumenApp.store.get().countdowns.length;
    const domTitles = [...document.querySelectorAll('.widget[data-type="countdown"] .cd__title')].map(e => e.textContent);
    if (added) LumenApp.store.removeCountdown(added.id);
    return { before, after, overflow, domTitles };
  })()`);
  check('倒计时：表单不横向溢出', countdown.overflow === false);
  check('倒计时：新增与列表同步', countdown.after === countdown.before + 1 && countdown.domTitles.join('|').includes('QA 倒数日'), countdown.domTitles.join('|'));

  const noteAndHabit = await evaluate(`(async () => {
    const out = {};
    const noteCard = document.querySelector('.widget[data-type="note"]');
    const beforeNotes = LumenApp.store.get().notes.length;
    const ta = noteCard.querySelector('.note__body');
    ta.value = 'QA 自动保存内容';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 750));
    out.saved = LumenApp.store.get().notes.some(n => n.body.indexOf('QA 自动保存内容') >= 0);
    out.meta = noteCard.querySelector('[data-role="meta"]').textContent;
    noteCard.querySelector('[data-role="add"]').click();
    await new Promise(r => setTimeout(r, 150));
    out.notesAfterAdd = LumenApp.store.get().notes.length - beforeNotes;

    // 输入后立刻切换便签，未到防抖时间也不能丢失
    const activeNew = LumenApp.store.get().notes[0];
    ta.value = 'QA 切页前保存';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const tabEls = [...noteCard.querySelectorAll('.note__tab')];
    if (tabEls[1]) tabEls[1].click();
    await new Promise(r => setTimeout(r, 120));
    out.quickSaved = LumenApp.store.get().notes.some(n => n.id === activeNew.id && n.body === 'QA 切页前保存');

    const form = document.querySelector('.widget[data-type="habits"] .hb__foot');
    const hbBefore = LumenApp.store.get().habits.length;
    form.querySelector('input').value = 'QA 习惯';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 150));
    const habits = LumenApp.store.get().habits;
    out.habitBefore = hbBefore;
    out.habitAfter = habits.length;
    out.habitDom = [...document.querySelectorAll('.hb__name')].some(e => e.textContent === 'QA 习惯');
    const added = habits.find(h => h.name === 'QA 习惯');
    if (added) LumenApp.store.removeHabit(added.id);
    return out;
  })()`);
  check('便签自动保存', noteAndHabit.saved === true, noteAndHabit.meta);
  check('便签新建', noteAndHabit.notesAfterAdd === 1, noteAndHabit.notesAfterAdd);
  check('便签切换前自动保存', noteAndHabit.quickSaved === true);
  check('习惯新增并渲染', noteAndHabit.habitAfter === noteAndHabit.habitBefore + 1 && noteAndHabit.habitDom === true, noteAndHabit.habitAfter);

  /* ---------------- targeted: AI ---------------- */
  const ai = await evaluate(`(async () => {
    document.querySelector('[data-open="ai"]').click();
    await new Promise(r => setTimeout(r, 380));
    const panelOpen = document.getElementById('aiPanel').classList.contains('is-open');
    const beforeMsg = LumenApp.store.get().aiMessages.length;
    const beforeTodo = LumenApp.store.get().todos.length;
    const input = document.getElementById('aiInput');
    const realFetch = window.fetch;
    let netCalls = 0;
    window.fetch = (...args) => { netCalls++; return realFetch(...args); };
    input.value = '帮我安排今天';
    document.getElementById('aiForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 900));
    window.fetch = realFetch;
    const msgs = LumenApp.store.get().aiMessages;
    return {
      panelOpen, beforeMsg, afterMsg: msgs.length,
      beforeTodo, afterTodo: LumenApp.store.get().todos.length,
      last: msgs[msgs.length - 1] && msgs[msgs.length - 1].text,
      bubbles: document.querySelectorAll('#aiMessages .msg').length,
      netCalls
    };
  })()`);
  check('AI 面板打开', ai.panelOpen === true);
  check('本地模式不发起网络请求', ai.netCalls === 0, ai.netCalls);
  check('AI 回复追加消息', ai.afterMsg === ai.beforeMsg + 2, `${ai.beforeMsg} → ${ai.afterMsg}`);
  check('AI 生成计划写入待办', ai.afterTodo > ai.beforeTodo, `${ai.beforeTodo} → ${ai.afterTodo}`);
  check('AI 气泡渲染', ai.bubbles === ai.afterMsg, ai.bubbles);

  const aiSummary = await evaluate(`(async () => {
    const before = LumenApp.store.get().aiMessages.length;
    const input = document.getElementById('aiInput');
    input.value = '总结一下我的待办';
    document.getElementById('aiForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 900));
    const msgs = LumenApp.store.get().aiMessages;
    return { txt: msgs[msgs.length - 1].text, count: msgs.length - before };
  })()`);
  check('AI 读取真实待办数据', /待办|还剩|完成/.test(aiSummary.txt), aiSummary.txt.slice(0, 40));
  const aiQuote = await evaluate(`(async () => {
    const prev = document.querySelector('.widget[data-type="quote"] [data-role="prev"]');
    for (let i = 0; i < 3; i++) prev.click();
    const input = document.getElementById('aiInput');
    input.value = '有点焦虑，鼓励我一下';
    document.getElementById('aiForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 700));
    const msgs = LumenApp.store.get().aiMessages;
    return msgs[msgs.length - 1].text;
  })()`);
  check('AI 在负数偏移下仍能引用每日一句', /「.+」/.test(aiQuote) && !/undefined/.test(aiQuote), aiQuote.slice(0, 40));

  const aiApi = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    document.getElementById('aiConfigBtn').click();
    await wait(380);
    const tabActive = document.querySelector('.tab[data-tab="ai"]').getAttribute('aria-selected') === 'true';
    const settingsOpen = document.getElementById('settingsPanel').classList.contains('is-open');

    document.querySelector('#aiModeSeg [data-value="api"]').click();
    setVal('aiBaseUrl', 'https://api.test/v1');
    setVal('aiModel', 'qa-model');
    setVal('aiApiKey', 'sk-qa');
    setVal('aiTemperature', '0.4');
    setVal('aiMaxTokens', '256');
    setVal('aiInstructions', '回答先给结论，控制在三点内。');
    document.getElementById('aiSaveBtn').click();
    await wait(140);
    const saved = JSON.parse(JSON.stringify(LumenApp.store.get().settings.ai));
    const statusAfterSave = document.getElementById('aiConfigStatus').textContent;
    const guide = document.querySelector('.ai-guide');
    const guideVisible = !!guide && guide.offsetParent !== null && /配置说明/.test(guide.textContent) &&
      guide.querySelectorAll('.ai-guide__steps li').length === 4;

    const calls = [];
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body, auth: init.headers.Authorization || '' });
      if (body.stream) {
        const line = obj => 'data: ' + JSON.stringify(obj) + '\\n\\n';
        const sse = line({ model: 'qa-model', choices: [{ delta: { reasoning_content: '先想' } }] }) +
          line({ choices: [{ delta: { reasoning_content: '一下' } }] }) +
          line({ choices: [{ delta: { content: '这是**模型**回复\\n\\n- 第一项\\n- 第二项\\n\\n~~~js\\nconst n = 1 < 2;\\n~~~' } }] }) +
          'data: [DONE]\\n\\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({
        model: 'qa-model',
        choices: [{ message: { content: 'OK' } }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    document.getElementById('aiTestBtn').click();
    await wait(220);
    const testStatus = document.getElementById('aiConfigStatus').textContent;

    document.querySelector('[data-open="ai"]').click();
    await wait(380);
    const modeTag = document.getElementById('aiModeTag').textContent;
    const aiInput = document.getElementById('aiInput');
    aiInput.value = '用配置的模型回答';
    document.getElementById('aiForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(560);
    const msgs = LumenApp.store.get().aiMessages;
    const last = msgs[msgs.length - 1] || {};
    const lastNode = document.querySelector('#aiMessages .msg:last-child');
    const lastThink = lastNode && lastNode.querySelector('.msg__think');
    const lastThinkBody = lastThink && lastThink.querySelector('.msg__think-body');
    const lastThinkSummary = lastThink && lastThink.querySelector('summary');
    const lastBubble = lastNode && lastNode.querySelector('.msg__bubble');
    const mdStrong = lastBubble && lastBubble.querySelector('strong');
    const mdItems = lastBubble ? [...lastBubble.querySelectorAll('li')].map(li => li.textContent) : [];
    const mdCode = lastBubble && lastBubble.querySelector('.md-code code');
    const mdCopyBtn = lastBubble && lastBubble.querySelector('[data-md-copy]');
    const stopHidden = document.getElementById('aiStopBtn').hidden;
    const sendVisible = !document.getElementById('aiSendBtn').hidden;
    const exportKey = LumenApp.store.exportJSON().settings.ai.apiKey;
    const persisted = (JSON.parse(localStorage.getItem('lumenTab.v1') || '{}').settings || {}).ai || {};
    const apiCall = calls.find(c => c.body.stream);
    const pingCall = calls.find(c => !c.body.stream);

    // 新会话：请求没完成时清空，迟到回复不能写回新会话
    let releaseStale;
    window.fetch = () => new Promise(resolve => {
      releaseStale = () => resolve(new Response(
        'data: {"choices":[{"delta":{"content":"旧会话迟到回复"}}]}\\n\\ndata: [DONE]\\n\\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      ));
    });
    aiInput.value = '旧会话的慢请求';
    document.getElementById('aiForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(140);
    const newBtn = document.getElementById('aiNewBtn');
    newBtn.click();
    await wait(100);
    const newConfirmOpen = !document.getElementById('dialogModal').hidden;
    const newConfirmTitle = (document.querySelector('#dialogBox h2') || {}).textContent || '';
    document.querySelector('#confirmForm .primary-btn').click();
    await wait(100);
    const resetImmediately = LumenApp.store.get().aiMessages;
    if (releaseStale) releaseStale();
    await wait(220);
    const afterStale = LumenApp.store.get().aiMessages;
    const newSession = {
      button: !!newBtn,
      confirm: newConfirmOpen,
      title: newConfirmTitle,
      beforeCount: msgs.length,
      afterResetCount: resetImmediately.length,
      afterStaleCount: afterStale.length,
      afterStaleRoles: afterStale.map(m => m.role).join(','),
      dom: document.querySelectorAll('#aiMessages .msg').length,
      input: aiInput.value,
      busy: document.getElementById('aiForm').getAttribute('aria-busy'),
      stopHidden: document.getElementById('aiStopBtn').hidden
    };
    window.fetch = realFetch;

    LumenApp.store.patchSettings({ ai: { mode: 'local', baseUrl: '', model: '', apiKey: '', instructions: '', temperature: 0.7, maxTokens: 800 } });
    document.querySelector('#aiPanel [data-close="panel"]').click();
    await wait(200);

    return {
      tabActive, settingsOpen, saved, statusAfterSave, testStatus, modeTag, guideVisible,
      lastText: last.text, lastRole: last.role, lastReasoning: last.reasoning || '',
      thinkExists: !!lastThink, thinkOpen: lastThink ? lastThink.open : null,
      thinkSummary: lastThinkSummary ? lastThinkSummary.textContent : '',
      thinkText: lastThinkBody ? lastThinkBody.textContent : '',
      mdClass: !!(lastBubble && lastBubble.classList.contains('msg__bubble--md')),
      mdStrong: mdStrong ? mdStrong.textContent : '',
      mdItems,
      mdCode: mdCode ? mdCode.textContent : '',
      mdCopy: !!mdCopyBtn,
      stopHidden, sendVisible, exportKey,
      persistedMode: persisted.mode, persistedModel: persisted.model, persistedKey: persisted.apiKey,
      apiUrl: apiCall && apiCall.url,
      apiModel: apiCall && apiCall.body.model,
      apiAuth: apiCall && apiCall.auth,
      apiHasContext: !!(apiCall && apiCall.body.messages.some(m => m.role === 'system' && m.content.includes('待办'))),
      apiHasInstructions: !!(apiCall && apiCall.body.messages.some(m => m.role === 'system' &&
        m.content.includes('回答先给结论，控制在三点内。'))),
      apiHasUser: !!(apiCall && apiCall.body.messages.some(m => m.role === 'user' && m.content === '用配置的模型回答')),
      pingUrl: pingCall && pingCall.url,
      newSession
    };
  })()`);
  check('AI 设置入口打开 AI 标签', aiApi.tabActive === true && aiApi.settingsOpen === true);
  check('AI 助手配置说明可见', aiApi.guideVisible === true);
  check('AI 配置可保存', aiApi.saved.mode === 'api' && aiApi.saved.model === 'qa-model' &&
    aiApi.saved.baseUrl === 'https://api.test/v1' && aiApi.saved.apiKey === 'sk-qa' &&
    aiApi.saved.instructions === '回答先给结论，控制在三点内。' &&
    aiApi.saved.temperature === 0.4 && aiApi.saved.maxTokens === 256,
    JSON.stringify({ ...aiApi.saved, apiKey: aiApi.saved.apiKey ? '***' : '' }));
  check('AI 配置写入本机存储', aiApi.persistedMode === 'api' && aiApi.persistedModel === 'qa-model' &&
    aiApi.persistedKey === 'sk-qa', `${aiApi.persistedMode}/${aiApi.persistedModel}/${aiApi.persistedKey ? '***' : ''}`);
  check('AI 连接测试走配置接口', /连接成功/.test(aiApi.testStatus) && aiApi.pingUrl === 'https://api.test/v1/chat/completions', aiApi.testStatus);
  check('API 模式徽标显示模型', aiApi.modeTag.includes('qa-model'), aiApi.modeTag);
  check('实际调用使用配置的模型与 Key', aiApi.apiUrl === 'https://api.test/v1/chat/completions' &&
    aiApi.apiModel === 'qa-model' && aiApi.apiAuth === 'Bearer sk-qa',
    `${aiApi.apiUrl} / ${aiApi.apiModel} / ${aiApi.apiAuth}`);
  check('API 请求携带本机上下文与当前问题', aiApi.apiHasContext === true && aiApi.apiHasUser === true);
  check('API 请求携带助手设定', aiApi.apiHasInstructions === true);
  check('API 流式回复写入对话', aiApi.lastRole === 'ai' && aiApi.lastText === '这是**模型**回复\n\n- 第一项\n- 第二项\n\n~~~js\nconst n = 1 < 2;\n~~~', JSON.stringify(aiApi.lastText));
  check('Markdown 粗体、列表与代码块渲染', aiApi.mdClass === true && aiApi.mdStrong === '模型' &&
    aiApi.mdItems.length === 2 && aiApi.mdItems[0] === '第一项' && aiApi.mdItems[1] === '第二项' &&
    aiApi.mdCode === 'const n = 1 < 2;' && aiApi.mdCopy === true,
    `${aiApi.mdStrong}/${aiApi.mdItems.join('|')}/${aiApi.mdCode}`);
  check('API 思考内容单独保存', aiApi.lastReasoning === '先想一下', aiApi.lastReasoning);
  check('思考内容渲染为折叠块', aiApi.thinkExists === true && aiApi.thinkOpen === false &&
    aiApi.thinkSummary.includes('思考过程') && aiApi.thinkText === '先想一下',
    `${aiApi.thinkSummary}/${aiApi.thinkText}`);
  check('生成结束后恢复发送按钮', aiApi.stopHidden === true && aiApi.sendVisible === true);
  check('导出的备份不含 API Key', aiApi.exportKey === '', aiApi.exportKey);
  check('AI 新会话清空当前记录并拒绝迟到回复',
    aiApi.newSession.button === true && aiApi.newSession.confirm === true &&
    /新会话/.test(aiApi.newSession.title) && aiApi.newSession.beforeCount >= 3 &&
    aiApi.newSession.afterResetCount === 1 && aiApi.newSession.afterStaleCount === 1 &&
    aiApi.newSession.afterStaleRoles === 'ai' && aiApi.newSession.dom === 1 &&
    aiApi.newSession.input === '' && aiApi.newSession.busy === 'false' && aiApi.newSession.stopHidden === true,
    JSON.stringify(aiApi.newSession));

  await evaluate(`(() => { document.getElementById('aiPanel').querySelector('[data-close="panel"]').click(); })()`);

  /* ---------------- targeted: 键盘快捷键 ---------------- */
  const keys = await evaluate(`(async () => {
    if (document.activeElement) document.activeElement.blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    const focusedSearch = document.activeElement === document.getElementById('searchInput');
    document.getElementById('searchInput').blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await new Promise(r => setTimeout(r, 320));
    const helpOpen = document.getElementById('settingsPanel').classList.contains('is-open');
    const aboutActive = document.querySelector('.tab[data-tab="about"]').classList.contains('is-active');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 320));
    const closed = !document.getElementById('settingsPanel').classList.contains('is-open');
    return { focusedSearch, helpOpen, aboutActive, closed };
  })()`);
  check('按 / 聚焦搜索', keys.focusedSearch === true);
  check('按 ? 打开快捷键说明', keys.helpOpen === true && keys.aboutActive === true);
  check('Esc 关闭面板', keys.closed === true);

  const cmdk = await evaluate(`(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 360));
    const open = document.getElementById('aiPanel').classList.contains('is-open');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 360));
    return { open, closed: !document.getElementById('aiPanel').classList.contains('is-open') };
  })()`);
  check('Ctrl+K 打开 AI 助手', cmdk.open === true);
  check('Esc 关闭 AI 助手', cmdk.closed === true);

  const locks = await evaluate(`(async () => {
    document.querySelector('[data-open="settings"]').click();
    await new Promise(r => setTimeout(r, 340));
    document.querySelector('[data-open="ai"]').click();
    await new Promise(r => setTimeout(r, 340));
    const duringOpen = document.documentElement.classList.contains('no-scroll');
    document.querySelector('#aiPanel [data-close="panel"]').click();
    await new Promise(r => setTimeout(r, 340));
    return {
      duringOpen,
      lockedAfter: document.documentElement.classList.contains('no-scroll'),
      scrimHidden: document.getElementById('scrim').hidden
    };
  })()`);
  check('面板打开时锁定滚动', locks.duringOpen === true);
  check('面板切换后关闭不残留滚动锁', locks.lockedAfter === false && locks.scrimHidden === true, `locked=${locks.lockedAfter}`);

  /* ---------------- 导入备份 ---------------- */
  const importTest = await evaluate(`(async () => {
    const dump = LumenApp.store.exportJSON();
    dump.settings.theme = 'light';
    dump.todos = [{ id: 'imp-1', text: '来自备份的待办', done: false, createdAt: Date.now() }];
    const file = new File([JSON.stringify(dump)], 'backup.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('importFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const confirmBtn = [...document.querySelectorAll('#dialogBox button')].find(b => b.textContent.trim() === '导入');
    if (confirmBtn) confirmBtn.click();
    await new Promise(r => setTimeout(r, 700));
    const out = {
      confirmShown: !!confirmBtn,
      theme: document.documentElement.dataset.theme,
      accent: document.documentElement.dataset.accent,
      todos: LumenApp.store.get().todos.map(t => t.text),
      domTodo: document.querySelector('.widget[data-type="todo"] .todo__text').textContent,
      cards: document.querySelectorAll('.widget').length
    };
    LumenApp.store.patchSettings({ theme: 'dark' });
    return out;
  })()`);
  check('导入备份前确认', importTest.confirmShown === true);
  check('导入备份：主题生效', importTest.theme === 'light', importTest.theme);
  check('导入备份：数据替换', importTest.todos.join(',') === '来自备份的待办', importTest.todos.join(','));
  check('导入备份：界面同步', importTest.domTodo === '来自备份的待办' && importTest.cards === 10, importTest.domTodo);

  /* ---------------- 导入 WeTab 备份（合成小样本，避免依赖本机文件） ---------------- */
  const webtabImport = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const before = LumenApp.store.exportJSON();
    const backup = {
      version: '2.2.50', branch: 'zh', platform: 'edge',
      data: {
        'store-icon': {
          icons: [
            {
              id: 'wt-cat-a', name: 'WeTab 迁移', iconClass: 'icon-gongju',
              children: [
                {
                  type: 'site', id: 'wt-site-a', name: 'WeTab 示例',
                  target: 'https://example.com/wetab',
                  bgType: 'color', bgColor: 'rgba(28, 28, 30, 1)'
                },
                { type: 'widget', id: 'wt-widget-a', name: 'AI', widgetName: 'widget-chatgpt' }
              ]
            },
            { id: 'wt-cat-b', name: '空分类', iconClass: 'i:stars-28-outline-bold', children: [] }
          ],
          dockIdList: ['wt-site-a']
        },
        'store-setting': { followSystem: true, leftBarDisplayStatus: 'hide', iconOpenMethod: 'new-tab' },
        'store-weather': {
          activeCityId: 'wt-city',
          addedCity: [{ id: 'wt-city', name: '西安', lat: '34.34321', lon: '108.93965' }]
        }
      }
    };

    async function importFile(obj, name) {
      const input = document.getElementById('importFile');
      const dt = new DataTransfer();
      dt.items.add(new File([JSON.stringify(obj)], name, { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(320);
      const dialog = document.getElementById('dialogBox');
      const message = dialog ? (dialog.querySelector('.muted') || {}).textContent || '' : '';
      const confirmBtn = [...document.querySelectorAll('#dialogBox button')].find(b => b.textContent.trim() === '导入');
      if (confirmBtn) confirmBtn.click();
      await wait(720);
      return { shown: !!confirmBtn, message: message };
    }

    const imported = await importFile(backup, 'wetab.data');
    const s = LumenApp.store.get();
    const sites = s.categories.reduce((n, c) => n + c.items.filter(i => i.kind === 'site').length, 0);
    const out = {
      shown: imported.shown,
      message: imported.message,
      categories: s.categories.length,
      sites: sites,
      empty: s.categories.filter(c => !c.items.length).length,
      dock: s.shortcuts.length,
      theme: s.settings.theme,
      rail: s.settings.railCollapsed,
      todos: s.todos.length,
      railDom: document.body.classList.contains('rail-collapsed'),
      railItems: document.querySelectorAll('.rail__item').length
    };
    await importFile(before, 'restore.json');
    out.restoredTodo = LumenApp.store.get().todos.some(t => t.text === '来自备份的待办');
    return out;
  })()`);
  check('WeTab 导入：弹出识别说明', webtabImport.shown === true && /WeTab 备份/.test(webtabImport.message), webtabImport.message);
  check('WeTab 导入：分类 / 网站 / Dock / 空分类',
    webtabImport.categories === 2 && webtabImport.sites === 1 && webtabImport.dock === 1 && webtabImport.empty === 1,
    `${webtabImport.categories}/${webtabImport.sites}/${webtabImport.dock}/${webtabImport.empty}`);
  check('WeTab 导入：主题 / 侧栏 / 不混入示例待办',
    webtabImport.theme === 'auto' && webtabImport.rail === true && webtabImport.railDom === true &&
    webtabImport.railItems === 2 && webtabImport.todos === 0,
    `${webtabImport.theme}/${webtabImport.rail}/${webtabImport.railDom}/${webtabImport.railItems}/${webtabImport.todos}`);
  check('WeTab 导入后可恢复 Lumen 备份', webtabImport.restoredTodo === true);

  /* ---------------- 侧边栏 / 分类页 / 网站 / 文件夹 ---------------- */
  const sidebar = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    const railBtn = name => [...document.querySelectorAll('.rail__item')].find(b => b.textContent.includes(name));
    railBtn('工作').click();
    await wait(220);
    const s1 = LumenApp.store.get();
    const cat1 = s1.categories.find(c => c.id === s1.activeCategory);
    out.activeName = cat1.name;
    out.siteCount = document.querySelectorAll('.tile--site').length;
    out.widgetCount = document.querySelectorAll('.widget').length;
    out.headText = document.getElementById('pageHead').textContent.replace(/\\s+/g, ' ').trim();
    out.firstNames = [...document.querySelectorAll('.tile--site .tile__name')].slice(0, 3).map(e => e.textContent);

    const realOpen = window.open;
    const opened = [];
    window.open = u => { opened.push(u); return {}; };
    document.querySelector('.tile--site').click();
    await wait(60);
    window.open = realOpen;
    out.openedUrl = opened[0];

    document.querySelector('.tile--add').click();
    await wait(60);
    const addSiteItem = [...document.querySelectorAll('#ctxMenu .menu__item')].find(b => b.textContent.includes('添加网站'));
    out.addMenuVisible = !!addSiteItem;
    if (addSiteItem) addSiteItem.click();
    await wait(70);
    document.getElementById('siteName').value = 'QA 网站';
    document.getElementById('siteUrl').value = 'qa-site.example.com';
    document.getElementById('siteEmoji').value = '🧪';
    document.getElementById('siteForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(200);
    const cat2 = LumenApp.store.get().categories.find(c => c.name === '工作');
    out.sitesAfterAdd = cat2.items.filter(i => i.kind === 'site').length;
    out.addedInStore = cat2.items.some(i => i.kind === 'site' && i.name === 'QA 网站');
    out.addedUrl = (cat2.items.find(i => i.name === 'QA 网站') || {}).url;

    const newTile = [...document.querySelectorAll('.tile--site')].find(t => t.textContent.includes('QA 网站'));
    newTile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 320 }));
    await wait(60);
    [...document.querySelectorAll('#ctxMenu .menu__item')].find(b => b.textContent.includes('编辑')).click();
    await wait(70);
    document.getElementById('siteName').value = 'QA 网站2';
    document.getElementById('siteForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(200);
    out.renamed = [...document.querySelectorAll('.tile--site .tile__name')].some(e => e.textContent === 'QA 网站2');

    // 右键菜单上移（键盘可达的排序入口）
    const orderBefore = LumenApp.store.get().categories.find(c => c.name === '工作').items.map(i => i.id);
    const movedId = [...document.querySelectorAll('.tile--site')].find(t => t.textContent.includes('QA 网站2')).dataset.itemId;
    const upMenu = () => [...document.querySelectorAll('#ctxMenu .menu__item')].find(b => b.textContent.trim() === '上移');
    [...document.querySelectorAll('.tile--site')].find(t => t.textContent.includes('QA 网站2'))
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 320 }));
    await wait(60);
    const upBtn = upMenu();
    out.siteMoveEnabled = !!upBtn && !upBtn.disabled;
    if (upBtn) upBtn.click();
    await wait(180);
    const orderAfter = LumenApp.store.get().categories.find(c => c.name === '工作').items.map(i => i.id);
    out.siteMoved = orderAfter.indexOf(movedId) === orderBefore.indexOf(movedId) - 1;

    document.querySelector('.tile--add').click();
    await wait(60);
    [...document.querySelectorAll('#ctxMenu .menu__item')].find(b => b.textContent.includes('新建文件夹')).click();
    await wait(70);
    document.getElementById('textValue').value = 'QA 文件夹';
    document.getElementById('textForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(200);
    out.folderTile = !!document.querySelector('.tile--folder');
    document.querySelector('.tile--folder').click();
    await wait(200);
    out.folderOpen = !document.getElementById('folderModal').hidden;
    out.folderTitle = document.getElementById('folderTitle').textContent;

    document.querySelector('[data-folder-act="add"]').click();
    await wait(90);
    document.getElementById('siteName').value = '文件夹站点';
    document.getElementById('siteUrl').value = 'folder.example.com';
    document.getElementById('siteForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(220);
    const cat3 = LumenApp.store.get().categories.find(c => c.name === '工作');
    const folder = cat3.items.find(i => i.kind === 'folder');
    out.folderSites = folder ? folder.sites.length : -1;
    out.folderDomSites = document.querySelectorAll('#folderSites .fsite').length;

    document.querySelector('[data-folder-act="add"]').click();
    await wait(90);
    out.dialogOverFolder = !document.getElementById('dialogModal').hidden;
    out.dialogZ = Number(getComputedStyle(document.getElementById('dialogModal')).zIndex);
    out.folderZ = Number(getComputedStyle(document.getElementById('folderModal')).zIndex);
    document.querySelector('#siteForm [data-role="cancel"]').click();
    await wait(140);
    out.dialogClosed = document.getElementById('dialogModal').hidden;
    out.folderStillOpen = !document.getElementById('folderModal').hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(140);
    out.folderClosed = document.getElementById('folderModal').hidden;
    return out;
  })()`);
  check('点击侧栏切换到「工作」', sidebar.activeName === '工作', sidebar.activeName);
  check('右侧显示该分类的网站', sidebar.siteCount === 8 && sidebar.widgetCount === 0, `${sidebar.siteCount} 网站 / ${sidebar.widgetCount} 组件`);
  check('页头统计当前分类', sidebar.headText.includes('工作') && sidebar.headText.includes('8 个网站'), sidebar.headText);
  check('点击网站打开链接', sidebar.openedUrl === 'https://github.com', sidebar.openedUrl);
  check('添加网站菜单可用', sidebar.addMenuVisible === true);
  check('添加网站写入状态', sidebar.addedInStore === true && sidebar.addedUrl === 'https://qa-site.example.com', sidebar.addedUrl);
  check('添加网站后网格更新', sidebar.sitesAfterAdd === 9, sidebar.sitesAfterAdd);
  check('右键编辑网站', sidebar.renamed === true);
  check('右键菜单上移网站', sidebar.siteMoveEnabled === true && sidebar.siteMoved === true);
  check('新建文件夹', sidebar.folderTile === true);
  check('打开文件夹弹窗', sidebar.folderOpen === true && sidebar.folderTitle === 'QA 文件夹', sidebar.folderTitle);
  check('文件夹内添加网站', sidebar.folderSites === 1 && sidebar.folderDomSites === 1, `${sidebar.folderSites}/${sidebar.folderDomSites}`);
  check('文件夹内弹窗层级正确', sidebar.dialogOverFolder === true && sidebar.dialogZ > sidebar.folderZ, `${sidebar.dialogZ}/${sidebar.folderZ}`);
  check('取消按钮先关网站弹窗，Esc 再关文件夹', sidebar.dialogClosed === true && sidebar.folderStillOpen === true && sidebar.folderClosed === true);

  const manage = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    const railBtn = name => [...document.querySelectorAll('.rail__item')].find(b => b.textContent.includes(name));

    const src = [...document.querySelectorAll('.tile--site')].find(t => t.textContent.includes('QA 网站2'));
    const target = railBtn('工具');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await wait(260);
    const s = LumenApp.store.get();
    out.movedToTools = s.categories.find(c => c.name === '工具').items.some(i => i.name === 'QA 网站2');
    out.goneFromWork = !s.categories.find(c => c.name === '工作').items.some(i => i.name === 'QA 网站2');

    // 侧栏分类拖拽排序
    const dragCat = railBtn('工具');
    const dropCat = railBtn('娱乐');
    const dt2 = new DataTransfer();
    dragCat.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
    dropCat.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
    dropCat.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
    dragCat.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
    await wait(240);
    out.order = LumenApp.store.get().categories.map(c => c.name);

    document.getElementById('railAdd').click();
    await wait(60);
    [...document.querySelectorAll('#ctxMenu .menu__item')].find(b => b.textContent.includes('新建分类')).click();
    await wait(70);
    document.getElementById('catName').value = 'QA 分类';
    document.getElementById('catEmoji').value = '🧪';
    document.getElementById('catForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(220);
    out.categoriesAfterAdd = LumenApp.store.get().categories.length;
    out.railAfterAdd = document.querySelectorAll('.rail__item').length;
    const activeAfterAdd = LumenApp.store.get().categories.find(c => c.id === LumenApp.store.get().activeCategory);
    out.activeAfterAdd = activeAfterAdd ? activeAfterAdd.name : '';

    railBtn('QA 分类').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 90, clientY: 240 }));
    await wait(60);
    [...document.querySelectorAll('#ctxMenu .menu__item')].find(b => b.textContent.includes('重命名')).click();
    await wait(70);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(80);
    out.categoryEscBlocked = !document.getElementById('dialogModal').hidden;
    document.getElementById('dialogModal').click();
    await wait(80);
    out.categoryBackdropBlocked = !document.getElementById('dialogModal').hidden;
    document.getElementById('catName').value = 'QA 分类2';
    document.getElementById('catForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(220);
    out.renamedCategory = LumenApp.store.get().categories.some(c => c.name === 'QA 分类2');
    out.railLabel = (railBtn('QA 分类2') || {}).textContent;

    document.querySelector('[data-open="settings"]').click();
    await wait(320);
    document.querySelector('.tab[data-tab="categories"]').click();
    await wait(140);
    out.categoryRows = document.querySelectorAll('#settingsCategoryList .cat-row').length;
    const qaRow = [...document.querySelectorAll('#settingsCategoryList .cat-row')].find(r => r.textContent.includes('QA 分类2'));
    qaRow.querySelector('[data-cat-del]').click();
    await wait(140);
    const confirmBtn = [...document.querySelectorAll('#dialogBox button')].find(b => b.textContent.includes('删除分类'));
    out.confirmShown = !!confirmBtn;
    if (confirmBtn) confirmBtn.click();
    await wait(320);
    out.categoriesAfterDelete = LumenApp.store.get().categories.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(220);

    // 新建分类会切到新页，删除后回到其他分类；继续在「工作」验证组件库
    railBtn('工作').click();
    await wait(180);

    document.querySelector('[data-rail-toggle]').click();
    await wait(140);
    out.collapsed = document.body.classList.contains('rail-collapsed');
    out.railDisplay = getComputedStyle(document.getElementById('rail')).display;
    document.querySelector('[data-rail-toggle]').click();
    await wait(140);
    out.expanded = !document.body.classList.contains('rail-collapsed');

    document.querySelector('[data-open="library"]').click();
    await wait(160);
    const libBtn = document.querySelector('#libGrid [data-add="weather"]');
    out.libEnabled = !!libBtn && !libBtn.disabled;
    libBtn.click();
    await wait(220);
    const s2 = LumenApp.store.get();
    out.widgetInWork = s2.categories.find(c => c.name === '工作').items.some(i => i.kind === 'widget' && i.type === 'weather');
    out.widgetDom = !!document.querySelector('.widget[data-type="weather"]');
    document.querySelector('#libraryModal [data-close="modal"]').click();
    await wait(140);
    return out;
  })()`);
  check('拖到侧栏跨分类移动', manage.movedToTools === true && manage.goneFromWork === true);
  check('拖拽调整分类顺序', manage.order.slice(0, 4).join(',') === '主页,工作,工具,娱乐', manage.order.join(','));
  check('新建分类', manage.categoriesAfterAdd === 6 && manage.railAfterAdd === 6, `${manage.categoriesAfterAdd}/${manage.railAfterAdd}`);
  check('新建分类自动切换', manage.activeAfterAdd === 'QA 分类', manage.activeAfterAdd);
  check('重命名分类', manage.renamedCategory === true, manage.railLabel);
  check('分类弹窗同样只能点按钮关闭', manage.categoryEscBlocked === true && manage.categoryBackdropBlocked === true);
  check('设置里列出分类', manage.categoryRows === 6, manage.categoryRows);
  check('设置里删除分类', manage.confirmShown === true && manage.categoriesAfterDelete === 5, manage.categoriesAfterDelete);
  check('收起侧栏', manage.collapsed === true && manage.railDisplay === 'none', manage.railDisplay);
  check('再次展开侧栏', manage.expanded === true);
  check('组件库可加到网站分类', manage.libEnabled === true && manage.widgetInWork === true && manage.widgetDom === true);

  /* ---------------- UI / 交互审计 ---------------- */
  const audit = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    const railBtn = [...document.querySelectorAll('.rail__item')].find(b => b.textContent.includes('工作'));

    // 侧栏悬浮标签不被滚动容器裁剪
    railBtn.focus();
    await wait(90);
    const tip = document.querySelector('.rail-tip');
    const tr = tip.getBoundingClientRect();
    out.tipVisible = !tip.hidden && tip.textContent === '工作';
    out.tipParentBody = tip.parentElement === document.body;
    out.tipInside = tr.left >= 0 && tr.top >= 0 && tr.right <= window.innerWidth + 1 && tr.bottom <= window.innerHeight + 1;
    out.tipDisplay = getComputedStyle(tip).display !== 'none';
    railBtn.blur();
    await wait(90);
    out.tipHidden = tip.hidden;

    // 菜单：贴近右下角也不出界，内部可滚动，键盘可用
    const trigger = document.querySelector('.tile--site') || railBtn;
    trigger.focus();
    LumenUI.menu({
      x: window.innerWidth, y: window.innerHeight,
      items: Array.from({ length: 60 }, (_, i) => ({ label: '审计项 ' + i, onClick: function () {} }))
    });
    await wait(80);
    const menu = document.getElementById('ctxMenu');
    const mr = menu.getBoundingClientRect();
    out.menuInside = mr.left >= 0 && mr.top >= 0 && mr.right <= window.innerWidth + 1 && mr.bottom <= window.innerHeight + 1;
    out.menuScrollable = getComputedStyle(menu).overflowY === 'auto' && menu.scrollHeight > menu.clientHeight;
    out.menuFocused = document.activeElement === menu;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await wait(50);
    out.menuArrow = document.activeElement.classList.contains('menu__item');
    menu.scrollTop = 80;
    await wait(80);
    out.menuAfterInnerScroll = !menu.hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(80);
    out.menuClosed = menu.hidden;
    out.menuFocusRestored = document.activeElement === trigger;

    // 键盘触发右键菜单时，菜单出现在元素附近而不是左上角
    trigger.focus();
    trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
    await wait(80);
    const kbRect = document.getElementById('ctxMenu').getBoundingClientRect();
    out.kbMenuNear = !document.getElementById('ctxMenu').hidden && kbRect.top > 40 && kbRect.left > 8;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(80);

    // 网站弹窗必须点取消/添加/保存才会关闭：Esc 与点背景都不应关闭
    const addBtn = document.querySelector('.tile--add');
    addBtn.focus();
    addBtn.click();
    await wait(70);
    const addSiteItem = [...document.querySelectorAll('#ctxMenu .menu__item')].find(b => b.textContent.includes('添加网站'));
    addSiteItem.click();
    await wait(100);
    out.dialogOpen = !document.getElementById('dialogModal').hidden;
    out.colorActive = document.querySelectorAll('#siteColorQuick .color-dot.is-active').length;
    const colorDot = document.querySelectorAll('#siteColorQuick .color-dot')[3];
    colorDot.click();
    out.colorPicked = document.getElementById('siteColor').value === colorDot.dataset.color;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(100);
    out.dialogEscBlocked = !document.getElementById('dialogModal').hidden;
    document.getElementById('dialogModal').click();
    await wait(100);
    out.dialogBackdropBlocked = !document.getElementById('dialogModal').hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(100);
    out.dialogShortcutBlocked = !document.getElementById('dialogModal').hidden &&
      !document.getElementById('aiPanel').classList.contains('is-open');
    document.querySelector('#siteForm [data-role="cancel"]').click();
    await wait(120);
    out.dialogClosed = document.getElementById('dialogModal').hidden;
    out.focusBack = document.activeElement === addBtn;

    // 危险协议在表单层就被拒绝
    addBtn.click();
    await wait(70);
    [...document.querySelectorAll('#ctxMenu .menu__item')].find(b => b.textContent.includes('添加网站')).click();
    await wait(110);
    document.getElementById('siteName').value = '危险站点';
    document.getElementById('siteUrl').value = 'javascript:alert(1)';
    document.querySelector('#siteForm .primary-btn').click();
    await wait(120);
    out.jsDialogOpen = !document.getElementById('dialogModal').hidden;
    out.jsError = (document.querySelector('#siteForm [data-role="error"]').textContent || '').includes('http');
    out.jsNotAdded = !LumenApp.store.get().categories.some(c => c.items.some(i => i.name === '危险站点'));
    document.querySelector('#siteForm [data-role="cancel"]').click();
    await wait(120);

    // Tab 焦点限制在弹窗内
    addBtn.click();
    await wait(70);
    [...document.querySelectorAll('#ctxMenu .menu__item')].find(b => b.textContent.includes('添加网站')).click();
    await wait(120);
    const submit = document.querySelector('#siteForm .primary-btn');
    submit.focus();
    submit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await wait(60);
    out.dialogTabTrap = document.getElementById('dialogBox').contains(document.activeElement) && document.activeElement !== submit;
    document.querySelector('#siteForm [data-role="cancel"]').click();
    await wait(120);

    // 组件库 Tab 循环 + 关闭回焦
    addBtn.focus();
    LumenUI.openLibrary();
    await wait(180);
    const libModal = document.getElementById('libraryModal');
    const libFocus = libModal.querySelectorAll('button:not([disabled])');
    const libLast = libFocus[libFocus.length - 1];
    libLast.focus();
    libLast.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await wait(60);
    out.libTabTrap = libModal.querySelector('.modal__box').contains(document.activeElement) && document.activeElement !== libLast;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(160);
    out.libClosed = libModal.hidden;
    out.libFocusBack = document.activeElement === addBtn;

    // 设置面板 Tab 循环
    LumenUI.openPanel('settings');
    await wait(200);
    const settingsPanel = document.getElementById('settingsPanel');
    const sFocus = [...settingsPanel.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter(el => el.getClientRects().length);
    const sLast = sFocus[sFocus.length - 1];
    sLast.focus();
    sLast.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await wait(60);
    out.panelTabTrap = settingsPanel.contains(document.activeElement) && document.activeElement !== sLast;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(160);
    out.settingsClosed = !settingsPanel.classList.contains('is-open');

    // 文件夹：点击背景关闭、焦点回落；打开面板时先关文件夹
    const folderTile = document.querySelector('.tile--folder');
    folderTile.focus();
    folderTile.click();
    await wait(180);
    out.folderOpen = !document.getElementById('folderModal').hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    await wait(80);
    out.slashBlocked = document.activeElement.id !== 'searchInput';
    document.getElementById('folderModal').click();
    await wait(160);
    out.folderBackdropClosed = document.getElementById('folderModal').hidden;
    out.folderFocusBack = document.activeElement === folderTile;
    folderTile.click();
    await wait(140);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(220);
    out.folderClosedByPanel = document.getElementById('folderModal').hidden;
    out.aiOpen = document.getElementById('aiPanel').classList.contains('is-open');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(180);

    // 没有浮层时 / 仍能聚焦搜索
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    await wait(90);
    out.slashWorks = document.activeElement.id === 'searchInput';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    // 浮层打开时 ? 不应越过当前浮层打开帮助
    document.querySelector('[data-open="settings"]').click();
    await wait(340);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
    await wait(120);
    out.questionIgnored = document.getElementById('settingsPanel').classList.contains('is-open') &&
      !document.querySelector('.tab[data-tab="about"]').classList.contains('is-active');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(200);

    // Esc 关闭搜索引擎菜单
    document.getElementById('engineBtn').click();
    await wait(80);
    out.engineOpen = !document.getElementById('engineMenu').hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(100);
    out.engineClosed = document.getElementById('engineMenu').hidden &&
      document.getElementById('engineBtn').getAttribute('aria-expanded') === 'false';

    // 文件夹已满时拖动不应丢失原网站
    const cat = LumenApp.store.get().categories.find(c => c.name === '工作');
    const siteBefore = cat.items.find(i => i.kind === 'site');
    const orig = LumenApp.store.addSiteToFolder;
    LumenApp.store.addSiteToFolder = function () { return null; };
    const src = document.querySelector('.tile--site[data-item-id="' + siteBefore.id + '"]');
    const tgt = document.querySelector('.tile--folder');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await wait(180);
    LumenApp.store.addSiteToFolder = orig;
    out.siteKept = LumenApp.store.get().categories.find(c => c.name === '工作').items.some(i => i.id === siteBefore.id);
    out.fullToast = !!Array.from(document.querySelectorAll('.toast')).find(t => t.textContent.includes('文件夹已满'));

    // 组件拖动把手：单击后不应一直可拖拽
    const home = [...document.querySelectorAll('.rail__item')].find(b => b.textContent.includes('主页'));
    home.click();
    await wait(200);
    const card = document.querySelector('.widget');
    const grip = card.querySelector('.widget__grip');
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await wait(60);
    out.gripReleased = card.getAttribute('draggable') === 'false';
    return out;
  })()`);
  check('侧栏提示浮层不被裁剪', audit.tipVisible === true && audit.tipParentBody === true && audit.tipInside === true && audit.tipDisplay === true, JSON.stringify({ visible: audit.tipVisible, inside: audit.tipInside }));
  check('侧栏提示失焦隐藏', audit.tipHidden === true);
  check('菜单贴近边缘不出界', audit.menuInside === true);
  check('长菜单可滚动且滚动不关闭', audit.menuScrollable === true && audit.menuAfterInnerScroll === true);
  check('菜单支持键盘导航', audit.menuFocused === true && audit.menuArrow === true);
  check('Esc 关闭菜单并回焦', audit.menuClosed === true && audit.menuFocusRestored === true);
  check('键盘右键菜单靠近元素', audit.kbMenuNear === true);
  check('弹窗取消后焦点回到触发点', audit.dialogOpen === true && audit.dialogClosed === true && audit.focusBack === true);
  check('分类/网站弹窗只能点按钮关闭', audit.dialogEscBlocked === true && audit.dialogBackdropBlocked === true &&
    audit.dialogShortcutBlocked === true);
  check('颜色快捷选择有选中态', audit.colorActive === 1 && audit.colorPicked === true);
  check('弹窗拒绝危险协议', audit.jsDialogOpen === true && audit.jsError === true && audit.jsNotAdded === true);
  check('弹窗内 Tab 焦点循环', audit.dialogTabTrap === true);
  check('组件库 Tab 循环并回焦', audit.libTabTrap === true && audit.libClosed === true && audit.libFocusBack === true);
  check('设置面板 Tab 循环', audit.panelTabTrap === true && audit.settingsClosed === true);
  check('文件夹背景点击关闭并回焦', audit.folderOpen === true && audit.folderBackdropClosed === true && audit.folderFocusBack === true);
  check('浮层打开时 / 不抢焦点', audit.slashBlocked === true && audit.slashWorks === true);
  check('浮层打开时 ? 不越过当前浮层', audit.questionIgnored === true);
  check('Esc 关闭搜索引擎菜单', audit.engineOpen === true && audit.engineClosed === true);
  check('打开面板时先关文件夹', audit.folderClosedByPanel === true && audit.aiOpen === true);
  check('满文件夹拖入不丢网站', audit.siteKept === true && audit.fullToast === true);
  check('拖动把手单击后释放', audit.gripReleased === true);

  /* ---------------- 持久化 ---------------- */
  await evaluate(`(() => {
    const s = LumenApp.store.get();
    const work = s.categories.find(c => c.name === '工作');
    LumenApp.store.addSite(work.id, { name: '持久化站点', url: 'persist.example.com', emoji: '💾', color: '#10b981' });
    LumenApp.store.setActiveCategory(work.id);
    LumenApp.store.addTodo('QA 持久化测试');
    LumenApp.store.flush();
  })()`);
  await reload();
  const persisted = await evaluate(`(() => {
    const s = LumenApp.store.get();
    const cat = s.categories.find(c => c.id === s.activeCategory);
    return {
      todo: s.todos.some(t => t.text === 'QA 持久化测试'),
      theme: s.settings.theme,
      accent: document.documentElement.dataset.accent,
      wallpaper: s.settings.wallpaper.preset,
      searchEngine: s.settings.searchEngine,
      activeName: cat.name,
      categories: s.categories.length,
      hasSite: cat.items.some(i => i.name === '持久化站点'),
      hasFolder: cat.items.some(i => i.kind === 'folder'),
      widgets: cat.items.filter(i => i.kind === 'widget').length,
      siteTiles: document.querySelectorAll('.tile--site').length,
      cards: document.querySelectorAll('.widget').length
    };
  })()`);
  check('刷新后待办保留', persisted.todo === true);
  check('刷新后外观设置保留', persisted.accent === 'violet' && persisted.wallpaper === 'sakura', `${persisted.accent}/${persisted.wallpaper}`);
  check('刷新后搜索设置保留', persisted.searchEngine === 'baidu', persisted.searchEngine);
  check('刷新后分类与网站保留', persisted.activeName === '工作' && persisted.categories === 5 && persisted.hasSite === true && persisted.hasFolder === true, `${persisted.activeName}/${persisted.categories}`);
  check('刷新后分类内组件保留', persisted.widgets === 1 && persisted.cards === 1, `${persisted.widgets}/${persisted.cards}`);

  await evaluate(`(() => {
    const home = [...document.querySelectorAll('.rail__item')].find(b => b.textContent.includes('主页'));
    home.click();
  })()`);
  await sleep(260);
  const homeAgain = await evaluate(`(() => ({
    active: LumenApp.store.get().activeCategory,
    cards: document.querySelectorAll('.widget').length,
    sites: document.querySelectorAll('.tile--site').length
  }))()`);
  check('切回主页恢复 10 个组件', homeAgain.active === 'cat-home' && homeAgain.cards === 10 && homeAgain.sites === 0, `${homeAgain.cards}/${homeAgain.sites}`);

  if (MODE === 'targeted') {
    check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    return finish();
  }

  /* ---------------- full: 响应式 ---------------- */
  const layoutReport = [];
  for (const width of WIDTHS) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width, height: width < 600 ? 780 : 900, deviceScaleFactor: 1, mobile: width < 600
    }, sessionId);
    await sleep(320);
    const info = await evaluate(`(() => {
      const doc = document.documentElement;
      const grid = document.getElementById('widgetsGrid');
      const cards = [...document.querySelectorAll('.widget')];
      const overflowing = cards.filter(c => {
        const r = c.getBoundingClientRect();
        return r.right > window.innerWidth + 1 || r.left < -1 || r.width < 100;
      }).length;
      const search = document.querySelector('.searchbar').getBoundingClientRect();
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      // 不允许滚动的组件：正文内容不能被裁切
      const fixedTypes = ['weather', 'quote', 'calendar', 'countdown', 'year-progress', 'pomodoro'];
      const clipped = [];
      document.querySelectorAll('.widget').forEach(card => {
        if (!fixedTypes.includes(card.dataset.type)) return;
        const body = card.querySelector('.widget__body');
        if (body.scrollHeight > body.clientHeight + 4) {
          clipped.push(card.dataset.type + ':' + (body.scrollHeight - body.clientHeight));
        }
      });
      return {
        scrollWidth: doc.scrollWidth,
        innerWidth: window.innerWidth,
        overflowX: doc.scrollWidth > window.innerWidth + 1,
        cards: cards.length,
        cols,
        overflowing,
        clipped,
        searchWidth: Math.round(search.width),
        searchRight: Math.round(search.right),
        dockVisible: document.querySelectorAll('.dock__item').length,
        firstCardHeight: Math.round(cards[0].getBoundingClientRect().height)
      };
    })()`);
    layoutReport.push({ width, ...info });
    check(`${width}px 无横向溢出`, info.overflowX === false, `scrollWidth=${info.scrollWidth} viewport=${info.innerWidth}`);
    check(`${width}px 卡片全部在视口内`, info.overflowing === 0, info.overflowing);
    check(`${width}px 组件内容无裁切`, info.clipped.length === 0, info.clipped.join(', '));
    check(`${width}px 搜索框可见`, info.searchWidth > 200 && info.searchRight <= info.innerWidth + 1, info.searchWidth + 'px');
    if (width <= 640) check(`${width}px 组件占满三列`, info.cols === 3, info.cols + ' 列');
  }

  /* ---------------- full: 分类页（网站 / 文件夹）响应式 ---------------- */
  await evaluate(`(() => {
    const work = [...document.querySelectorAll('.rail__item')].find(b => b.textContent.includes('工作'));
    work.click();
  })()`);
  await sleep(280);

  const tileReport = [];
  for (const width of WIDTHS) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width, height: width < 600 ? 780 : 900, deviceScaleFactor: 1, mobile: width < 600
    }, sessionId);
    await sleep(320);
    const info = await evaluate(`(() => {
      const doc = document.documentElement;
      const rail = document.getElementById('rail');
      const railRect = rail.getBoundingClientRect();
      const tiles = [...document.querySelectorAll('.tile')];
      const overflowing = tiles.filter(t => {
        const r = t.getBoundingClientRect();
        return r.right > window.innerWidth + 1 || r.left < -1 || r.width < 60;
      }).length;
      const head = document.getElementById('pageHead').getBoundingClientRect();
      const labels = [...document.querySelectorAll('.rail__label')].map(l => {
        const cs = getComputedStyle(l);
        const r = l.getBoundingClientRect();
        return { opacity: Number(cs.opacity), width: Math.round(r.width), visible: cs.display !== 'none' };
      });
      const folder = document.querySelector('.tile--folder');
      return {
        scrollWidth: doc.scrollWidth,
        innerWidth: window.innerWidth,
        overflowX: doc.scrollWidth > window.innerWidth + 1,
        tiles: tiles.length,
        sites: document.querySelectorAll('.tile--site').length,
        overflowing,
        rail: { left: Math.round(railRect.left), top: Math.round(railRect.top), width: Math.round(railRect.width), right: Math.round(railRect.right) },
        railDir: getComputedStyle(rail).flexDirection,
        headVisible: head.height > 0 && head.left >= 0 && head.right <= window.innerWidth + 1,
        labels,
        folder: folder ? { w: Math.round(folder.getBoundingClientRect().width), h: Math.round(folder.getBoundingClientRect().height) } : null,
        folderModalHidden: document.getElementById('folderModal').hidden
      };
    })()`);
    tileReport.push({ width, ...info });
    check(`${width}px 分类页无横向溢出`, info.overflowX === false, `scrollWidth=${info.scrollWidth}`);
    check(`${width}px 网站磁贴不溢出`, info.overflowing === 0 && info.tiles >= 9, `${info.tiles} 磁贴 / ${info.overflowing} 溢出`);
    check(`${width}px 侧栏在视口内`, info.rail.left >= -1 && info.rail.right <= info.innerWidth + 1 && info.rail.width > 0, JSON.stringify(info.rail));
    check(`${width}px 页头可见`, info.headVisible === true);
    check(`${width}px 文件夹磁贴可见`, info.folder && info.folder.w > 60 && info.folder.h > 60, JSON.stringify(info.folder));
    if (width <= 900) {
      check(`${width}px 侧栏横向排列`, info.railDir === 'row', info.railDir);
      const labelsOk = info.labels.length > 0 && info.labels.every(l => l.visible && l.opacity > 0.9 && l.width > 10);
      check(`${width}px 分类名称常显`, labelsOk === true, JSON.stringify(info.labels.slice(0, 3)));
    } else {
      check(`${width}px 侧栏纵向排列`, info.railDir === 'column', info.railDir);
    }
  }

  await evaluate(`(() => {
    const home = [...document.querySelectorAll('.rail__item')].find(b => b.textContent.includes('主页'));
    home.click();
  })()`);
  await sleep(260);

  /* ---------------- full: 截图 ---------------- */
  if (SHOTS) {
    // 截图使用干净的首屏状态，不保留交互测试产生的数据
    await evaluate('localStorage.clear()');
    await reload();
    await sleep(400);
    const shotsDir = path.join(ROOT, 'docs');
    fs.mkdirSync(shotsDir, { recursive: true });
    for (const [name, width, height] of [['preview-desktop', 1440, 1000], ['preview-mobile', 390, 844]]) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width < 600
      }, sessionId);
      await evaluate('window.scrollTo(0, 0)');
      await sleep(400);
      const shot = await client.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      fs.writeFileSync(path.join(shotsDir, name + '.png'), Buffer.from(shot.data, 'base64'));
      console.log('SHOT  docs/' + name + '.png');
    }
  }

  /* ---------------- full: 主题对比度 ---------------- */
  const contrast = await evaluate(`(() => {
    const avg = (rgb) => { const m = rgb.match(/\\d+/g); return m ? (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3 : -1; };
    const read = () => ({
      theme: document.documentElement.dataset.theme,
      text: avg(getComputedStyle(document.body).color),
      card: getComputedStyle(document.querySelector('.widget')).backgroundImage
    });
    const dark = read();
    LumenApp.store.patchSettings({ theme: 'light' });
    const light = read();
    LumenApp.store.patchSettings({ theme: 'dark' });
    return { dark, light };
  })()`);
  check('深色主题正文为浅色', contrast.dark.text > 200, String(contrast.dark.text));
  check('浅色主题正文为深色', contrast.light.text < 90, String(contrast.light.text));
  check('卡片使用玻璃背景', contrast.dark.card.includes('gradient'), contrast.dark.card.slice(0, 30));

  check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  console.log('\n布局摘要:', JSON.stringify(layoutReport.map((r) => ({
    width: r.width, cols: r.cols, scroll: r.scrollWidth, cards: r.cards, h: r.firstCardHeight
  }))));
  await finish();
}

async function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (consoleErrors.length) {
    console.log('控制台错误:');
    consoleErrors.slice(0, 10).forEach((e) => console.log('  ' + e));
  }
  try { await client.send('Browser.close'); } catch { /* ignore */ }
  cleanup();
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error('QA 失败:', err.message);
  cleanup();
  process.exitCode = 2;
});
