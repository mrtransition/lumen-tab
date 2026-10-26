/* Lumen Tab — 搜索框 / 搜索引擎菜单 / 联想 / Dock（常用网站） */
(function (root) {
  'use strict';
  var U = root.LumenUtil;
  var D = root.LumenData;
  var I = root.LumenIcons;
  var esc = U.escapeHtml;

  var ctx = null;
  var els = {};
  var suggestItems = [];
  var suggestIndex = -1;
  var engineOpen = false;

  function init(context) {
    ctx = context;
    els.form = document.getElementById('searchForm');
    els.input = document.getElementById('searchInput');
    els.engineBtn = document.getElementById('engineBtn');
    els.engineBadge = document.getElementById('engineBadge');
    els.engineName = document.getElementById('engineName');
    els.engineMenu = document.getElementById('engineMenu');
    els.suggest = document.getElementById('suggest');
    els.dock = document.getElementById('dock');

    els.form.addEventListener('submit', onSubmit);
    els.input.addEventListener('input', onInput);
    els.input.addEventListener('focus', onFocus);
    els.input.addEventListener('keydown', onKeyDown);
    els.engineBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleEngineMenu();
    });

    document.addEventListener('click', function (e) {
      if (!els.engineMenu.hidden && !els.engineMenu.contains(e.target) && !els.engineBtn.contains(e.target)) {
        closeEngineMenu();
      }
      if (!els.suggest.hidden && !els.suggest.contains(e.target) && e.target !== els.input) {
        closeSuggest();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.engineMenu.hidden) {
        e.stopPropagation();
        closeEngineMenu();
        els.engineBtn.focus();
      }
    });

    els.dock.addEventListener('click', onDockClick);
    els.dock.addEventListener('contextmenu', onDockContext);
    els.dock.addEventListener('dragstart', onDockDragStart);
    els.dock.addEventListener('dragover', onDockDragOver);
    els.dock.addEventListener('dragleave', onDockDragLeave);
    els.dock.addEventListener('drop', onDockDrop);
    els.dock.addEventListener('dragend', onDockDragEnd);

    ctx.store.on('settings', function () {
      renderEngine();
      renderEngineMenu();
    });

    renderEngine();
    renderEngineMenu();
    renderDock();
  }

  /* ---------- 搜索引擎 ---------- */
  function currentEngine() {
    var s = ctx.store.get();
    return D.ENGINES.find(function (e) { return e.id === s.settings.searchEngine; }) || D.ENGINES[0];
  }

  function renderEngine() {
    var engine = currentEngine();
    els.engineBadge.textContent = engine.badge;
    els.engineBadge.style.background = 'linear-gradient(145deg,' + engine.color + ', rgba(100,116,139,.9))';
    els.engineName.textContent = engine.name;
  }

  function renderEngineMenu() {
    var engine = currentEngine();
    els.engineMenu.innerHTML = D.ENGINES.map(function (e) {
      return '<button type="button" role="option" class="engine-menu__item" data-id="' + e.id + '" aria-selected="' + (e.id === engine.id) + '">' +
        '<span class="engine-badge" style="background:' + e.color + '">' + e.badge + '</span>' +
        '<span>' + esc(e.name) + '</span>' +
        (e.id === engine.id ? '<span class="engine-menu__hint">当前</span>' : '') +
      '</button>';
    }).join('');
    els.engineMenu.querySelectorAll('[data-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ctx.store.patchSettings({ searchEngine: btn.dataset.id });
        renderEngine();
        renderEngineMenu();
        closeEngineMenu();
        ctx.toast('已切换到 ' + (D.ENGINES.find(function (x) { return x.id === btn.dataset.id; }) || {}).name, 'ok');
        els.input.focus();
        if (!els.input.value.trim()) return;
        showSuggest(els.input.value.trim());
      });
    });
  }

  function toggleEngineMenu() {
    engineOpen = !els.engineMenu.hidden;
    if (engineOpen) closeEngineMenu();
    else {
      els.engineMenu.hidden = false;
      els.engineBtn.setAttribute('aria-expanded', 'true');
      closeSuggest();
    }
  }

  function closeEngineMenu() {
    els.engineMenu.hidden = true;
    els.engineBtn.setAttribute('aria-expanded', 'false');
    engineOpen = false;
  }

  /* ---------- 联想 ---------- */
  function showSuggest(query) {
    var q = query.trim();
    var engine = currentEngine();
    var state = ctx.store.get();
    var items = [];

    var direct = U.normalizeUrl(q);
    if (direct) {
      items.push({ type: 'url', icon: 'external', label: '打开 ' + direct, hint: '直接访问', value: direct });
    }
    state.searchHistory
      .filter(function (h) { return !q || h.toLowerCase().indexOf(q.toLowerCase()) >= 0; })
      .slice(0, 4)
      .forEach(function (h) {
        items.push({ type: 'history', icon: 'search', label: h, hint: '历史', value: h });
      });
    if (q) {
      items.push({ type: 'search', icon: 'search', label: q, hint: '用 ' + engine.name + ' 搜索', value: q });
    }

    if (!items.length) {
      closeSuggest();
      return;
    }

    suggestItems = items;
    suggestIndex = -1;
    els.suggest.innerHTML = items.map(function (it, i) {
      return '<li class="suggest__item" role="option" data-index="' + i + '" aria-selected="false">' +
        I.svg(it.icon, 15) + '<span>' + esc(it.label) + '</span><small>' + esc(it.hint) + '</small>' +
      '</li>';
    }).join('');
    els.suggest.hidden = false;
    els.suggest.querySelectorAll('.suggest__item').forEach(function (li) {
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        chooseSuggestion(Number(li.dataset.index));
      });
    });
    els.engineBtn.setAttribute('aria-expanded', 'false');
  }

  function closeSuggest() {
    els.suggest.hidden = true;
    suggestItems = [];
    suggestIndex = -1;
  }

  function highlightSuggestion(next) {
    if (!suggestItems.length) return;
    suggestIndex = (next + suggestItems.length) % suggestItems.length;
    els.suggest.querySelectorAll('.suggest__item').forEach(function (li) {
      var on = Number(li.dataset.index) === suggestIndex;
      li.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function chooseSuggestion(i) {
    var item = suggestItems[i];
    if (!item) return;
    if (item.type === 'url') {
      els.input.value = item.value;
      submitQuery(item.value, true);
    } else if (item.type === 'history') {
      els.input.value = item.value;
      submitQuery(item.value);
    } else {
      submitQuery(item.value);
    }
  }

  function onInput() {
    var q = els.input.value.trim();
    if (!q) {
      var history = ctx.store.get().searchHistory;
      if (history.length) showSuggest('');
      else closeSuggest();
      return;
    }
    showSuggest(q);
  }

  function onFocus() {
    if (els.input.value.trim()) showSuggest(els.input.value.trim());
    else if (ctx.store.get().searchHistory.length) showSuggest('');
  }

  function onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' && !els.suggest.hidden) {
      e.preventDefault();
      highlightSuggestion(suggestIndex + 1);
    } else if (e.key === 'ArrowUp' && !els.suggest.hidden) {
      e.preventDefault();
      highlightSuggestion(suggestIndex - 1);
    } else if (e.key === 'Enter') {
      if (!els.suggest.hidden && suggestIndex >= 0) {
        e.preventDefault();
        chooseSuggestion(suggestIndex);
      }
    } else if (e.key === 'Escape') {
      if (!els.suggest.hidden) {
        e.stopPropagation();
        closeSuggest();
      }
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    submitQuery(els.input.value);
  }

  function submitQuery(raw, forceDirect) {
    var q = String(raw || '').trim();
    if (!q) return;
    var url = U.normalizeUrl(q);
    closeSuggest();
    closeEngineMenu();
    if (url && (forceDirect !== false)) {
      ctx.store.addSearchHistory(q);
      ctx.openUrl(url);
      return;
    }
    var engine = currentEngine();
    ctx.store.addSearchHistory(q);
    ctx.openUrl(U.buildSearchUrl(engine.url, q));
  }

  /* ---------- Dock ---------- */
  function renderDock() {
    var shortcuts = ctx.store.get().shortcuts;
    var html = shortcuts.map(function (sc, i) {
      return '<button type="button" class="dock__item" data-id="' + esc(sc.id) + '" data-index="' + i + '"' +
        ' draggable="true" title="' + esc(sc.name) + ' · ' + esc(sc.url) + '" style="--sc-color:' + esc(sc.color) + '">' +
        '<span class="dock__ico" aria-hidden="true">' + esc(sc.emoji) + '</span>' +
        '<span class="dock__name">' + esc(sc.name) + '</span>' +
      '</button>';
    }).join('');

    html += '<button type="button" class="dock__item dock__item--add" data-action="add-shortcut" title="添加常用网站">' +
      '<span class="dock__ico" aria-hidden="true">' + I.svg('plus', 22) + '</span>' +
      '<span class="dock__name">添加</span>' +
    '</button>';

    els.dock.innerHTML = html;
  }

  function onDockClick(e) {
    var add = e.target.closest('[data-action="add-shortcut"]');
    if (add) {
      ctx.editShortcut(null);
      return;
    }
    var item = e.target.closest('.dock__item[data-id]');
    if (!item) return;
    var sc = ctx.store.get().shortcuts.find(function (s) { return s.id === item.dataset.id; });
    if (sc) ctx.openUrl(sc.url);
  }

  function onDockContext(e) {
    var item = e.target.closest('.dock__item[data-id]');
    if (!item) return;
    e.preventDefault();
    var sc = ctx.store.get().shortcuts.find(function (s) { return s.id === item.dataset.id; });
    if (!sc) return;
    var idx = ctx.store.get().shortcuts.indexOf(sc);
    var rect = item.getBoundingClientRect();
    ctx.menu({
      x: e.clientX || rect.left + Math.min(rect.width - 8, 20),
      y: e.clientY || rect.bottom + 4,
      items: [
        { label: '打开', icon: 'external', onClick: function () { ctx.openUrl(sc.url); } },
        { label: '编辑', icon: 'pencil', onClick: function () { ctx.editShortcut(sc); } },
        { sep: true },
        { label: '左移', icon: 'chevron-left', disabled: idx === 0, onClick: function () { ctx.store.moveShortcut(idx, idx - 1); renderDock(); } },
        { label: '右移', icon: 'chevron-right', disabled: idx === ctx.store.get().shortcuts.length - 1, onClick: function () { ctx.store.moveShortcut(idx, idx + 1); renderDock(); } },
        { sep: true },
        {
          label: '删除', icon: 'trash', danger: true, onClick: function () {
            ctx.store.removeShortcut(sc.id);
            renderDock();
            ctx.toast('已删除「' + sc.name + '」');
          }
        }
      ]
    });
  }

  var dragId = null;

  function onDockDragStart(e) {
    var item = e.target.closest('.dock__item[data-id]');
    if (!item) return;
    dragId = item.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (err) { /* ignore */ }
    item.style.opacity = '0.4';
  }

  function onDockDragOver(e) {
    if (!dragId) return;
    var item = e.target.closest('.dock__item[data-id]');
    if (!item || item.dataset.id === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function onDockDragLeave() { /* no-op */ }

  function onDockDrop(e) {
    if (!dragId) return;
    e.preventDefault();
    var item = e.target.closest('.dock__item[data-id]');
    if (!item) return;
    var list = ctx.store.get().shortcuts;
    var from = list.findIndex(function (s) { return s.id === dragId; });
    var to = list.findIndex(function (s) { return s.id === item.dataset.id; });
    dragId = null;
    if (from < 0 || to < 0 || from === to) return;
    ctx.store.moveShortcut(from, to);
    renderDock();
  }

  function onDockDragEnd() {
    dragId = null;
    els.dock.querySelectorAll('.dock__item').forEach(function (el) { el.style.opacity = ''; });
  }

  root.LumenSearch = {
    init: init,
    renderDock: renderDock,
    renderEngine: renderEngine,
    renderEngineMenu: renderEngineMenu,
    focus: function () { els.input && els.input.focus(); },
    blur: function () { if (els.input) els.input.blur(); },
    closeMenus: function () {
      closeEngineMenu();
      closeSuggest();
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
