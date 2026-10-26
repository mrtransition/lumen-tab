/* Lumen Tab — 分类侧边栏 / 网站网格 / 文件夹 */
(function (root) {
  'use strict';

  var U = root.LumenUtil;
  var I = root.LumenIcons;
  var D = root.LumenData;
  var Widgets = root.LumenWidgets;
  var UI = root.LumenUI;
  var esc = U.escapeHtml;

  var SIZE_LABEL = { s: '小尺寸', m: '中尺寸', l: '大尺寸' };

  var ctx = null;
  var els = {};
  var instances = [];
  var drag = null;
  var openFolderId = null;
  var folderPrevFocus = null;
  var railTip = null;

  /* ---------- 工具 ---------- */
  function store() { return ctx.store; }
  function state() { return ctx.store.get(); }
  function activeCategory() {
    var s = state();
    return s.categories.find(function (c) { return c.id === s.activeCategory; }) || s.categories[0];
  }
  function isRenderable(item) {
    if (!item) return false;
    if (item.kind === 'widget') return !!Widgets.get(item.type);
    return item.kind === 'site' || item.kind === 'folder';
  }
  function countOf(cat) {
    var out = { site: 0, folder: 0, widget: 0 };
    cat.items.forEach(function (i) {
      if (!isRenderable(i)) return;
      out[i.kind] = (out[i.kind] || 0) + 1;
    });
    return out;
  }
  function summary(cat) {
    var c = countOf(cat);
    var parts = [];
    if (c.site) parts.push(c.site + ' 个网站');
    if (c.folder) parts.push(c.folder + ' 个文件夹');
    if (c.widget) parts.push(c.widget + ' 个组件');
    return parts.join(' · ') || '还没有内容';
  }
  function hostOf(url) {
    try { return new URL(url).host.replace(/^www\./, ''); } catch (e) { return url; }
  }

  /* ---------- 侧边栏 ---------- */
  function renderRail() {
    var s = state();
    els.railList.innerHTML = s.categories.map(function (cat) {
      var on = cat.id === s.activeCategory;
      return '<button type="button" class="rail__item' + (on ? ' is-active' : '') + '" data-cat-id="' + esc(cat.id) + '"' +
        ' aria-label="' + esc(cat.name) + '"' + (on ? ' aria-current="page"' : '') + ' draggable="true">' +
        '<span class="rail__emoji" aria-hidden="true">' + esc(cat.emoji) + '</span>' +
        '<span class="rail__label">' + esc(cat.name) + '</span>' +
      '</button>';
    }).join('');

    var activeBtn = els.railList.querySelector('.rail__item.is-active');
    if (activeBtn) activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function applyRailState() {
    var hidden = !!state().settings.railCollapsed;
    document.body.classList.toggle('rail-collapsed', hidden);
    if (hidden) hideRailTip();
    var btns = document.querySelectorAll('[data-rail-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-expanded', hidden ? 'false' : 'true');
      btns[i].setAttribute('aria-label', hidden ? '展开分类栏' : '收起分类栏');
      btns[i].title = hidden ? '展开分类栏' : '收起分类栏';
    }
  }

  function toggleRail() {
    store().patchSettings({ railCollapsed: !state().settings.railCollapsed });
  }

  /* ---------- 侧栏悬浮标签（桌面） ---------- */
  function hideRailTip() {
    if (railTip) railTip.hidden = true;
  }

  function showRailTip(btn) {
    if (!railTip || !btn) return;
    if (window.matchMedia('(max-width: 900px)').matches) return;
    if (document.body.classList.contains('rail-collapsed')) return;
    var label = btn.querySelector('.rail__label');
    var text = label ? label.textContent : btn.getAttribute('aria-label');
    if (!text) return;
    railTip.textContent = text;
    railTip.hidden = false;
    var rect = btn.getBoundingClientRect();
    var tw = railTip.offsetWidth;
    var th = railTip.offsetHeight;
    var left = rect.right + 12;
    if (left + tw > window.innerWidth - 8) left = rect.left - tw - 12;
    var top = rect.top + rect.height / 2 - th / 2;
    railTip.style.left = Math.round(left) + 'px';
    railTip.style.top = Math.round(U.clamp(top, 8, Math.max(8, window.innerHeight - th - 8))) + 'px';
  }

  /** 右键坐标；键盘 Shift+F10 触发时 clientX/Y 为 0，改用元素位置 */
  function menuPoint(e, el) {
    if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
    var rect = el.getBoundingClientRect();
    return { x: rect.left + Math.min(rect.width - 8, 24), y: rect.bottom + 4 };
  }

  function bindRailTip() {
    railTip = document.createElement('div');
    railTip.className = 'rail-tip';
    railTip.hidden = true;
    railTip.setAttribute('role', 'tooltip');
    document.body.appendChild(railTip);

    els.railList.addEventListener('mouseover', function (e) {
      var btn = e.target.closest('[data-cat-id]');
      if (!btn) return;
      if (btn.contains(e.relatedTarget)) return;
      showRailTip(btn);
    });
    els.railList.addEventListener('mouseout', function (e) {
      var btn = e.target.closest('[data-cat-id]');
      if (!btn || btn.contains(e.relatedTarget)) return;
      hideRailTip();
    });
    els.railList.addEventListener('focusin', function (e) {
      var btn = e.target.closest('[data-cat-id]');
      if (btn) showRailTip(btn);
    });
    els.railList.addEventListener('focusout', hideRailTip);
    els.railList.addEventListener('dragstart', hideRailTip);
    window.addEventListener('resize', hideRailTip);
    window.addEventListener('scroll', hideRailTip, true);
  }

  function categoryMenu(cat, x, y) {
    var list = state().categories;
    var idx = list.indexOf(cat);
    UI.menu({
      x: x, y: y,
      items: [
        { label: cat.name, header: true },
        { label: '重命名 / 换图标', icon: 'pencil', onClick: function () { UI.categoryDialog(cat); } },
        { label: '上移', icon: 'arrow-up', disabled: idx <= 0, onClick: function () { store().moveCategory(idx, idx - 1); } },
        { label: '下移', icon: 'arrow-down', disabled: idx < 0 || idx >= list.length - 1, onClick: function () { store().moveCategory(idx, idx + 1); } },
        { sep: true },
        { label: '新建分类', icon: 'plus', onClick: function () { UI.categoryDialog(null); } },
        { sep: true },
        {
          label: '删除分类', icon: 'trash', danger: true, disabled: list.length <= 1,
          onClick: function () {
            UI.confirm({
              title: '删除分类「' + cat.name + '」',
              message: '分类里的 ' + cat.items.length + ' 个网站和组件会一起删除，不可撤销。',
              confirmText: '删除分类',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              if (store().removeCategory(cat.id)) UI.toast('已删除分类「' + cat.name + '」');
            });
          }
        }
      ]
    });
  }

  /* ---------- 页头 ---------- */
  function renderHead() {
    var cat = activeCategory();
    els.pageHead.innerHTML =
      '<span class="page-head__emoji" aria-hidden="true">' + esc(cat.emoji) + '</span>' +
      '<span class="page-head__name">' + esc(cat.name) + '</span>' +
      '<span class="page-head__count">' + esc(summary(cat)) + '</span>' +
      '<span class="page-head__spacer"></span>' +
      '<button type="button" class="page-head__btn" data-page-act="add">' + I.svg('plus', 15) + '<span>添加</span></button>' +
      '<button type="button" class="page-head__btn page-head__btn--icon" data-page-act="edit" aria-label="编辑当前分类" title="编辑当前分类">' + I.svg('pencil', 15) + '</button>';
  }

  /* ---------- 网格渲染 ---------- */
  function destroyInstances() {
    instances.forEach(function (inst) {
      try { if (inst && typeof inst.destroy === 'function') inst.destroy(); } catch (e) { /* ignore */ }
    });
    instances = [];
  }

  function renderGrid() {
    destroyInstances();
    var cat = activeCategory();
    els.grid.innerHTML = '';
    els.grid.setAttribute('aria-label', cat.name + ' · ' + summary(cat));

    cat.items.forEach(function (item) {
      if (!isRenderable(item)) return;
      if (item.kind === 'widget') {
        var card = widgetCard(item);
        if (card) els.grid.appendChild(card);
      } else if (item.kind === 'site') {
        els.grid.appendChild(siteTile(item));
      } else if (item.kind === 'folder') {
        els.grid.appendChild(folderTile(item));
      }
    });
    els.grid.appendChild(addTile());
  }

  function widgetCard(item) {
    var def = Widgets.get(item.type);
    if (!def) return null;
    var size = def.sizes.indexOf(item.size) >= 0 ? item.size : (def.defaultSize || 'm');
    var card = document.createElement('article');
    card.className = 'widget';
    card.dataset.itemId = item.id;
    card.dataset.kind = 'widget';
    card.dataset.type = def.id;
    card.dataset.size = size;
    card.setAttribute('draggable', 'false');
    card.innerHTML =
      '<div class="widget__head">' +
        '<span class="widget__title">' + I.svg(def.icon, 15) + '<span>' + esc(def.name) + '</span></span>' +
        '<span class="widget__tools">' +
          '<button type="button" class="widget__btn widget__grip" aria-label="拖动排序" title="拖动排序">' + I.svg('grip', 15) + '</button>' +
          '<button type="button" class="widget__btn" data-card-act="menu" aria-label="卡片菜单" title="更多">' + I.svg('more', 16) + '</button>' +
        '</span>' +
      '</div>' +
      '<div class="widget__body"></div>';

    var body = card.querySelector('.widget__body');
    var inst = {};
    try {
      inst = def.mount(body, {
        store: store(),
        size: size,
        toast: ctx.toast,
        rerender: ctx.rerender,
        openUrl: ctx.openUrl,
        confirm: ctx.confirm,
        menu: ctx.menu
      }) || {};
    } catch (err) {
      console.error('[widget] ' + def.id + ' 渲染失败', err);
      body.innerHTML = '<div class="empty">' + I.svg('info', 20) + '<span>这个组件加载失败</span></div>';
    }
    instances.push(inst);

    var grip = card.querySelector('.widget__grip');
    grip.addEventListener('pointerdown', function () { card.setAttribute('draggable', 'true'); });
    var releaseGrip = function () {
      setTimeout(function () {
        if (!drag) card.setAttribute('draggable', 'false');
      }, 0);
    };
    grip.addEventListener('pointerup', releaseGrip);
    grip.addEventListener('pointercancel', releaseGrip);
    grip.addEventListener('blur', releaseGrip);
    card.querySelector('[data-card-act="menu"]').addEventListener('click', function (e) {
      e.stopPropagation();
      var rect = e.currentTarget.getBoundingClientRect();
      widgetMenu(item, def, rect.right - 186, rect.bottom + 6);
    });
    card.addEventListener('contextmenu', function (e) {
      // 组件内容里的输入框/文本保留浏览器原生右键菜单（复制、粘贴）
      if (!e.target.closest('.widget__head')) return;
      e.preventDefault();
      var p = menuPoint(e, card);
      widgetMenu(item, def, p.x, p.y);
    });
    return card;
  }

  function widgetMenu(item, def, x, y) {
    var cat = activeCategory();
    var idx = cat.items.indexOf(item);
    var items = [];
    if (def.sizes.length > 1) {
      items.push({ header: true, label: '尺寸' });
      def.sizes.forEach(function (sz) {
        items.push({
          label: SIZE_LABEL[sz] + (item.size === sz ? ' · 当前' : ''),
          disabled: item.size === sz,
          onClick: function () { store().setItemSize(cat.id, item.id, sz); }
        });
      });
      items.push({ sep: true });
    }
    items.push({ label: '前移', icon: 'arrow-up', disabled: idx <= 0, onClick: function () { store().moveItem(cat.id, idx, idx - 1); } });
    items.push({ label: '后移', icon: 'arrow-down', disabled: idx < 0 || idx >= cat.items.length - 1, onClick: function () { store().moveItem(cat.id, idx, idx + 1); } });
    var others = state().categories.filter(function (c) { return c.id !== cat.id; });
    if (others.length) {
      items.push({ sep: true });
      items.push({ header: true, label: '移动到分类' });
      others.forEach(function (other) {
        var dup = other.items.some(function (i) { return i.kind === 'widget' && i.type === item.type; });
        items.push({
          label: other.emoji + ' ' + other.name,
          disabled: dup,
          onClick: function () {
            var res = store().moveItemToCategory(cat.id, item.id, other.id);
            if (res.ok) UI.toast('已移动到「' + other.name + '」', 'ok');
            else UI.toast(res.error || '移动失败', 'err');
          }
        });
      });
    }
    items.push({ sep: true });
    items.push({
      label: '隐藏此组件', icon: 'eye-off',
      onClick: function () {
        store().removeItem(cat.id, item.id);
        UI.toast('已隐藏「' + def.name + '」，可在组件库加回');
      }
    });
    UI.menu({ x: x, y: y, items: items });
  }

  function siteTile(item) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile tile--site';
    btn.dataset.itemId = item.id;
    btn.dataset.kind = 'site';
    btn.draggable = true;
    btn.title = item.url;
    btn.innerHTML =
      '<span class="tile__icon" style="--tone:' + esc(item.color) + '">' + esc(item.emoji) + '</span>' +
      '<span class="tile__name">' + esc(item.name) + '</span>';
    btn.addEventListener('click', function () {
      ctx.openUrl(item.url);
    });
    btn.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var p = menuPoint(e, btn);
      siteMenu(item, p.x, p.y);
    });
    return btn;
  }

  function siteMenu(item, x, y) {
    var cat = activeCategory();
    var items = [
      { label: item.name, header: true },
      { label: '打开', icon: 'external', onClick: function () { ctx.openUrl(item.url); } },
      { label: '编辑', icon: 'pencil', onClick: function () { UI.siteDialog({ site: item, categoryId: cat.id }); } },
      {
        label: '复制链接', icon: 'link',
        onClick: function () {
          U.copyText(item.url).then(function () { UI.toast('链接已复制', 'ok'); }, function (err) {
            UI.toast(err && err.message ? err.message : '复制失败', 'err');
          });
        }
      }
    ];
    var others = state().categories.filter(function (c) { return c.id !== cat.id; });
    var idx = cat.items.indexOf(item);
    items.push({ sep: true });
    items.push({
      label: '上移', icon: 'arrow-up', disabled: idx <= 0,
      onClick: function () { store().moveItem(cat.id, idx, idx - 1); }
    });
    items.push({
      label: '下移', icon: 'arrow-down', disabled: idx < 0 || idx >= cat.items.length - 1,
      onClick: function () { store().moveItem(cat.id, idx, idx + 1); }
    });
    if (others.length) {
      items.push({ sep: true });
      items.push({ header: true, label: '移动到分类' });
      others.forEach(function (other) {
        items.push({
          label: other.emoji + ' ' + other.name,
          onClick: function () {
            var res = store().moveItemToCategory(cat.id, item.id, other.id);
            if (res.ok) UI.toast('已移动到「' + other.name + '」', 'ok');
          }
        });
      });
    }
    items.push({ sep: true });
    items.push({
      label: '删除网站', icon: 'trash', danger: true,
      onClick: function () {
        store().removeItem(cat.id, item.id);
        UI.toast('已删除「' + item.name + '」');
      }
    });
    UI.menu({ x: x, y: y, items: items });
  }

  function folderPreview(folder) {
    if (!folder.sites.length) {
      return '<span class="tile__folder-empty">' + I.svg('folder', 26) + '</span>';
    }
    var minis = folder.sites.slice(0, 4).map(function (s) {
      return '<span class="tile__mini" style="--tone:' + esc(s.color) + '">' + esc(s.emoji) + '</span>';
    }).join('');
    return '<span class="tile__folder-grid">' + minis + '</span>';
  }

  function folderTile(folder) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile tile--folder';
    btn.dataset.itemId = folder.id;
    btn.dataset.kind = 'folder';
    btn.draggable = true;
    btn.title = '打开文件夹「' + folder.name + '」';
    btn.innerHTML =
      '<span class="tile__folder">' + folderPreview(folder) + '</span>' +
      '<span class="tile__name">' + esc(folder.name) + '</span>' +
      '<span class="tile__badge">' + folder.sites.length + '</span>';
    btn.addEventListener('click', function () { openFolder(folder.id); });
    btn.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var p = menuPoint(e, btn);
      folderMenu(folder, p.x, p.y);
    });
    return btn;
  }

  function folderMenu(folder, x, y) {
    var cat = activeCategory();
    var items = [
      { label: folder.name, header: true },
      { label: '打开', icon: 'folder', onClick: function () { openFolder(folder.id); } },
      { label: '重命名', icon: 'pencil', onClick: function () { renameFolder(folder); } },
      { label: '添加网站', icon: 'plus', onClick: function () { UI.siteDialog({ folderId: folder.id, categoryId: cat.id }); } }
    ];
    var others = state().categories.filter(function (c) { return c.id !== cat.id; });
    var fidx = cat.items.indexOf(folder);
    items.push({ sep: true });
    items.push({
      label: '上移', icon: 'arrow-up', disabled: fidx <= 0,
      onClick: function () { store().moveItem(cat.id, fidx, fidx - 1); }
    });
    items.push({
      label: '下移', icon: 'arrow-down', disabled: fidx < 0 || fidx >= cat.items.length - 1,
      onClick: function () { store().moveItem(cat.id, fidx, fidx + 1); }
    });
    if (others.length) {
      items.push({ sep: true });
      items.push({ header: true, label: '移动到分类' });
      others.forEach(function (other) {
        items.push({
          label: other.emoji + ' ' + other.name,
          onClick: function () {
            var res = store().moveItemToCategory(cat.id, folder.id, other.id);
            if (res.ok) UI.toast('已移动到「' + other.name + '」', 'ok');
          }
        });
      });
    }
    items.push({ sep: true });
    items.push({
      label: '删除文件夹', icon: 'trash', danger: true,
      onClick: function () {
        UI.confirm({
          title: '删除文件夹「' + folder.name + '」',
          message: '里面的 ' + folder.sites.length + ' 个网站也会一起删除。',
          confirmText: '删除',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          store().removeItem(cat.id, folder.id);
          UI.toast('已删除文件夹');
        });
      }
    });
    UI.menu({ x: x, y: y, items: items });
  }

  function addTile() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile tile--add';
    btn.dataset.pageAct = 'add';
    btn.innerHTML = '<span class="tile__add-ico">' + I.svg('plus', 22) + '</span><span class="tile__name">添加</span>';
    return btn;
  }

  /* ---------- 添加入口 ---------- */
  function openAddMenu(x, y) {
    var cat = activeCategory();
    UI.menu({
      x: x, y: y,
      items: [
        { label: '添加到「' + cat.name + '」', header: true },
        { label: '添加网站', icon: 'link', onClick: function () { UI.siteDialog({ categoryId: cat.id }); } },
        {
          label: '新建文件夹', icon: 'folder-plus',
          onClick: function () {
            UI.textDialog({ title: '新建文件夹', label: '文件夹名称', value: '新建文件夹', placeholder: '例如：设计资源' }, function (name) {
              store().addFolder(cat.id, name);
              UI.toast('已创建文件夹「' + name + '」', 'ok');
            });
          }
        },
        { label: '添加组件', icon: 'grid', onClick: function () { UI.openLibrary(); } },
        { sep: true },
        { label: '新建分类', icon: 'plus', onClick: function () { UI.categoryDialog(null); } },
        {
          label: '管理分类', icon: 'settings',
          onClick: function () {
            UI.openPanel('settings');
            var tab = document.querySelector('.tab[data-tab="categories"]');
            if (tab) tab.click();
          }
        }
      ]
    });
  }

  /* ---------- 拖拽：排序 / 跨分类 / 入文件夹 ---------- */
  function clearDropMarks() {
    els.grid.querySelectorAll('.is-drop-before,.is-drop-after,.is-drop-into').forEach(function (el) {
      el.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into');
    });
    els.railList.querySelectorAll('.is-drop-target').forEach(function (el) {
      el.classList.remove('is-drop-target');
    });
  }

  /** 判断拖动落点应插在目标前还是后（与落点标记保持一致） */
  function dropBefore(e, rect) {
    var midY = rect.top + rect.height / 2;
    if (Math.abs(e.clientY - midY) < rect.height * 0.2) return e.clientX < rect.left + rect.width / 2;
    return e.clientY < midY;
  }

  function bindGridDrag() {
    els.grid.addEventListener('dragstart', function (e) {
      var el = e.target.closest ? e.target.closest('[data-item-id]') : null;
      if (!el) return;
      if (el.dataset.kind === 'widget' && el.getAttribute('draggable') !== 'true') {
        e.preventDefault();
        return;
      }
      var cat = activeCategory();
      drag = { kind: 'item', catId: cat.id, itemId: el.dataset.itemId, itemKind: el.dataset.kind };
      el.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', el.dataset.itemId); } catch (err) { /* ignore */ }
    });

    els.grid.addEventListener('dragend', function () {
      els.grid.querySelectorAll('.is-dragging').forEach(function (el) { el.classList.remove('is-dragging'); });
      els.grid.querySelectorAll('.widget[draggable="true"]').forEach(function (el) { el.setAttribute('draggable', 'false'); });
      clearDropMarks();
      drag = null;
    });

    els.grid.addEventListener('dragover', function (e) {
      if (!drag || drag.kind !== 'item') return;
      var target = e.target.closest ? e.target.closest('[data-item-id]') : null;
      if (!target || target.dataset.itemId === drag.itemId) { clearDropMarks(); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      if (target.dataset.kind === 'folder' && drag.itemKind === 'site') {
        target.classList.add('is-drop-into');
      } else {
        var rect = target.getBoundingClientRect();
        target.classList.add(dropBefore(e, rect) ? 'is-drop-before' : 'is-drop-after');
      }
    });

    els.grid.addEventListener('dragleave', function (e) {
      if (!e.target.closest || !e.target.closest('[data-item-id]')) clearDropMarks();
    });

    els.grid.addEventListener('drop', function (e) {
      if (!drag || drag.kind !== 'item') return;
      var target = e.target.closest ? e.target.closest('[data-item-id]') : null;
      if (!target) return;
      e.preventDefault();
      var cat = activeCategory();

      if (target.dataset.kind === 'folder' && drag.itemKind === 'site') {
        var site = cat.items.find(function (i) { return i.id === drag.itemId; });
        clearDropMarks();
        if (site && site.kind === 'site') {
          var stored = store().addSiteToFolder(cat.id, target.dataset.itemId, {
            name: site.name, url: site.url, emoji: site.emoji, color: site.color
          });
          if (stored) {
            store().removeItem(cat.id, drag.itemId);
            UI.toast('已放入文件夹', 'ok');
          } else {
            UI.toast('文件夹已满（最多 40 个网站）', 'err');
          }
        }
        drag = null;
        return;
      }

      if (target.dataset.itemId === drag.itemId) { clearDropMarks(); drag = null; return; }
      var ids = Array.prototype.map.call(els.grid.querySelectorAll('[data-item-id]'), function (el) { return el.dataset.itemId; });
      var from = ids.indexOf(drag.itemId);
      var targetId = target.dataset.itemId;
      var rect = target.getBoundingClientRect();
      var before = dropBefore(e, rect);
      clearDropMarks();
      ids.splice(from, 1);
      var at = ids.indexOf(targetId);
      if (at < 0) { drag = null; return; }
      if (!before) at += 1;
      ids.splice(at, 0, drag.itemId);
      drag = null;
      store().reorderItems(cat.id, ids);
    });
  }

  function bindRail() {
    els.railList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cat-id]');
      if (!btn) return;
      hideRailTip();
      store().setActiveCategory(btn.dataset.catId);
    });

    els.railList.addEventListener('contextmenu', function (e) {
      var btn = e.target.closest('[data-cat-id]');
      if (!btn) return;
      e.preventDefault();
      hideRailTip();
      var cat = state().categories.find(function (c) { return c.id === btn.dataset.catId; });
      if (cat) {
        var p = menuPoint(e, btn);
        categoryMenu(cat, p.x, p.y);
      }
    });

    els.railList.addEventListener('dragstart', function (e) {
      var btn = e.target.closest('[data-cat-id]');
      if (!btn) return;
      var list = state().categories;
      var idx = list.findIndex(function (c) { return c.id === btn.dataset.catId; });
      drag = { kind: 'category', id: btn.dataset.catId, index: idx };
      btn.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', btn.dataset.catId); } catch (err) { /* ignore */ }
    });

    els.railList.addEventListener('dragend', function () {
      els.railList.querySelectorAll('.is-dragging').forEach(function (el) { el.classList.remove('is-dragging'); });
      clearDropMarks();
      drag = null;
    });

    els.railList.addEventListener('dragover', function (e) {
      if (!drag) return;
      var btn = e.target.closest('[data-cat-id]');
      if (!btn) return;
      if (drag.kind === 'category' && drag.id === btn.dataset.catId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      btn.classList.add('is-drop-target');
    });

    els.railList.addEventListener('dragleave', function (e) {
      var btn = e.target.closest('[data-cat-id]');
      if (btn) btn.classList.remove('is-drop-target');
    });

    els.railList.addEventListener('drop', function (e) {
      var btn = e.target.closest('[data-cat-id]');
      if (!btn || !drag) return;
      e.preventDefault();
      var targetId = btn.dataset.catId;
      clearDropMarks();

      if (drag.kind === 'category') {
        var to = state().categories.findIndex(function (c) { return c.id === targetId; });
        var from = drag.index;
        drag = null;
        if (to >= 0 && from >= 0 && from !== to) store().moveCategory(from, to);
        return;
      }
      if (drag.kind === 'item') {
        var res = store().moveItemToCategory(drag.catId, drag.itemId, targetId);
        drag = null;
        var target = state().categories.find(function (c) { return c.id === targetId; });
        if (res.ok) UI.toast('已移动到「' + target.name + '」', 'ok');
        else UI.toast(res.error || '移动失败', 'err');
      }
    });

    els.railAdd.addEventListener('click', function (e) {
      var rect = e.currentTarget.getBoundingClientRect();
      UI.menu({
        x: rect.right + 8, y: rect.bottom - 8,
        items: [
          { label: '新建分类', icon: 'plus', onClick: function () { UI.categoryDialog(null); } },
          { label: '管理分类', icon: 'settings', onClick: function () {
            UI.openPanel('settings');
            var tab = document.querySelector('.tab[data-tab="categories"]');
            if (tab) tab.click();
          } }
        ]
      });
    });
  }

  /* ---------- 页头 / 添加按钮 ---------- */
  function bindHead() {
    els.pageHead.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-page-act]');
      if (!btn) return;
      if (btn.dataset.pageAct === 'add') {
        var rect = btn.getBoundingClientRect();
        openAddMenu(rect.right - 190, rect.bottom + 6);
      } else if (btn.dataset.pageAct === 'edit') {
        UI.categoryDialog(activeCategory());
      }
    });

    els.grid.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-page-act="add"]');
      if (!btn) return;
      var rect = btn.getBoundingClientRect();
      openAddMenu(rect.left, rect.bottom + 6);
    });
  }

  /* ---------- 文件夹弹窗 ---------- */
  function openFolder(id) {
    if (els.folderModal.hidden) folderPrevFocus = document.activeElement;
    openFolderId = id;
    renderFolder();
    els.folderModal.hidden = false;
    UI.lockScroll('folder');
    var first = els.folderSites.querySelector('button') ||
      els.folderModal.querySelector('[data-folder-act="add"]') ||
      els.folderModal.querySelector('[data-close="folder"]');
    if (first) first.focus();
  }

  function closeFolder() {
    if (els.folderModal.hidden) return false;
    els.folderModal.hidden = true;
    openFolderId = null;
    UI.unlockScroll('folder');
    if (folderPrevFocus && folderPrevFocus.isConnected && typeof folderPrevFocus.focus === 'function') {
      folderPrevFocus.focus();
    }
    folderPrevFocus = null;
    return true;
  }

  function currentFolder() {
    var cat = activeCategory();
    return { cat: cat, folder: cat.items.find(function (i) { return i.id === openFolderId && i.kind === 'folder'; }) };
  }

  function renderFolder() {
    var pair = currentFolder();
    if (!pair.folder) { closeFolder(); return; }
    var folder = pair.folder;
    els.folderTitle.textContent = folder.name;
    els.folderMeta.textContent = folder.sites.length + ' 个网站 · 来自「' + pair.cat.name + '」';
    if (!folder.sites.length) {
      els.folderSites.innerHTML = '<div class="folder-empty">' + I.svg('folder', 30) + '<p>文件夹还是空的</p><span>把网站拖进来，或点下方「添加网站」</span></div>';
      return;
    }
    els.folderSites.innerHTML = folder.sites.map(function (site) {
      return '<div class="fsite" data-fsite-id="' + esc(site.id) + '">' +
        '<button type="button" class="fsite__open" data-fsite-open="' + esc(site.id) + '">' +
          '<span class="fsite__ico" style="--tone:' + esc(site.color) + '">' + esc(site.emoji) + '</span>' +
          '<span class="fsite__body"><span class="fsite__name">' + esc(site.name) + '</span>' +
          '<span class="fsite__host">' + esc(hostOf(site.url)) + '</span></span>' +
        '</button>' +
        '<span class="fsite__acts">' +
          '<button type="button" class="icon-btn icon-btn--sm" data-fsite-edit="' + esc(site.id) + '" aria-label="编辑" title="编辑">' + I.svg('pencil', 14) + '</button>' +
          '<button type="button" class="icon-btn icon-btn--sm" data-fsite-del="' + esc(site.id) + '" aria-label="移除" title="移除">' + I.svg('trash', 14) + '</button>' +
        '</span>' +
      '</div>';
    }).join('');
  }

  function renameFolder(folder) {
    UI.textDialog({
      title: '重命名文件夹', label: '文件夹名称', value: folder.name, placeholder: '例如：设计资源'
    }, function (name) {
      store().renameFolder(activeCategory().id, folder.id, name);
      if (openFolderId === folder.id) renderFolder();
      UI.toast('已重命名为「' + name + '」', 'ok');
    });
  }

  function bindFolderModal() {
    els.folderModal.addEventListener('click', function (e) {
      if (e.target === els.folderModal) closeFolder();
    });
    els.folderSites.addEventListener('click', function (e) {
      var pair = currentFolder();
      if (!pair.folder) return;
      var open = e.target.closest('[data-fsite-open]');
      if (open) {
        var site = pair.folder.sites.find(function (s) { return s.id === open.dataset.fsiteOpen; });
        if (site) ctx.openUrl(site.url);
        return;
      }
      var edit = e.target.closest('[data-fsite-edit]');
      if (edit) {
        var s1 = pair.folder.sites.find(function (s) { return s.id === edit.dataset.fsiteEdit; });
        if (s1) UI.siteDialog({ folderId: pair.folder.id, categoryId: pair.cat.id, site: s1 });
        return;
      }
      var del = e.target.closest('[data-fsite-del]');
      if (del) {
        store().removeSiteFromFolder(pair.cat.id, pair.folder.id, del.dataset.fsiteDel);
        UI.toast('已从文件夹移除');
      }
    });

    els.folderModal.querySelectorAll('[data-close="folder"]').forEach(function (btn) {
      btn.addEventListener('click', closeFolder);
    });
    els.folderModal.querySelectorAll('[data-folder-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pair = currentFolder();
        if (!pair.folder) return;
        var act = btn.dataset.folderAct;
        if (act === 'add') UI.siteDialog({ folderId: pair.folder.id, categoryId: pair.cat.id });
        else if (act === 'rename') renameFolder(pair.folder);
        else if (act === 'delete') {
          UI.confirm({
            title: '删除文件夹「' + pair.folder.name + '」',
            message: '里面的 ' + pair.folder.sites.length + ' 个网站也会一起删除。',
            confirmText: '删除',
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            store().removeItem(pair.cat.id, pair.folder.id);
            closeFolder();
            UI.toast('已删除文件夹');
          });
        }
      });
    });
  }

  /* ---------- 生命周期 ---------- */
  function render() {
    if (!state().categories) return;
    renderRail();
    renderHead();
    renderGrid();
    if (!els.folderModal.hidden) renderFolder();
  }

  function init(context, refs) {
    ctx = context;
    els = refs;
    bindRail();
    bindRailTip();
    bindHead();
    bindGridDrag();
    bindFolderModal();

    document.querySelectorAll('[data-rail-toggle]').forEach(function (btn) {
      btn.addEventListener('click', toggleRail);
    });

    store().on('categories', render);
    store().on('activeCategory', render);
    store().on('settings', applyRailState);

    // 文件夹浮层：Esc 关闭、Tab 焦点循环（比面板/弹窗更内层，先处理）
    window.addEventListener('keydown', function (e) {
      if (els.folderModal.hidden) return;
      if (e.key === 'Escape') {
        if (UI.isAnyOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        closeFolder();
        return;
      }
      if (e.key === 'Tab' && document.getElementById('dialogModal').hidden && !UI.isAnyOpen()) {
        UI.trapTab(e, els.folderModal.querySelector('.modal__box'));
      }
    }, true);

    applyRailState();
    render();
  }

  root.LumenPages = {
    init: init,
    render: render,
    applyRailState: applyRailState,
    closeFolder: closeFolder,
    isFolderOpen: function () { return !!(els.folderModal && !els.folderModal.hidden); },
    instances: function () { return instances; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
