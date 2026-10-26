/* Lumen Tab — 界面层：面板 / 设置 / 组件库 / 弹窗 / 菜单 / Toast */
(function (root) {
  'use strict';
  var U = root.LumenUtil;
  var D = root.LumenData;
  var I = root.LumenIcons;
  var esc = U.escapeHtml;

  var ctx = null;
  var els = {};
  var dialogResolver = null;
  var dialogPrevFocus = null;
  var libraryPrevFocus = null;
  var menuPrevFocus = null;
  var menuOpenedAt = 0;
  var scrollLocks = new Set();
  var menuItems = [];
  var boundMenuCloser = null;
  var boundMenuScroll = null;
  var aiDirty = false;
  var aiTesting = false;

  /** color input 只认 #rrggbb，兼容旧的 #rgb */
  function color6(value) {
    var c = String(value || '');
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return '#64748b';
  }

  /* ---------- 图标水合 ---------- */
  function hydrateIcons(rootEl) {    (rootEl || document).querySelectorAll('[data-icon]').forEach(function (el) {
      var name = el.getAttribute('data-icon');
      var size = Number(el.getAttribute('data-size')) || 18;
      el.innerHTML = I.svg(name, size);
      el.removeAttribute('data-icon');
      el.removeAttribute('data-size');
    });
  }

  /* ---------- Toast ---------- */
  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    var icon = kind === 'err' ? 'x' : kind === 'ok' ? 'check' : 'info';
    el.innerHTML = I.svg(icon, 16) + '<span></span>';
    el.querySelector('span').textContent = message;
    els.toastWrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 240);
    }, 2600);
  }

  /* ---------- 滚动锁（按持有者计数，避免重复开关泄漏） ---------- */
  function syncScrollLock() {
    document.documentElement.classList.toggle('no-scroll', scrollLocks.size > 0);
  }

  function lockScroll(owner) {
    scrollLocks.add(owner);
    syncScrollLock();
  }

  function unlockScroll(owner) {
    scrollLocks.delete(owner);
    syncScrollLock();
  }

  /* ---------- 右键菜单 ---------- */
  function closeMenu() {
    var hadFocus = !els.ctxMenu.hidden && els.ctxMenu.contains(document.activeElement);
    els.ctxMenu.hidden = true;
    menuItems = [];
    if (boundMenuCloser) {
      document.removeEventListener('click', boundMenuCloser);
      window.removeEventListener('resize', closeMenu);
      if (boundMenuScroll) window.removeEventListener('scroll', boundMenuScroll, true);
      boundMenuCloser = null;
      boundMenuScroll = null;
    }
    if (hadFocus && menuPrevFocus && menuPrevFocus.isConnected && typeof menuPrevFocus.focus === 'function') {
      menuPrevFocus.focus();
    }
    menuPrevFocus = null;
  }

  function menu(opts) {
    closeMenu();
    menuItems = opts.items || [];
    els.ctxMenu.innerHTML = menuItems.map(function (item, i) {
      if (item.sep) return '<div class="menu__sep"></div>';
      if (item.label && item.header) return '<div class="menu__label">' + esc(item.label) + '</div>';
      return '<button type="button" role="menuitem" class="menu__item' + (item.danger ? ' menu__item--danger' : '') + '" data-i="' + i + '"' +
        (item.disabled ? ' disabled' : '') + '>' +
        (item.icon ? I.svg(item.icon, 15) : '') +
        '<span>' + esc(item.label) + '</span>' +
      '</button>';
    }).join('');

    menuPrevFocus = document.activeElement;
    menuOpenedAt = Date.now();
    els.ctxMenu.hidden = false;
    var rect = els.ctxMenu.getBoundingClientRect();
    var x = U.clamp(opts.x, 8, Math.max(8, window.innerWidth - rect.width - 8));
    var y = U.clamp(opts.y, 8, Math.max(8, window.innerHeight - rect.height - 8));
    els.ctxMenu.style.left = x + 'px';
    els.ctxMenu.style.top = y + 'px';
    els.ctxMenu.focus();

    boundMenuCloser = function (e) {
      if (!els.ctxMenu.contains(e.target)) closeMenu();
    };
    boundMenuScroll = function (e) {
      // 刚打开时的聚焦滚动不应立刻关掉菜单
      if (Date.now() - menuOpenedAt < 260) return;
      if (els.ctxMenu.contains(e.target)) return;
      closeMenu();
    };
    setTimeout(function () {
      document.addEventListener('click', boundMenuCloser);
      window.addEventListener('resize', closeMenu);
      window.addEventListener('scroll', boundMenuScroll, true);
    }, 0);
  }

  /* ---------- 通用弹窗 ---------- */
  function focusables(container) {
    return Array.prototype.slice.call(container.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return el.getClientRects().length > 0; });
  }

  /** 把 Tab 循环限制在当前浮层内；返回是否拦截了事件 */
  function trapTab(e, container) {
    if (e.key !== 'Tab') return false;
    var list = focusables(container);
    if (!list.length) { e.preventDefault(); return true; }
    var first = list[0];
    var last = list[list.length - 1];
    var active = document.activeElement;
    if (!container.contains(active)) { e.preventDefault(); first.focus(); return true; }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); return true; }
    if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); return true; }
    return false;
  }

  function openDialog(html, opts) {
    opts = opts || {};
    if (!els.dialogModal.hidden) closeDialog(false);
    dialogPrevFocus = document.activeElement;
    els.dialogBox.innerHTML = html;
    var heading = els.dialogBox.querySelector('h2');
    if (heading) els.dialogBox.setAttribute('aria-label', heading.textContent);
    hydrateIcons(els.dialogBox);
    els.dialogModal.hidden = false;
    lockScroll('dialog');
    var first = els.dialogBox.querySelector('[data-autofocus]') || els.dialogBox.querySelector('input,select,textarea,button');
    if (first) setTimeout(function () { first.focus(); }, 30);
    return els.dialogBox;
  }

  function closeDialog(value) {
    if (els.dialogModal.hidden) return false;
    els.dialogModal.hidden = true;
    unlockScroll('dialog');
    var resolver = dialogResolver;
    dialogResolver = null;
    if (resolver) resolver(value);
    if (dialogPrevFocus && dialogPrevFocus.isConnected && typeof dialogPrevFocus.focus === 'function') {
      dialogPrevFocus.focus();
    }
    dialogPrevFocus = null;
    return true;
  }

  function confirmDialog(options) {
    options = options || {};
    return new Promise(function (resolve) {
      openDialog(
        '<form class="form" id="confirmForm">' +
          '<h2>' + esc(options.title || '确认操作') + '</h2>' +
          '<p class="muted">' + esc(options.message || '') + '</p>' +
          '<div class="form__actions">' +
            '<button type="button" class="ghost-btn" data-role="cancel">取消</button>' +
            '<button type="submit" class="' + (options.danger ? 'danger-btn' : 'primary-btn') + '" data-autofocus>' + esc(options.confirmText || '确定') + '</button>' +
          '</div>' +
        '</form>'
      );
      dialogResolver = resolve;
      var form = els.dialogBox.querySelector('#confirmForm');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        closeDialog(true);
      });
      form.querySelector('[data-role="cancel"]').addEventListener('click', function () { closeDialog(false); });
    });
  }

  function shortcutDialog(sc) {
    var isEdit = !!sc;
    var editing = sc || { name: '', url: '', emoji: '', color: '#64748b' };
    openDialog(
      '<form class="form" id="scForm" novalidate>' +
        '<h2>' + (isEdit ? '编辑快捷方式' : '添加快捷方式') + '</h2>' +
        '<div class="form__row">' +
          '<label for="scName">名称</label>' +
          '<input id="scName" type="text" maxlength="24" value="' + esc(editing.name) + '" placeholder="例如：掘金" data-autofocus>' +
        '</div>' +
        '<div class="form__row">' +
          '<label for="scUrl">网址</label>' +
          '<input id="scUrl" type="text" value="' + esc(editing.url) + '" placeholder="https://juejin.cn">' +
        '</div>' +
        '<div class="form__row form__row--inline">' +
          '<div class="form__row">' +
            '<label for="scEmoji">图标</label>' +
            '<input id="scEmoji" type="text" maxlength="8" value="' + esc(editing.emoji) + '" placeholder="🛠️">' +
          '</div>' +
          '<div class="form__row">' +
            '<label for="scColor">颜色</label>' +
            '<input id="scColor" type="color" value="' + esc(color6(editing.color)) + '">' +
          '</div>' +
        '</div>' +
        '<p class="form__hint">图标用一个 emoji 即可，离线也能显示。</p>' +
        '<p class="form__error" data-role="error"></p>' +
        '<div class="form__actions">' +
          '<button type="button" class="ghost-btn" data-role="cancel">取消</button>' +
          '<button type="submit" class="primary-btn">' + (isEdit ? '保存' : '添加') + '</button>' +
        '</div>' +
      '</form>'
    );

    var form = els.dialogBox.querySelector('#scForm');
    var nameEl = form.querySelector('#scName');
    var urlEl = form.querySelector('#scUrl');
    var emojiEl = form.querySelector('#scEmoji');
    var colorEl = form.querySelector('#scColor');
    var errEl = form.querySelector('[data-role="error"]');

    function readEmoji() {
      return U.firstGrapheme(emojiEl.value) || U.firstGrapheme(nameEl.value) || '🔖';
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nameEl.value.trim();
      var url = U.normalizeWebUrl(urlEl.value);
      if (!name) { errEl.textContent = '请填写名称'; nameEl.focus(); return; }
      if (!url) { errEl.textContent = '只支持 http(s) 网址，例如 juejin.cn 或 https://example.com'; urlEl.focus(); return; }
      if (isEdit) {
        ctx.store.updateShortcut(sc.id, { name: name, url: url, emoji: readEmoji(), color: colorEl.value });
      } else if (!ctx.store.addShortcut({ name: name, url: url, emoji: readEmoji(), color: colorEl.value })) {
        errEl.textContent = '添加失败，请检查名称和网址';
        return;
      }
      closeDialog(true);
      ctx.renderDock();
      toast(isEdit ? '已保存' : '已添加到常用网站', 'ok');
    });

    form.querySelector('[data-role="cancel"]').addEventListener('click', function () { closeDialog(false); });
  }

  /* ---------- 面板 ---------- */
  function closeFolderIfAny() {
    if (root.LumenPages && typeof root.LumenPages.isFolderOpen === 'function' && root.LumenPages.isFolderOpen()) {
      root.LumenPages.closeFolder();
    }
  }

  function openPanel(name) {
    closeDialog(null);
    closeMenu();
    closeFolderIfAny();
    closeLibrary();
    if (root.LumenSearch && typeof root.LumenSearch.closeMenus === 'function') root.LumenSearch.closeMenus();
    closePanels();
    if (!name) return;
    if (name === 'settings') aiDirty = false;
    var panel = name === 'settings' ? els.settingsPanel : els.aiPanel;
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    els.scrim.hidden = false;
    lockScroll('panel');
    if (ctx.onPanelOpen) ctx.onPanelOpen(name);
  }

  function closePanels() {
    var active = document.activeElement;
    var any = els.aiPanel.classList.contains('is-open') || els.settingsPanel.classList.contains('is-open');
    if (!any) return false;
    els.aiPanel.classList.remove('is-open');
    els.settingsPanel.classList.remove('is-open');
    els.aiPanel.setAttribute('aria-hidden', 'true');
    els.settingsPanel.setAttribute('aria-hidden', 'true');
    els.scrim.hidden = true;
    unlockScroll('panel');
    // 焦点不要留在隐藏的面板里
    if (active && (els.aiPanel.contains(active) || els.settingsPanel.contains(active))) {
      var trigger = document.querySelector(els.aiPanel.contains(active) ? '[data-open="ai"]' : '[data-open="settings"]');
      if (trigger) trigger.focus();
    }
    return true;
  }

  function isAnyOpen() {
    return !els.dialogModal.hidden || !els.libraryModal.hidden ||
      els.aiPanel.classList.contains('is-open') || els.settingsPanel.classList.contains('is-open') ||
      !els.ctxMenu.hidden;
  }

  function handleEscape() {
    if (!els.ctxMenu.hidden) { closeMenu(); return true; }
    if (!els.dialogModal.hidden) { closeDialog(false); return true; }
    if (!els.libraryModal.hidden) { closeLibrary(); return true; }
    if (closePanels()) return true;
    return false;
  }

  /* ---------- 组件库 ---------- */
  function openLibrary() {
    libraryPrevFocus = document.activeElement;
    closePanels();
    closeDialog(null);
    closeFolderIfAny();
    if (root.LumenSearch && typeof root.LumenSearch.closeMenus === 'function') root.LumenSearch.closeMenus();
    renderLibrary();
    els.libraryModal.hidden = false;
    lockScroll('library');
    var first = els.libGrid.querySelector('button:not([disabled])');
    if (first) first.focus();
  }

  function closeLibrary() {
    if (els.libraryModal.hidden) return;
    els.libraryModal.hidden = true;
    unlockScroll('library');
    if (libraryPrevFocus && libraryPrevFocus.isConnected && typeof libraryPrevFocus.focus === 'function') {
      libraryPrevFocus.focus();
    }
    libraryPrevFocus = null;
  }

  function renderLibrary() {
    var s = ctx.store.get();
    var cat = s.categories.find(function (c) { return c.id === s.activeCategory; }) || s.categories[0];
    var focusedId = null;
    var active = document.activeElement;
    if (active && active.dataset && active.dataset.add && els.libGrid.contains(active)) focusedId = active.dataset.add;
    var addedIds = {};
    cat.items.forEach(function (i) { if (i.kind === 'widget') addedIds[i.type] = true; });
    els.libGrid.innerHTML = root.LumenWidgets.list().map(function (def) {
      var added = !!addedIds[def.id];
      return '<div class="lib-card">' +
        '<div class="lib-card__top">' +
          '<span class="lib-card__ico">' + I.svg(def.icon, 17) + '</span>' +
          '<span class="lib-card__name">' + esc(def.name) + '</span>' +
        '</div>' +
        '<p class="lib-card__desc">' + esc(def.desc) + '</p>' +
        '<button type="button" class="lib-card__btn" data-add="' + def.id + '"' + (added ? ' disabled' : '') + '>' +
          (added ? '已在当前分类' : '添加到「' + esc(cat.name) + '」') +
        '</button>' +
      '</div>';
    }).join('');
    els.libGrid.querySelectorAll('[data-add]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var def = root.LumenWidgets.get(btn.dataset.add);
        if (!def) return;
        var item = ctx.store.addWidget(def.id, def.defaultSize);
        if (!item) { toast('当前分类已经有这个组件了'); return; }
        toast('已添加到「' + cat.name + '」', 'ok');
      });
    });
    if (!els.libraryModal.hidden) {
      var again = focusedId ? els.libGrid.querySelector('[data-add="' + focusedId + '"]') : null;
      var target = (again && !again.disabled) ? again : els.libGrid.querySelector('[data-add]:not([disabled])');
      if (target) target.focus();
    }
  }

  /* ---------- 分类弹窗 ---------- */
  function categoryDialog(cat) {
    var isEdit = !!cat;
    var editing = cat || { name: '', emoji: '📁' };
    var picks = D.CATEGORY_EMOJIS.map(function (e) {
      return '<button type="button" class="emoji-opt' + (e === editing.emoji ? ' is-active' : '') + '" data-emoji="' + e + '" aria-label="' + e + '">' + e + '</button>';
    }).join('');
    openDialog(
      '<form class="form" id="catForm" novalidate>' +
        '<h2>' + (isEdit ? '编辑分类' : '新建分类') + '</h2>' +
        '<div class="form__row">' +
          '<label for="catName">名称</label>' +
          '<input id="catName" type="text" maxlength="16" value="' + esc(editing.name) + '" placeholder="例如：学习" data-autofocus>' +
        '</div>' +
        '<div class="form__row">' +
          '<label for="catEmoji">图标</label>' +
          '<input id="catEmoji" type="text" maxlength="8" value="' + esc(editing.emoji) + '" aria-label="分类图标">' +
          '<div class="emoji-pick" id="catEmojiPick">' + picks + '</div>' +
        '</div>' +
        '<p class="form__hint">分类就是侧边栏的一个页面，可以放网站、文件夹和组件。</p>' +
        '<p class="form__error" data-role="error"></p>' +
        '<div class="form__actions">' +
          '<button type="button" class="ghost-btn" data-role="cancel">取消</button>' +
          '<button type="submit" class="primary-btn">' + (isEdit ? '保存' : '创建') + '</button>' +
        '</div>' +
      '</form>'
    );
    var form = els.dialogBox.querySelector('#catForm');
    var nameEl = form.querySelector('#catName');
    var emojiEl = form.querySelector('#catEmoji');
    var errEl = form.querySelector('[data-role="error"]');
    form.querySelectorAll('.emoji-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        emojiEl.value = btn.dataset.emoji;
        form.querySelectorAll('.emoji-opt').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nameEl.value.trim();
      if (!name) { errEl.textContent = '请填写分类名称'; nameEl.focus(); return; }
      var emoji = U.firstGrapheme(emojiEl.value) || '📁';
      if (isEdit) {
        ctx.store.updateCategory(cat.id, { name: name, emoji: emoji });
        closeDialog(true);
        toast('分类已更新', 'ok');
      } else {
        var created = ctx.store.addCategory(name, emoji);
        if (!created) { errEl.textContent = '创建失败，请重试'; return; }
        ctx.store.setActiveCategory(created.id);
        closeDialog(true);
        toast('已创建分类「' + name + '」', 'ok');
      }
    });
    form.querySelector('[data-role="cancel"]').addEventListener('click', function () { closeDialog(false); });
  }

  /* ---------- 网站弹窗（分类 / 文件夹通用） ---------- */
  function siteDialog(opts) {
    opts = opts || {};
    var site = opts.site || null;
    var isEdit = !!site;
    var editing = site || { name: '', url: '', emoji: '', color: '#64748b' };
    openDialog(
      '<form class="form" id="siteForm" novalidate>' +
        '<h2>' + (isEdit ? '编辑网站' : '添加网站') + '</h2>' +
        '<div class="form__row">' +
          '<label for="siteName">名称</label>' +
          '<input id="siteName" type="text" maxlength="30" value="' + esc(editing.name) + '" placeholder="例如：掘金" data-autofocus>' +
        '</div>' +
        '<div class="form__row">' +
          '<label for="siteUrl">网址</label>' +
          '<input id="siteUrl" type="text" value="' + esc(editing.url) + '" placeholder="juejin.cn 或 https://juejin.cn">' +
        '</div>' +
        '<div class="form__row form__row--inline">' +
          '<div class="form__row">' +
            '<label for="siteEmoji">图标</label>' +
            '<input id="siteEmoji" type="text" maxlength="8" value="' + esc(editing.emoji) + '" placeholder="🛠️">' +
          '</div>' +
          '<div class="form__row">' +
            '<label for="siteColor">颜色</label>' +
            '<input id="siteColor" type="color" value="' + esc(color6(editing.color)) + '">' +
          '</div>' +
        '</div>' +
        '<div class="color-quick" id="siteColorQuick">' + D.SITE_COLORS.map(function (c) {
          var on = String(editing.color || '').toLowerCase() === c.toLowerCase();
          return '<button type="button" class="color-dot' + (on ? ' is-active' : '') + '" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '" aria-pressed="' + on + '"></button>';
        }).join('') + '</div>' +
        '<p class="form__hint">图标用一个 emoji 即可；留空会取名称首字。离线也能显示。</p>' +
        '<p class="form__error" data-role="error"></p>' +
        '<div class="form__actions">' +
          '<button type="button" class="ghost-btn" data-role="cancel">取消</button>' +
          '<button type="submit" class="primary-btn">' + (isEdit ? '保存' : '添加') + '</button>' +
        '</div>' +
      '</form>'
    );
    var form = els.dialogBox.querySelector('#siteForm');
    var nameEl = form.querySelector('#siteName');
    var urlEl = form.querySelector('#siteUrl');
    var emojiEl = form.querySelector('#siteEmoji');
    var colorEl = form.querySelector('#siteColor');
    var errEl = form.querySelector('[data-role="error"]');
    form.querySelectorAll('.color-dot').forEach(function (btn) {
      btn.addEventListener('click', function () {
        colorEl.value = btn.dataset.color;
        form.querySelectorAll('.color-dot').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', String(on));
        });
      });
    });
    colorEl.addEventListener('input', function () {
      form.querySelectorAll('.color-dot').forEach(function (b) {
        var on = b.dataset.color.toLowerCase() === colorEl.value.toLowerCase();
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nameEl.value.trim();
      var url = U.normalizeWebUrl(urlEl.value);
      if (!name) { errEl.textContent = '请填写名称'; nameEl.focus(); return; }
      if (!url) { errEl.textContent = '只支持 http(s) 网址，例如 juejin.cn 或 https://example.com'; urlEl.focus(); return; }
      var emoji = U.firstGrapheme(emojiEl.value) || U.firstGrapheme(name) || '🔗';
      var patch = { name: name, url: url, emoji: emoji, color: colorEl.value };
      var saved;
      if (isEdit) {
        saved = opts.folderId
          ? ctx.store.updateFolderSite(opts.categoryId, opts.folderId, site.id, patch)
          : ctx.store.updateSite(opts.categoryId, site.id, patch);
        if (!saved) { errEl.textContent = '保存失败，请重试'; return; }
      } else {
        saved = opts.folderId
          ? ctx.store.addSiteToFolder(opts.categoryId, opts.folderId, patch)
          : ctx.store.addSite(opts.categoryId, patch);
        if (!saved) {
          errEl.textContent = opts.folderId ? '文件夹已满（最多 40 个网站）' : '添加失败，请检查名称和网址';
          return;
        }
      }
      closeDialog(true);
      toast(isEdit ? '网站已更新' : '已添加「' + name + '」', 'ok');
    });
    form.querySelector('[data-role="cancel"]').addEventListener('click', function () { closeDialog(false); });
  }

  /* ---------- 通用文本弹窗 ---------- */
  function textDialog(opts, onSubmit) {
    opts = opts || {};
    openDialog(
      '<form class="form" id="textForm" novalidate>' +
        '<h2>' + esc(opts.title || '输入') + '</h2>' +
        '<div class="form__row">' +
          '<label for="textValue">' + esc(opts.label || '名称') + '</label>' +
          '<input id="textValue" type="text" maxlength="' + (opts.maxlength || 24) + '" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '" data-autofocus>' +
        '</div>' +
        '<p class="form__error" data-role="error"></p>' +
        '<div class="form__actions">' +
          '<button type="button" class="ghost-btn" data-role="cancel">取消</button>' +
          '<button type="submit" class="primary-btn">' + esc(opts.confirmText || '保存') + '</button>' +
        '</div>' +
      '</form>'
    );
    var form = els.dialogBox.querySelector('#textForm');
    var input = form.querySelector('#textValue');
    var errEl = form.querySelector('[data-role="error"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = input.value.trim();
      if (!value) { errEl.textContent = '不能为空'; input.focus(); return; }
      closeDialog(true);
      onSubmit(value);
    });
    form.querySelector('[data-role="cancel"]').addEventListener('click', function () { closeDialog(false); });
  }

  /* ---------- 设置同步 ---------- */
  function renderWallpapers() {
    var w = ctx.store.get().settings.wallpaper;
    var html = D.WALLPAPERS.map(function (p) {
      return '<button type="button" class="wallpaper-chip" data-preset="' + p.id + '" aria-pressed="' +
        (!w.image && w.preset === p.id) + '" style="background-image:' + p.css + '" title="' + esc(p.name) + '">' +
        '<span class="wallpaper-chip__name">' + esc(p.name) + '</span></button>';
    }).join('');
    if (w.image) {
      html += '<button type="button" class="wallpaper-chip" data-preset="__custom" aria-pressed="true" style="background-image:url(\'' + w.image + '\')" title="自定义图片">' +
        '<span class="wallpaper-chip__name">自定义</span></button>';
    }
    html += '<button type="button" class="wallpaper-chip wallpaper-chip--upload" data-preset="__upload" aria-pressed="false" title="上传本地图片">' + I.svg('image', 18) + '</button>';
    els.wallpaperList.innerHTML = html;

    els.wallpaperList.querySelectorAll('[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.preset;
        if (id === '__upload') { els.wallpaperFile.click(); return; }
        if (id === '__custom') return;
        ctx.store.setWallpaper({ preset: id, image: null });
      });
    });
  }

  function renderAccents() {
    var current = ctx.store.get().settings.accent;
    els.accentSwatches.innerHTML = D.ACCENTS.map(function (a) {
      return '<button type="button" class="swatch" data-accent="' + a.id + '" aria-pressed="' + (a.id === current) + '"' +
        ' style="background:' + a.value + '" title="' + esc(a.name) + '" aria-label="' + esc(a.name) + '"></button>';
    }).join('');
    els.accentSwatches.querySelectorAll('[data-accent]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ctx.store.patchSettings({ accent: btn.dataset.accent });
      });
    });
  }

  function renderSettingsWidgets() {
    var s = ctx.store.get();
    var cat = s.categories.find(function (c) { return c.id === s.activeCategory; }) || s.categories[0];
    var onIds = {};
    cat.items.forEach(function (i) { if (i.kind === 'widget') onIds[i.type] = true; });
    els.settingsWidgetList.innerHTML = root.LumenWidgets.list().map(function (def) {
      var on = !!onIds[def.id];
      return '<div class="lib-row">' +
        '<span class="lib-row__ico">' + I.svg(def.icon, 16) + '</span>' +
        '<div class="lib-row__info">' +
          '<div class="lib-row__name">' + esc(def.name) + '</div>' +
          '<div class="lib-row__desc">' + esc(def.desc) + '</div>' +
        '</div>' +
        '<label class="switch-row" style="flex:none;padding:0;gap:0;margin-left:auto">' +
          '<input type="checkbox" data-toggle="' + def.id + '"' + (on ? ' checked' : '') + ' aria-label="在「' + esc(cat.name) + '」显示 ' + esc(def.name) + '">' +
          '<i class="switch" aria-hidden="true"></i>' +
        '</label>' +
      '</div>';
    }).join('');

    els.settingsWidgetList.querySelectorAll('[data-toggle]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var def = root.LumenWidgets.get(cb.dataset.toggle);
        if (!def) return;
        if (cb.checked) {
          var item = ctx.store.addWidget(def.id, def.defaultSize);
          if (!item) { cb.checked = false; toast('当前分类已经有这个组件了'); return; }
          toast('已显示「' + def.name + '」', 'ok');
        } else {
          ctx.store.removeWidget(def.id);
          toast('已隐藏「' + def.name + '」');
        }
      });
    });
  }

  /* ---------- 分类管理列表 ---------- */
  function renderSettingsCategories() {
    var s = ctx.store.get();
    els.settingsCategoryList.innerHTML = s.categories.map(function (cat) {
      var counts = { site: 0, folder: 0, widget: 0 };
      cat.items.forEach(function (i) { counts[i.kind] += 1; });
      var parts = [];
      if (counts.site) parts.push(counts.site + ' 网站');
      if (counts.folder) parts.push(counts.folder + ' 文件夹');
      if (counts.widget) parts.push(counts.widget + ' 组件');
      return '<div class="cat-row' + (cat.id === s.activeCategory ? ' is-active' : '') + '" data-cat-row="' + esc(cat.id) + '">' +
        '<button type="button" class="cat-row__main" data-cat-go="' + esc(cat.id) + '">' +
          '<span class="cat-row__emoji">' + esc(cat.emoji) + '</span>' +
          '<span class="cat-row__info"><b>' + esc(cat.name) + '</b><small>' + esc(parts.join(' · ') || '空分类') + '</small></span>' +
          (cat.id === s.activeCategory ? '<span class="tag">当前</span>' : '') +
        '</button>' +
        '<span class="cat-row__acts">' +
          '<button type="button" class="icon-btn icon-btn--sm" data-cat-edit="' + esc(cat.id) + '" aria-label="编辑分类" title="编辑">' + I.svg('pencil', 14) + '</button>' +
          '<button type="button" class="icon-btn icon-btn--sm" data-cat-del="' + esc(cat.id) + '" aria-label="删除分类" title="删除">' + I.svg('trash', 14) + '</button>' +
        '</span>' +
      '</div>';
    }).join('');
  }

  function deleteCategoryFlow(cat) {
    if (!cat) return;
    if (ctx.store.get().categories.length <= 1) { toast('至少保留一个分类'); return; }
    confirmDialog({
      title: '删除分类「' + cat.name + '」',
      message: '分类里的 ' + cat.items.length + ' 个网站和组件会一起删除，不可撤销。',
      confirmText: '删除分类',
      danger: true
    }).then(function (ok) {
      if (ok && ctx.store.removeCategory(cat.id)) toast('已删除分类');
    });
  }

  function refreshLists() {
    if (!els.settingsWidgetList || !els.settingsCategoryList) return;
    renderSettingsWidgets();
    renderSettingsCategories();
    renderLibrary();
  }

  /* ---------- AI 接口配置 ---------- */
  function aiDraftMode() {
    var active = els.aiModeSeg && els.aiModeSeg.querySelector('[aria-pressed="true"]');
    return active && active.dataset.value === 'api' ? 'api' : 'local';
  }

  function setAiDraftMode(mode) {
    els.aiModeSeg.querySelectorAll('[data-value]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset.value === mode ? 'true' : 'false');
    });
  }

  function collectAiDraft(requireApi) {
    var rawBase = els.aiBaseUrl.value.trim();
    var rawModel = els.aiModel.value.trim();
    var key = els.aiApiKey.value.trim();
    var mode = aiDraftMode();
    if ((requireApi || mode === 'api') && rawBase && !U.normalizeApiBaseUrl(rawBase)) {
      return { error: '接口地址无效，请填写 http(s) 地址，并去掉查询串或账号密码' };
    }
    if ((requireApi || mode === 'api') && rawModel && !U.normalizeModelName(rawModel)) {
      return { error: '模型名称只能包含字母、数字与 . _ : @ / -' };
    }
    if (/[\u0000-\u001f\u007f\s]/.test(key)) {
      return { error: 'API Key 不能包含空白或控制字符' };
    }
    var temp = Number(els.aiTemperature.value);
    var tokens = Number(els.aiMaxTokens.value);
    var instructions = String(els.aiInstructions.value || '')
      .replace(/\r\n?/g, '\n').trim().slice(0, 2000);
    var ai = {
      mode: mode,
      baseUrl: U.normalizeApiBaseUrl(rawBase),
      model: U.normalizeModelName(rawModel),
      apiKey: key.slice(0, 400),
      instructions: instructions,
      temperature: Number.isFinite(temp) ? Math.max(0, Math.min(2, temp)) : 0.7,
      maxTokens: Number.isFinite(tokens) ? Math.round(Math.max(1, Math.min(4096, tokens))) : 800
    };
    if ((requireApi || ai.mode === 'api') && (!ai.baseUrl || !ai.model)) {
      return { error: 'API 模式需要同时填写接口地址和模型名称' };
    }
    return { ai: ai };
  }

  function markAiDirty() {
    aiDirty = true;
    if (!els.aiConfigStatus) return;
    els.aiConfigStatus.className = 'ai-status';
    els.aiConfigStatus.textContent = '有未保存的修改，点「保存配置」后生效。';
  }

  function aiSavedStatus(ai) {
    if (!ai || ai.mode !== 'api') return { text: '当前使用本地规则引擎，不会发起网络请求。', kind: '' };
    if (!ai.baseUrl || !ai.model) return { text: 'API 模式尚未完成配置，请填写接口地址和模型。', kind: 'is-err' };
    var host = ai.baseUrl.replace(/^https?:\/\//i, '');
    return {
      text: '已保存：' + ai.model + ' · ' + host + (ai.apiKey ? ' · 已保存 Key' : ' · 未填 Key（本地服务可留空）'),
      kind: ai.apiKey ? 'is-ok' : ''
    };
  }

  function renderAiSettings(ai) {
    if (!els.aiModeSeg) return;
    if (!aiDirty) {
      setAiDraftMode(ai && ai.mode === 'api' ? 'api' : 'local');
      var fields = [
        [els.aiBaseUrl, ai && ai.baseUrl || ''],
        [els.aiModel, ai && ai.model || ''],
        [els.aiApiKey, ai && ai.apiKey || ''],
        [els.aiInstructions, ai && ai.instructions || ''],
        [els.aiTemperature, ai && ai.temperature != null ? ai.temperature : 0.7],
        [els.aiMaxTokens, ai && ai.maxTokens != null ? ai.maxTokens : 800]
      ];
      fields.forEach(function (pair) {
        if (document.activeElement !== pair[0]) pair[0].value = pair[1];
      });
    }
    if (aiDirty) {
      els.aiConfigStatus.className = 'ai-status';
      els.aiConfigStatus.textContent = '有未保存的修改，点「保存配置」后生效。';
      return;
    }
    var status = aiSavedStatus(ai);
    els.aiConfigStatus.className = 'ai-status' + (status.kind ? ' ' + status.kind : '');
    els.aiConfigStatus.textContent = status.text;
  }

  function saveAiConfig() {
    var draft = collectAiDraft();
    if (draft.error) {
      toast(draft.error, 'err');
      return;
    }
    aiDirty = false;
    ctx.store.patchSettings({ ai: draft.ai });
    renderAiSettings(draft.ai);
    toast(draft.ai.mode === 'api' ? 'AI 接口配置已保存' : '已切换到本地规则模式', 'ok');
  }

  function testAiConnection() {
    if (aiTesting) return;
    var draft = collectAiDraft(true);
    if (draft.error) {
      toast(draft.error, 'err');
      return;
    }
    var api = root.LumenAIApi;
    if (!api) {
      toast('接口模块未加载', 'err');
      return;
    }
    aiTesting = true;
    var prev = els.aiTestBtn.textContent;
    els.aiTestBtn.disabled = true;
    els.aiTestBtn.textContent = '测试中…';
    els.aiConfigStatus.className = 'ai-status';
    els.aiConfigStatus.textContent = '正在连接 ' + (draft.ai.model || '模型') + '…';
    api.ping(draft.ai).then(function (res) {
      els.aiConfigStatus.className = 'ai-status is-ok';
      els.aiConfigStatus.textContent = '连接成功：' + (res.model || draft.ai.model) + (aiDirty ? '（字段尚未保存）' : '');
      toast('连接成功，可以开始对话', 'ok');
    }).catch(function (err) {
      els.aiConfigStatus.className = 'ai-status is-err';
      els.aiConfigStatus.textContent = (err && err.message) || '连接失败';
      toast((err && err.message) || '连接失败', 'err');
    }).finally(function () {
      aiTesting = false;
      els.aiTestBtn.disabled = false;
      els.aiTestBtn.textContent = prev;
    });
  }

  function syncSettings() {
    var s = ctx.store.get().settings;

    els.themeSeg.querySelectorAll('[data-value]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset.value === s.theme ? 'true' : 'false');
    });

    els.accentSwatches.querySelectorAll('[data-accent]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset.accent === s.accent ? 'true' : 'false');
    });

    els.wallpaperList.querySelectorAll('[data-preset]').forEach(function (btn) {
      var id = btn.dataset.preset;
      var pressed = id === '__custom' ? !!s.wallpaper.image : (!s.wallpaper.image && s.wallpaper.preset === id);
      btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });

    els.blurRange.value = s.wallpaper.blur;
    els.blurOut.textContent = s.wallpaper.blur + 'px';
    els.dimRange.value = s.wallpaper.dim;
    els.dimOut.textContent = s.wallpaper.dim + '%';
    els.dailyWallpaper.checked = !!s.wallpaper.daily;
    els.showSeconds.checked = !!s.showSeconds;
    els.compactDensity.checked = s.density === 'compact';
    if (els.engineSelect.options.length !== D.ENGINES.length) {
      els.engineSelect.innerHTML = D.ENGINES.map(function (e) {
        return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>';
      }).join('');
    }
    els.engineSelect.value = s.searchEngine;
    els.weatherSourceSelect.value = s.weatherSource === 'demo' ? 'demo' : 'live';
    if (document.activeElement !== els.nameInput) els.nameInput.value = s.name || '';
    renderAiSettings(s.ai);
    els.storageNote.textContent = ctx.store.isPersistent()
      ? '数据保存在本机 localStorage（lumenTab.v1），不会上传服务器。'
      : '当前环境无法写入本地存储，本次修改不会保留（请以 HTTP 或扩展方式打开）。';

    renderWallpapers();
    renderAccents();
  }

  /* ---------- 初始化 ---------- */
  function init(context) {
    ctx = context;
    var store = context.store;

    els.scrim = document.getElementById('scrim');
    els.aiPanel = document.getElementById('aiPanel');
    els.settingsPanel = document.getElementById('settingsPanel');
    els.libraryModal = document.getElementById('libraryModal');
    els.libGrid = document.getElementById('libGrid');
    els.dialogModal = document.getElementById('dialogModal');
    els.dialogBox = document.getElementById('dialogBox');
    els.ctxMenu = document.getElementById('ctxMenu');
    els.toastWrap = document.getElementById('toastWrap');
    els.themeSeg = document.getElementById('themeSeg');
    els.accentSwatches = document.getElementById('accentSwatches');
    els.wallpaperList = document.getElementById('wallpaperList');
    els.blurRange = document.getElementById('blurRange');
    els.blurOut = document.getElementById('blurOut');
    els.dimRange = document.getElementById('dimRange');
    els.dimOut = document.getElementById('dimOut');
    els.dailyWallpaper = document.getElementById('dailyWallpaper');
    els.showSeconds = document.getElementById('showSeconds');
    els.compactDensity = document.getElementById('compactDensity');
    els.engineSelect = document.getElementById('engineSelect');
    els.weatherSourceSelect = document.getElementById('weatherSourceSelect');
    els.nameInput = document.getElementById('nameInput');
    els.aiModeSeg = document.getElementById('aiModeSeg');
    els.aiBaseUrl = document.getElementById('aiBaseUrl');
    els.aiModel = document.getElementById('aiModel');
    els.aiApiKey = document.getElementById('aiApiKey');
    els.aiInstructions = document.getElementById('aiInstructions');
    els.aiTemperature = document.getElementById('aiTemperature');
    els.aiMaxTokens = document.getElementById('aiMaxTokens');
    els.aiSaveBtn = document.getElementById('aiSaveBtn');
    els.aiTestBtn = document.getElementById('aiTestBtn');
    els.aiConfigStatus = document.getElementById('aiConfigStatus');
    els.aiPresets = document.getElementById('aiPresets');
    els.storageNote = document.getElementById('storageNote');
    els.settingsWidgetList = document.getElementById('settingsWidgetList');
    els.settingsCategoryList = document.getElementById('settingsCategoryList');
    els.addCategoryBtn = document.getElementById('addCategoryBtn');
    els.wallpaperFile = document.getElementById('wallpaperFile');
    els.exportBtn = document.getElementById('exportBtn');
    els.importFile = document.getElementById('importFile');
    els.resetBtn = document.getElementById('resetBtn');
    els.clearHistoryBtn = document.getElementById('clearHistoryBtn');
    els.editLayoutBtn = document.getElementById('editLayoutBtn');

    hydrateIcons(document);

    // 打开 / 关闭
    document.querySelectorAll('[data-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var what = btn.dataset.open;
        if (what === 'library') openLibrary();
        else openPanel(what);
      });
    });
    document.querySelectorAll('[data-close="panel"]').forEach(function (btn) {
      btn.addEventListener('click', closePanels);
    });
    document.querySelectorAll('[data-close="modal"]').forEach(function (btn) {
      btn.addEventListener('click', closeLibrary);
    });
    els.scrim.addEventListener('click', function () { closePanels(); });
    els.ctxMenu.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-i]');
      if (!btn) return;
      var item = menuItems[Number(btn.dataset.i)];
      if (!item || item.disabled) return;
      closeMenu();
      if (typeof item.onClick === 'function') item.onClick();
    });
    els.libraryModal.addEventListener('click', function (e) {
      if (e.target === els.libraryModal) closeLibrary();
    });
    els.dialogModal.addEventListener('click', function (e) {
      if (e.target === els.dialogModal) closeDialog(false);
    });

    // 浮层内 Tab 循环，避免焦点跑到背景页面
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      if (!els.dialogModal.hidden) { trapTab(e, els.dialogBox); return; }
      if (!els.libraryModal.hidden) { trapTab(e, els.libraryModal.querySelector('.modal__box')); return; }
      var panel = els.settingsPanel.classList.contains('is-open') ? els.settingsPanel
        : els.aiPanel.classList.contains('is-open') ? els.aiPanel : null;
      if (panel) trapTab(e, panel);
    });

    els.ctxMenu.addEventListener('keydown', function (e) {
      var btns = Array.prototype.slice.call(els.ctxMenu.querySelectorAll('.menu__item:not([disabled])'));
      if (!btns.length) return;
      var i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); btns[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1].focus(); }
      else if (e.key === 'Tab') { closeMenu(); }
    });

    // Tab
    document.querySelectorAll('.tabs .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.tabs .tab').forEach(function (t) {
          var on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('.pane').forEach(function (p) {
          p.hidden = p.dataset.pane !== tab.dataset.tab;
        });
      });
    });
    els.editLayoutBtn.addEventListener('click', function () {
      openPanel('settings');
      var tab = document.querySelector('.tab[data-tab="widgets"]');
      if (tab) tab.click();
    });

    // 主题 / 主题色
    els.themeSeg.querySelectorAll('[data-value]').forEach(function (btn) {
      btn.addEventListener('click', function () { store.patchSettings({ theme: btn.dataset.value }); });
    });

    // 壁纸
    els.blurRange.addEventListener('input', function () {
      store.setWallpaper({ blur: Number(els.blurRange.value) });
      els.blurOut.textContent = els.blurRange.value + 'px';
    });
    els.dimRange.addEventListener('input', function () {
      store.setWallpaper({ dim: Number(els.dimRange.value) });
      els.dimOut.textContent = els.dimRange.value + '%';
    });
    els.dailyWallpaper.addEventListener('change', function () {
      store.setWallpaper({ daily: els.dailyWallpaper.checked });
    });
    document.getElementById('uploadWallpaperBtn').addEventListener('click', function () { els.wallpaperFile.click(); });
    document.getElementById('clearWallpaperBtn').addEventListener('click', function () {
      store.setWallpaper({ preset: 'aurora', image: null });
      toast('已恢复默认壁纸', 'ok');
    });
    els.wallpaperFile.addEventListener('change', function () {
      var file = els.wallpaperFile.files && els.wallpaperFile.files[0];
      els.wallpaperFile.value = '';
      if (!file) return;
      U.readImageFile(file).then(function (res) {
        store.setWallpaper({ image: res.dataUrl });
        toast('壁纸已更新', 'ok');
      }).catch(function (err) {
        toast(err.message, 'err');
      });
    });

    // 时间 / 搜索 / 布局
    els.showSeconds.addEventListener('change', function () { store.patchSettings({ showSeconds: els.showSeconds.checked }); });
    els.compactDensity.addEventListener('change', function () {
      store.patchSettings({ density: els.compactDensity.checked ? 'compact' : 'cozy' });
    });
    els.engineSelect.addEventListener('change', function () {
      store.patchSettings({ searchEngine: els.engineSelect.value });
      root.LumenSearch.renderEngine();
      root.LumenSearch.renderEngineMenu();
    });
    els.weatherSourceSelect.addEventListener('change', function () {
      store.patchSettings({ weatherSource: els.weatherSourceSelect.value === 'demo' ? 'demo' : 'live' });
      ctx.rerender();
    });
    els.nameInput.addEventListener('input', function () {
      store.patchSettings({ name: els.nameInput.value.trim().slice(0, 12) });
    });

    // AI 接口配置
    els.aiModeSeg.querySelectorAll('[data-value]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setAiDraftMode(btn.dataset.value);
        markAiDirty();
      });
    });
    [els.aiBaseUrl, els.aiModel, els.aiApiKey, els.aiInstructions, els.aiTemperature, els.aiMaxTokens].forEach(function (input) {
      input.addEventListener('input', markAiDirty);
    });
    els.aiSaveBtn.addEventListener('click', saveAiConfig);
    els.aiTestBtn.addEventListener('click', testAiConnection);
    els.aiPresets.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-base]');
      if (!btn) return;
      var switching = els.aiBaseUrl.value.trim() !== btn.dataset.base;
      els.aiBaseUrl.value = btn.dataset.base;
      els.aiModel.value = btn.dataset.model;
      if (switching) els.aiApiKey.value = '';
      setAiDraftMode('api');
      markAiDirty();
      els.aiApiKey.focus();
    });

    // 分类管理
    els.addCategoryBtn.addEventListener('click', function () { categoryDialog(null); });
    els.settingsCategoryList.addEventListener('click', function (e) {
      var s = ctx.store.get();
      var go = e.target.closest('[data-cat-go]');
      if (go) { ctx.store.setActiveCategory(go.dataset.catGo); return; }
      var edit = e.target.closest('[data-cat-edit]');
      if (edit) {
        var c1 = s.categories.find(function (c) { return c.id === edit.dataset.catEdit; });
        if (c1) categoryDialog(c1);
        return;
      }
      var del = e.target.closest('[data-cat-del]');
      if (del) {
        var c2 = s.categories.find(function (c) { return c.id === del.dataset.catDel; });
        deleteCategoryFlow(c2);
      }
    });

    // 组件列表
    renderSettingsWidgets();
    renderSettingsCategories();

    // 数据
    els.exportBtn.addEventListener('click', function () {
      U.downloadJSON('lumen-tab-backup-' + U.todayKey() + '.json', store.exportJSON());
      toast('备份已导出', 'ok');
    });
    els.importFile.addEventListener('change', function () {
      var file = els.importFile.files && els.importFile.files[0];
      els.importFile.value = '';
      if (!file) return;
      U.readJSONFile(file).then(function (json) {
        var WeTab = root.LumenWeTabImport;
        var isWeTab = !!(WeTab && WeTab.isWeTab(json));
        var converted = null;
        var message;
        if (isWeTab) {
          converted = WeTab.convert(json);
          if (!converted.ok) throw new Error(converted.error);
          var m = converted.meta;
          message = '检测到 WeTab 备份：' + m.categories + ' 个分类、' + m.sites + ' 个网站';
          if (m.dockImported) message += '、' + m.dockImported + ' 个 Dock';
          message += '。';
          if (m.widgetsSkipped) message += 'WeTab 组件（' + m.widgetsSkipped + ' 个）不会导入；';
          if (m.imageIcons) message += m.imageIcons + ' 个图片图标会转成文字色块；';
          message += '远程壁纸不会导入。';
          if (m.emptyCategories) message += m.emptyCategories + ' 个仅含组件的分类会保留为空。';
          if (m.dockTotal > m.dockImported) {
            message += 'Dock 仅恢复 ' + m.dockImported + '/' + m.dockTotal + ' 个（其余链接未包含在备份里）。';
          }
          message += '导入会覆盖当前全部分类、网站和外观设置。';
        } else {
          message = '将用「' + file.name + '」覆盖当前全部分类、网站、待办与外观设置，建议先导出备份。';
        }
        return confirmDialog({
          title: isWeTab ? '导入 WeTab 备份' : '导入备份',
          message: message,
          confirmText: '导入'
        }).then(function (ok) {
          if (!ok) return;
          var res = store.replace(converted ? converted.state : json);
          if (!res.ok) throw new Error(res.error);
          ctx.rerender();
          ctx.renderDock();
          syncSettings();
          refreshLists();
          if (isWeTab) {
            var state = store.get();
            var sites = state.categories.reduce(function (n, cat) {
              return n + cat.items.filter(function (item) { return item.kind === 'site'; }).length;
            }, 0);
            var skipped = converted.meta.widgetsSkipped;
            toast('WeTab 已导入：' + state.categories.length + ' 个分类 / ' + sites + ' 个网站' +
              (skipped ? '，跳过 ' + skipped + ' 个组件' : ''), 'ok');
          } else {
            toast('备份已导入', 'ok');
          }
        });
      }).catch(function (err) {
        toast('导入失败：' + err.message, 'err');
      });
    });
    els.resetBtn.addEventListener('click', function () {
      confirmDialog({
        title: '恢复默认设置',
        message: '所有待办、便签、习惯、快捷方式和外观都会回到初始状态，不可撤销。建议先导出备份。',
        confirmText: '恢复默认',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        store.reset();
        ctx.rerender();
        ctx.renderDock();
        syncSettings();
        refreshLists();
        toast('已恢复默认', 'ok');
      });
    });
    els.clearHistoryBtn.addEventListener('click', function () {
      store.clearSearchHistory();
      toast('搜索历史已清空');
    });

    // 状态变化同步
    store.on('settings', function () { syncSettings(); });
    store.on('categories', refreshLists);
    store.on('activeCategory', refreshLists);
    store.on('shortcuts', function () { /* Dock 由调用方刷新 */ });

    syncSettings();
    renderLibrary();
  }

  root.LumenUI = {
    init: init,
    hydrateIcons: hydrateIcons,
    toast: toast,
    menu: menu,
    closeMenu: closeMenu,
    confirm: confirmDialog,
    shortcutDialog: shortcutDialog,
    categoryDialog: categoryDialog,
    siteDialog: siteDialog,
    textDialog: textDialog,
    openDialog: openDialog,
    closeDialog: closeDialog,
    trapTab: trapTab,
    focusables: focusables,
    lockScroll: lockScroll,
    unlockScroll: unlockScroll,
    openPanel: openPanel,
    closePanels: closePanels,
    openLibrary: openLibrary,
    closeLibrary: closeLibrary,
    syncSettings: syncSettings,
    renderLibrary: renderLibrary,
    renderSettingsCategories: renderSettingsCategories,
    refreshLists: refreshLists,
    handleEscape: handleEscape,
    isAnyOpen: isAnyOpen
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
