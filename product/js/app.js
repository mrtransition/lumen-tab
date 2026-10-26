/* Lumen Tab — 启动与编排（布局渲染交给 pages.js） */
(function (root) {
  'use strict';

  var U = root.LumenUtil;
  var D = root.LumenData;
  var Pages = root.LumenPages;
  var UI = root.LumenUI;
  var Search = root.LumenSearch;
  var AI = root.LumenAI;

  var store = null;
  var ctx = null;
  var els = {};
  var clockTimer = null;
  var mediaLight = null;

  /* ---------- 上下文 ---------- */
  function buildContext() {
    return {
      store: store,
      toast: function (m, k) { UI.toast(m, k); },
      rerender: function () { Pages.render(); },
      renderDock: function () { Search.renderDock(); },
      openUrl: function (url) { U.openUrl(url); },
      menu: function (opts) { UI.menu(opts); },
      confirm: function (opts) { return UI.confirm(opts); },
      editShortcut: function (sc) { UI.shortcutDialog(sc); },
      openSettingsTab: function (name) { openSettingsTab(name); },
      onPanelOpen: function (name) {
        if (name === 'ai') AI.open();
        if (name === 'settings') { UI.syncSettings(); UI.refreshLists(); }
      }
    };
  }

  /* ---------- 主题 / 壁纸 / 背景 ---------- */
  function effectiveTheme(theme) {
    if (theme === 'auto') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return theme === 'light' ? 'light' : 'dark';
  }

  function applySettings() {
    var s = store.get().settings;
    var theme = effectiveTheme(s.theme);
    var html = document.documentElement;
    html.setAttribute('data-theme', theme);
    html.setAttribute('data-accent', s.accent);
    html.setAttribute('data-density', s.density === 'compact' ? 'compact' : 'cozy');
    applyWallpaper(s.wallpaper, theme);
    renderClock();
  }

  function applyWallpaper(w, theme) {
    var preset = D.WALLPAPERS.find(function (p) { return p.id === w.preset; }) || D.WALLPAPERS[0];
    if (w.daily && !w.image) {
      var idx = U.hashStr('daily-wallpaper|' + U.todayKey()) % D.WALLPAPERS.length;
      preset = D.WALLPAPERS[idx];
    }
    els.wallpaperImg.style.backgroundImage = w.image ? 'url("' + w.image + '")' : preset.css;
    els.wallpaperImg.style.filter = w.blur ? 'blur(' + w.blur + 'px)' : 'none';
    if (theme === 'light') {
      var alpha = U.clamp(0.34 + (w.dim / 100) * 0.5, 0.3, 0.92);
      els.wallpaperScrim.style.background = 'rgba(248,250,252,' + alpha.toFixed(3) + ')';
    } else {
      els.wallpaperScrim.style.background = 'rgba(6,10,20,' + (U.clamp(w.dim, 0, 80) / 100).toFixed(3) + ')';
    }
  }

  /* ---------- 时钟 / 问候 ---------- */
  function renderClock() {
    var now = new Date();
    var s = store.get().settings;
    els.clock.textContent = U.fmtClock(now, s.showSeconds !== false);
    els.clockDate.textContent = U.fmtDateZh(now);
    els.clockYear.textContent = now.getFullYear() + ' 年第 ' + U.dayOfYear(now) + ' 天';
  }

  function renderGreeting() {
    var s = store.get();
    var open = s.todos.filter(function (t) { return !t.done; }).length;
    var name = s.settings.name;
    els.heroGreeting.textContent = U.greeting() + (name ? '，' + name : '');
    els.heroSub.textContent = open > 0
      ? '今天还有 ' + open + ' 件事等你'
      : s.todos.length
        ? '待办清空，享受当下'
        : '今天想做点什么？';
  }

  /* ---------- 全局快捷键 ---------- */
  function isTyping(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    if (!typing) return false;
    // 面板关闭后仍可能保留焦点：不可见/移出视口的输入框不算正在输入
    if (!el.getClientRects().length) return false;
    var r = el.getBoundingClientRect();
    if (r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight) return false;
    return true;
  }

  function openSettingsTab(name) {
    UI.openPanel('settings');
    var tab = document.querySelector('.tab[data-tab="' + name + '"]');
    if (tab) tab.click();
  }

  function bindGlobal() {
    document.addEventListener('keydown', function (e) {
      var typing = isTyping(document.activeElement);

      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        var panel = document.getElementById('aiPanel');
        if (panel.classList.contains('is-open')) UI.closePanels();
        else UI.openPanel('ai');
        return;
      }

      if (e.key === 'Escape') {
        if (UI.handleEscape()) {
          e.preventDefault();
          return;
        }
      }

      if (typing) return;

      var overlayOpen = UI.isAnyOpen() ||
        (root.LumenPages && typeof root.LumenPages.isFolderOpen === 'function' && root.LumenPages.isFolderOpen());

      if (e.key === '/') {
        if (overlayOpen) return;
        e.preventDefault();
        Search.focus();
      } else if (e.key === '?') {
        if (overlayOpen) return;
        e.preventDefault();
        openSettingsTab('about');
      }
    });

    // 拖拽图片设为壁纸
    document.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) {
        e.preventDefault();
      }
    });
    document.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      var file = e.dataTransfer.files[0];
      if (!file.type || file.type.indexOf('image/') !== 0) return;
      e.preventDefault();
      U.readImageFile(file).then(function (res) {
        store.setWallpaper({ image: res.dataUrl });
        UI.toast('壁纸已更新', 'ok');
      }).catch(function (err) {
        UI.toast(err.message, 'err');
      });
    });

    // 跟随系统主题
    if (window.matchMedia) {
      mediaLight = window.matchMedia('(prefers-color-scheme: light)');
      var onChange = function () {
        if (store.get().settings.theme === 'auto') applySettings();
      };
      if (mediaLight.addEventListener) mediaLight.addEventListener('change', onChange);
      else if (mediaLight.addListener) mediaLight.addListener(onChange);
    }

    window.addEventListener('beforeunload', function () { store.flush(); });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    els.wallpaperImg = document.getElementById('wallpaperImg');
    els.wallpaperScrim = document.getElementById('wallpaperScrim');
    els.clock = document.getElementById('clock');
    els.clockDate = document.getElementById('clockDate');
    els.clockYear = document.getElementById('clockYear');
    els.heroGreeting = document.getElementById('heroGreeting');
    els.heroSub = document.getElementById('heroSub');
    els.grid = document.getElementById('widgetsGrid');

    store = root.LumenStore();
    ctx = buildContext();

    applySettings();
    UI.init(ctx);
    Search.init(ctx);
    Pages.init(ctx, {
      shell: document.getElementById('shell'),
      rail: document.getElementById('rail'),
      railList: document.getElementById('railList'),
      railAdd: document.getElementById('railAdd'),
      pageHead: document.getElementById('pageHead'),
      grid: els.grid,
      folderModal: document.getElementById('folderModal'),
      folderTitle: document.getElementById('folderTitle'),
      folderMeta: document.getElementById('folderMeta'),
      folderSites: document.getElementById('folderSites')
    });
    AI.init(ctx);

    document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || 'dark');

    store.on('settings', applySettings);
    store.on('settings', renderGreeting);
    store.on('todos', renderGreeting);
    store.on('storage-error', function () {
      UI.toast('本地存储不可用，修改不会被保留', 'err');
    });

    renderGreeting();
    bindGlobal();

    clockTimer = setInterval(renderClock, 1000);
    renderClock();

    applySettings();
    Search.renderDock();
    UI.syncSettings();
    UI.refreshLists();

    // 首次使用提示
    try {
      if (!localStorage.getItem('lumenTab.introSeen')) {
        localStorage.setItem('lumenTab.introSeen', '1');
        setTimeout(function () {
          UI.toast('左侧分类切换页面，右键网站可编辑；按 / 直接搜索', 'ok');
        }, 700);
      }
    } catch (e) { /* ignore */ }

    // 便于自动化测试与调试
    root.LumenApp = {
      store: store,
      ctx: ctx,
      renderWidgets: function () { Pages.render(); },
      render: function () { Pages.render(); },
      pages: Pages,
      instances: function () { return Pages.instances(); }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
