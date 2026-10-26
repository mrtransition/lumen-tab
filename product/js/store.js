/* Lumen Tab — 状态层：localStorage 持久化 / 订阅 / 业务动作 / 导入导出 */
(function (root) {
  'use strict';
  var U = root.LumenUtil;
  var D = root.LumenData;
  var KEY = 'lumenTab.v1';
  var SIZES = ['s', 'm', 'l'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function isDateKey(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false;
    var d = U.parseKey(v);
    return !isNaN(d.getTime()) && U.todayKey(d) === v;
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function safeStorage() {
    try {
      var t = '__lumen_probe__';
      root.localStorage.setItem(t, '1');
      root.localStorage.removeItem(t);
      return root.localStorage;
    } catch (e) {
      return null;
    }
  }

  /** 用默认值补齐缺失字段，保留用户已有数组/值 */
  function mergeDefaults(target, defaults) {
    if (!isObj(target)) return clone(defaults);
    var out = isObj(target) ? target : {};
    Object.keys(defaults).forEach(function (k) {
      if (!(k in out) || out[k] === null || out[k] === undefined) out[k] = clone(defaults[k]);
      else if (isObj(defaults[k]) && isObj(out[k])) mergeDefaults(out[k], defaults[k]);
      else if (Array.isArray(defaults[k]) && !Array.isArray(out[k])) out[k] = clone(defaults[k]);
    });
    return out;
  }

  function sanitizeLayout(layout) {
    if (!Array.isArray(layout)) return null;
    var seen = {};
    var out = [];
    layout.forEach(function (item) {
      if (!isObj(item) || typeof item.type !== 'string' || !item.type) return;
      if (seen[item.type]) return;
      seen[item.type] = true;
      out.push({ type: item.type, size: SIZES.indexOf(item.size) >= 0 ? item.size : 'm' });
    });
    return out;
  }

  function sanitizeSite(raw, fallbackId) {
    if (!isObj(raw)) return null;
    var name = String(raw.name || '').trim();
    var url = U.normalizeWebUrl(raw.url);
    if (!name || !url) return null;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : (fallbackId || U.uid('site')),
      kind: 'site',
      name: name.slice(0, 30),
      url: url,
      emoji: U.firstGrapheme(raw.emoji || name) || '🔗',
      color: /^#[0-9a-f]{3,8}$/i.test(raw.color || '') ? raw.color : '#64748b'
    };
  }

  function sanitizeItem(raw) {
    if (!isObj(raw)) return null;
    if (raw.kind === 'site') return sanitizeSite(raw);
    if (raw.kind === 'folder') {
      var sites = [];
      var seenSite = {};
      if (Array.isArray(raw.sites)) {
        raw.sites.forEach(function (s) {
          var site = sanitizeSite(s);
          if (!site || sites.length >= 40) return;
          if (seenSite[site.id]) site.id = U.uid('site');
          seenSite[site.id] = true;
          sites.push(site);
        });
      }
      return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : U.uid('fd'),
        kind: 'folder',
        name: String(raw.name || '新建文件夹').trim().slice(0, 24) || '新建文件夹',
        sites: sites
      };
    }
    if (raw.kind === 'widget') {
      if (typeof raw.type !== 'string' || !raw.type) return null;
      return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : U.uid('wd'),
        kind: 'widget',
        type: raw.type,
        size: SIZES.indexOf(raw.size) >= 0 ? raw.size : 'm'
      };
    }
    return null;
  }

  function sanitizeCategories(list) {
    if (!Array.isArray(list)) return null;
    var seenCat = {};
    var out = [];
    list.forEach(function (cat) {
      if (!isObj(cat)) return;
      var id = typeof cat.id === 'string' && cat.id && !seenCat[cat.id] ? cat.id : U.uid('cat');
      seenCat[id] = true;
      var seenWidget = {};
      var seenItem = {};
      var items = [];
      (Array.isArray(cat.items) ? cat.items : []).forEach(function (raw) {
        var item = sanitizeItem(raw);
        if (!item) return;
        if (item.kind === 'widget') {
          if (seenWidget[item.type]) return;
          seenWidget[item.type] = true;
        }
        if (seenItem[item.id]) item.id = U.uid('it');
        seenItem[item.id] = true;
        items.push(item);
      });
      out.push({
        id: id,
        name: String(cat.name || '未命名').trim().slice(0, 16) || '未命名',
        emoji: U.firstGrapheme(cat.emoji) || '📁',
        items: items
      });
    });
    return out.length ? out : null;
  }

  /** v1（单一 layout）→ v2（分类页）迁移 */
  function migrateState(raw) {
    var state = clone(raw);
    if (!Array.isArray(state.categories) || !state.categories.length) {
      var defaults = D.defaultCategories();
      var legacy = sanitizeLayout(state.layout);
      if (legacy) {
        defaults[0].items = legacy.map(function (w) {
          return { id: 'it-' + w.type, kind: 'widget', type: w.type, size: w.size };
        });
      }
      state.categories = defaults;
    } else {
      var cats = sanitizeCategories(state.categories);
      if (cats) state.categories = cats;
    }
    var ids = state.categories.map(function (c) { return c.id; });
    if (ids.indexOf(state.activeCategory) < 0) state.activeCategory = ids[0];
    delete state.layout;
    state.version = D.STATE_VERSION;
    return state;
  }

  function sanitizeShortcuts(list) {
    if (!Array.isArray(list)) return null;
    var seen = {};
    return list.filter(function (s) {
      return isObj(s) && typeof s.name === 'string' && U.normalizeWebUrl(s.url);
    }).map(function (s) {
      var id = typeof s.id === 'string' && s.id && !seen[s.id] ? s.id : U.uid('sc');
      seen[id] = true;
      return {
        id: id,
        name: s.name.slice(0, 24),
        url: U.normalizeWebUrl(s.url),
        emoji: U.firstGrapheme(s.emoji || s.name) || '🔖',
        color: /^#[0-9a-f]{3,8}$/i.test(s.color || '') ? s.color : '#64748b'
      };
    });
  }

  function sanitizeSettings(raw, fallback) {
    var out = clone(fallback || D.defaultState(Date.now()).settings);
    if (!isObj(raw)) return out;
    if (typeof raw.name === 'string') out.name = raw.name.trim().slice(0, 20);
    if (raw.theme === 'dark' || raw.theme === 'light') out.theme = raw.theme;
    if (D.ACCENTS.some(function (a) { return a.id === raw.accent; })) out.accent = raw.accent;
    if (D.ENGINES.some(function (e) { return e.id === raw.searchEngine; })) out.searchEngine = raw.searchEngine;
    out.weatherSource = raw.weatherSource === 'demo' ? 'demo' : 'live';
    out.openInNewTab = raw.openInNewTab !== false;
    out.showSeconds = raw.showSeconds !== false;
    out.density = raw.density === 'compact' ? 'compact' : 'cozy';
    out.railCollapsed = raw.railCollapsed === true;

    if (isObj(raw.wallpaper)) {
      var w = raw.wallpaper;
      var preset = D.WALLPAPERS.some(function (p) { return p.id === w.preset; })
        ? w.preset : out.wallpaper.preset;
      var image = typeof w.image === 'string' &&
        /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(w.image) &&
        w.image.length <= 6000000 ? w.image : null;
      var blur = Number(w.blur);
      var dim = Number(w.dim);
      out.wallpaper = {
        preset: preset,
        image: image,
        blur: Number.isFinite(blur) ? U.clamp(blur, 0, 24) : out.wallpaper.blur,
        dim: Number.isFinite(dim) ? U.clamp(dim, 0, 100) : out.wallpaper.dim,
        daily: w.daily === true
      };
    }

    if (isObj(raw.ai)) {
      var ai = raw.ai;
      var fallbackAi = out.ai || { temperature: 0.7, maxTokens: 800 };
      var base = U.normalizeApiBaseUrl(ai.baseUrl);
      var model = U.normalizeModelName(ai.model);
      var key = typeof ai.apiKey === 'string' ? ai.apiKey.trim().slice(0, 400) : '';
      if (/[\u0000-\u001f\u007f]/.test(key)) key = '';
      var instructions = typeof ai.instructions === 'string'
        ? ai.instructions.replace(/\r\n?/g, '\n')
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
          .trim().slice(0, 2000)
        : '';
      var temp = Number(ai.temperature);
      var tokens = Number(ai.maxTokens);
      out.ai = {
        mode: ai.mode === 'api' ? 'api' : 'local',
        baseUrl: base,
        model: model,
        apiKey: key,
        instructions: instructions,
        temperature: Number.isFinite(temp) ? U.clamp(temp, 0, 2) : fallbackAi.temperature,
        maxTokens: Number.isFinite(tokens) ? Math.round(U.clamp(tokens, 1, 4096)) : fallbackAi.maxTokens
      };
    }
    return out;
  }

  function sanitizeTodos(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    return list.filter(function (t) {
      return isObj(t) && typeof t.text === 'string' && t.text.trim();
    }).slice(0, 200).map(function (t) {
      var id = typeof t.id === 'string' && t.id && !seen[t.id] ? t.id : U.uid('todo');
      seen[id] = true;
      var created = Number(t.createdAt);
      return {
        id: id,
        text: t.text.trim().slice(0, 140),
        done: t.done === true,
        createdAt: Number.isFinite(created) ? created : Date.now()
      };
    });
  }

  function sanitizeNotes(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    return list.filter(function (n) {
      return isObj(n) && (typeof n.title === 'string' || typeof n.body === 'string');
    }).slice(0, 50).map(function (n) {
      var id = typeof n.id === 'string' && n.id && !seen[n.id] ? n.id : U.uid('note');
      seen[id] = true;
      var updated = Number(n.updatedAt);
      return {
        id: id,
        title: String(n.title || '未命名').trim().slice(0, 40) || '未命名',
        body: String(n.body || '').slice(0, 5000),
        updatedAt: Number.isFinite(updated) ? updated : Date.now()
      };
    });
  }

  function sanitizeCountdowns(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    return list.filter(function (c) {
      return isObj(c) && typeof c.title === 'string' && c.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(String(c.date || ''));
    }).slice(0, 50).map(function (c) {
      var id = typeof c.id === 'string' && c.id && !seen[c.id] ? c.id : U.uid('cd');
      seen[id] = true;
      return {
        id: id,
        title: c.title.trim().slice(0, 30),
        date: String(c.date),
        kind: c.kind === 'anniversary' ? 'anniversary' : 'countdown'
      };
    });
  }

  function sanitizeHabits(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    return list.filter(function (h) {
      return isObj(h) && typeof h.name === 'string' && h.name.trim();
    }).slice(0, 30).map(function (h) {
      var id = typeof h.id === 'string' && h.id && !seen[h.id] ? h.id : U.uid('hb');
      seen[id] = true;
      var source = Array.isArray(h.dates) ? h.dates
        : isObj(h.dates) ? Object.keys(h.dates).filter(function (k) { return !!h.dates[k]; })
        : [];
      var dateSet = {};
      var dates = [];
      source.forEach(function (key) {
        key = String(key);
        if (dates.length >= 400 || dateSet[key] || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
        dateSet[key] = true;
        dates.push(key);
      });
      var created = Number(h.createdAt);
      return {
        id: id,
        name: h.name.trim().slice(0, 30),
        dates: dates,
        createdAt: Number.isFinite(created) ? created : Date.now()
      };
    });
  }

  function sanitizePomodoro(raw) {
    var p = isObj(raw) ? raw : {};
    var focus = U.clamp(Math.round(Number(p.focus) || 25), 1, 90);
    var rest = U.clamp(Math.round(Number(p.rest) || 5), 1, 30);
    var mode = p.mode === 'rest' ? 'rest' : 'focus';
    var total = (mode === 'focus' ? focus : rest) * 60;
    var endsAt = Number(p.endsAt);
    var running = p.running === true && Number.isFinite(endsAt) && endsAt > 0;
    var remaining = Number(p.remaining);
    if (!Number.isFinite(remaining)) remaining = total;
    return {
      focus: focus,
      rest: rest,
      mode: mode,
      running: running,
      endsAt: running ? endsAt : null,
      remaining: U.clamp(Math.round(remaining), 0, total)
    };
  }

  function sanitizeAiMessages(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (m) {
      return isObj(m) && typeof m.text === 'string' && m.text.trim();
    }).map(function (m) {
      var ts = Number(m.ts);
      return {
        role: m.role === 'user' ? 'user' : 'ai',
        text: m.text.slice(0, 4000),
        reasoning: typeof m.reasoning === 'string' ? m.reasoning.trim().slice(0, 8000) : '',
        ts: Number.isFinite(ts) ? ts : Date.now()
      };
    }).slice(-60);
  }

  function sanitizeCollections(state) {
    state.todos = sanitizeTodos(state.todos);
    state.notes = sanitizeNotes(state.notes);
    state.countdowns = sanitizeCountdowns(state.countdowns);
    state.habits = sanitizeHabits(state.habits);
    state.pomodoro = sanitizePomodoro(state.pomodoro);
    state.aiMessages = sanitizeAiMessages(state.aiMessages);
    if (!Array.isArray(state.searchHistory)) state.searchHistory = [];
    state.searchHistory = state.searchHistory.filter(function (q) {
      return typeof q === 'string' && q.trim();
    }).map(function (q) { return q.trim().slice(0, 80); }).slice(0, 10);

    var today = U.todayKey();
    var w = isObj(state.water) ? state.water : {};
    state.water = {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(w.date || '')) ? String(w.date) : today,
      cups: U.clamp(Math.round(Number(w.cups) || 0), 0, 20)
    };
    state.calendarCursor = /^\d{4}-\d{2}$/.test(String(state.calendarCursor || ''))
      ? String(state.calendarCursor) : today.slice(0, 7);
    if (!D.HOT_SOURCES.some(function (h) { return h.id === state.hotSource; })) state.hotSource = 'weibo';
    state.quoteOffset = Number.isFinite(Number(state.quoteOffset)) ? Math.trunc(Number(state.quoteOffset)) : 0;
    if (!Array.isArray(state.quoteFav)) state.quoteFav = [];
    var favSeen = {};
    state.quoteFav = state.quoteFav.filter(function (i) {
      i = Number(i);
      return Number.isInteger(i) && i >= 0 && i < D.QUOTES.length && !favSeen[i] && (favSeen[i] = true);
    }).slice(0, D.QUOTES.length);
    return state;
  }

  function validateImport(raw) {
    if (!isObj(raw)) return { ok: false, error: '文件内容不是有效的对象' };
    if (!isObj(raw.settings) && !Array.isArray(raw.categories) && !Array.isArray(raw.layout) && !Array.isArray(raw.shortcuts) && !Array.isArray(raw.todos)) {
      return { ok: false, error: '这不像 Lumen Tab 的备份文件' };
    }
    var state = mergeDefaults(migrateState(raw), D.defaultState(Date.now()));
    var cats = sanitizeCategories(state.categories);
    if (!cats) return { ok: false, error: '备份里的分类页数据不可用' };
    state.categories = cats;
    state.settings = sanitizeSettings(state.settings);
    state.weatherCity = D.CITIES.some(function (c) { return c.id === state.weatherCity; }) ? state.weatherCity : 'beijing';
    if (!state.categories.some(function (c) { return c.id === state.activeCategory; })) {
      state.activeCategory = state.categories[0].id;
    }
    state.shortcuts = sanitizeShortcuts(state.shortcuts) || clone(D.DEFAULT_SHORTCUTS);
    sanitizeCollections(state);
    state.version = D.STATE_VERSION;
    return { ok: true, state: state };
  }

  function createStore(opts) {
    opts = opts || {};
    var key = opts.key || KEY;
    var storage = opts.storage !== undefined ? opts.storage : safeStorage();
    var listeners = Object.create(null);
    var state;
    var persistOk = !!storage;
    var saveTimer = null;

    function readStored() {
      if (!storage) return null;
      try {
        var raw = storage.getItem(key);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (!isObj(parsed)) return null;
        var merged = mergeDefaults(migrateState(parsed), D.defaultState(Date.now()));
        merged.settings = sanitizeSettings(merged.settings);
        if (!D.CITIES.some(function (c) { return c.id === merged.weatherCity; })) merged.weatherCity = 'beijing';
        sanitizeCollections(merged);
        return merged;
      } catch (e) {
        return null;
      }
    }

    function persistNow() {
      if (!storage) return false;
      try {
        storage.setItem(key, JSON.stringify(state));
        persistOk = true;
        return true;
      } catch (e) {
        persistOk = false;
        return false;
      }
    }

    function save() {
      if (saveTimer) return;
      saveTimer = setTimeout(function () {
        saveTimer = null;
        persistNow();
      }, 120);
    }

    function emit(evt) {
      var list = (listeners[evt] || []).slice();
      for (var i = 0; i < list.length; i++) {
        try { list[i](state, evt); } catch (e) { if (root.console) console.error('[store] listener error', e); }
      }
    }

    function notify(keys) {
      save();
      (keys || []).forEach(function (k) { emit(k); });
      emit('any');
    }

    state = readStored() || D.defaultState(Date.now());
    if (!persistOk) {
      // 首次运行无法写盘时也只提示一次
      setTimeout(function () { emit('storage-error'); }, 0);
    }

    function catById(id) {
      if (!Array.isArray(state.categories)) return null;
      return state.categories.find(function (c) { return c.id === id; }) || null;
    }

    function activeCat() {
      return catById(state.activeCategory) || state.categories[0] || null;
    }

    return {
      KEY: key,
      get: function () { return state; },
      isPersistent: function () { return persistOk && !!storage; },
      save: save,
      flush: function () {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        return persistNow();
      },
      on: function (evt, fn) {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(fn);
        return function () {
          var arr = listeners[evt] || [];
          var i = arr.indexOf(fn);
          if (i >= 0) arr.splice(i, 1);
        };
      },
      emit: emit,
      /** 通用修改：fn 直接改 state，keys 为受影响的数据片 */
      update: function (keys, fn) {
        fn(state);
        notify(keys);
      },
      patchSettings: function (patch) {
        Object.assign(state.settings, patch);
        notify(['settings']);
      },
      setWallpaper: function (patch) {
        Object.assign(state.settings.wallpaper, patch);
        notify(['settings']);
      },
      replace: function (next) {
        var res = validateImport(next);
        if (!res.ok) return res;
        // 备份默认不携带 API Key；导入时保留本机已有的 Key，避免覆盖后还要重填
        if (res.state.settings.ai && !res.state.settings.ai.apiKey && state.settings.ai.apiKey) {
          res.state.settings.ai.apiKey = state.settings.ai.apiKey;
        }
        state = res.state;
        notify(['settings', 'categories', 'activeCategory', 'shortcuts', 'todos', 'notes', 'countdowns', 'habits', 'pomodoro', 'aiMessages']);
        return { ok: true };
      },
      reset: function () {
        state = D.defaultState(Date.now());
        notify(['settings', 'categories', 'activeCategory', 'shortcuts', 'todos', 'notes', 'countdowns', 'habits', 'pomodoro', 'aiMessages']);
        persistNow();
      },
      exportJSON: function () {
        var snapshot = clone(state);
        // 密钥属于本机凭据，不写入可分享的 JSON 备份
        if (snapshot.settings && snapshot.settings.ai) snapshot.settings.ai.apiKey = '';
        return snapshot;
      },

      /* ---------- 待办 ---------- */
      addTodo: function (text) {
        var t = String(text || '').trim();
        if (!t) return null;
        var item = { id: U.uid('todo'), text: t.slice(0, 140), done: false, createdAt: Date.now() };
        state.todos.unshift(item);
        notify(['todos']);
        return item;
      },
      toggleTodo: function (id) {
        var hit = state.todos.find(function (t) { return t.id === id; });
        if (!hit) return;
        hit.done = !hit.done;
        notify(['todos']);
      },
      removeTodo: function (id) {
        state.todos = state.todos.filter(function (t) { return t.id !== id; });
        notify(['todos']);
      },
      clearDoneTodos: function () {
        state.todos = state.todos.filter(function (t) { return !t.done; });
        notify(['todos']);
      },

      /* ---------- 便签 ---------- */
      addNote: function () {
        var note = { id: U.uid('note'), title: '新便签', body: '', updatedAt: Date.now() };
        state.notes.unshift(note);
        notify(['notes']);
        return note;
      },
      updateNote: function (id, patch) {
        var note = state.notes.find(function (n) { return n.id === id; });
        if (!note) return;
        var next = Object.assign({}, patch || {}, { updatedAt: Date.now() });
        if (typeof next.title === 'string') next.title = next.title.slice(0, 40);
        if (typeof next.body === 'string') next.body = next.body.slice(0, 5000);
        Object.assign(note, next);
        notify(['notes']);
      },
      removeNote: function (id) {
        state.notes = state.notes.filter(function (n) { return n.id !== id; });
        notify(['notes']);
      },

      /* ---------- 倒计时 ---------- */
      addCountdown: function (title, date, kind) {
        var name = String(title || '').trim();
        if (!name || !isDateKey(date)) return null;
        var item = { id: U.uid('cd'), title: name.slice(0, 30), date: date, kind: kind === 'anniversary' ? 'anniversary' : 'countdown' };
        state.countdowns.push(item);
        notify(['countdowns']);
        return item;
      },
      removeCountdown: function (id) {
        state.countdowns = state.countdowns.filter(function (c) { return c.id !== id; });
        notify(['countdowns']);
      },

      /* ---------- 习惯 ---------- */
      addHabit: function (name) {
        var n = String(name || '').trim();
        if (!n) return null;
        var item = { id: U.uid('hb'), name: n.slice(0, 20), dates: [], createdAt: U.todayKey() };
        state.habits.push(item);
        notify(['habits']);
        return item;
      },
      removeHabit: function (id) {
        state.habits = state.habits.filter(function (h) { return h.id !== id; });
        notify(['habits']);
      },
      toggleHabitDate: function (id, dateKey) {
        var h = state.habits.find(function (x) { return x.id === id; });
        if (!h) return;
        var i = h.dates.indexOf(dateKey);
        if (i >= 0) h.dates.splice(i, 1);
        else h.dates.push(dateKey);
        notify(['habits']);
      },

      /* ---------- Dock ---------- */
      addShortcut: function (sc) {
        var url = U.normalizeWebUrl(sc.url);
        if (!url || !sc.name) return null;
        var item = {
          id: U.uid('sc'),
          name: String(sc.name).slice(0, 24),
          url: url,
          emoji: U.firstGrapheme(sc.emoji || sc.name) || '🔖',
          color: /^#[0-9a-f]{3,8}$/i.test(sc.color || '') ? sc.color : '#64748b'
        };
        state.shortcuts.push(item);
        notify(['shortcuts']);
        return item;
      },
      updateShortcut: function (id, patch) {
        var sc = state.shortcuts.find(function (s) { return s.id === id; });
        if (!sc) return;
        if (patch.url) {
          var url = U.normalizeWebUrl(patch.url);
          if (url) patch.url = url;
          else delete patch.url;
        }
        if (patch.emoji !== undefined) patch.emoji = U.firstGrapheme(patch.emoji) || sc.emoji;
        Object.assign(sc, patch);
        notify(['shortcuts']);
      },
      removeShortcut: function (id) {
        state.shortcuts = state.shortcuts.filter(function (s) { return s.id !== id; });
        notify(['shortcuts']);
      },
      moveShortcut: function (from, to) {
        var list = state.shortcuts;
        if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return;
        var item = list.splice(from, 1)[0];
        list.splice(to, 0, item);
        notify(['shortcuts']);
      },

      /* ---------- 分类页 ---------- */
      getActiveCategory: function () { return activeCat(); },
      getCategory: function (id) { return catById(id); },
      setActiveCategory: function (id) {
        if (!catById(id) || state.activeCategory === id) return false;
        state.activeCategory = id;
        notify(['activeCategory']);
        return true;
      },
      addCategory: function (name, emoji) {
        var item = {
          id: U.uid('cat'),
          name: String(name || '新分类').trim().slice(0, 16) || '新分类',
          emoji: U.firstGrapheme(emoji) || '📁',
          items: []
        };
        state.categories.push(item);
        notify(['categories']);
        return item;
      },
      updateCategory: function (id, patch) {
        var cat = catById(id);
        if (!cat) return;
        if (typeof patch.name === 'string') {
          var name = patch.name.trim().slice(0, 16);
          if (name) cat.name = name;
        }
        var emoji = U.firstGrapheme(patch.emoji);
        if (emoji) cat.emoji = emoji;
        notify(['categories']);
      },
      removeCategory: function (id) {
        if (state.categories.length <= 1) return false;
        var next = state.categories.filter(function (c) { return c.id !== id; });
        if (next.length === state.categories.length) return false;
        state.categories = next;
        if (state.activeCategory === id) state.activeCategory = next[0].id;
        notify(['categories', 'activeCategory']);
        return true;
      },
      moveCategory: function (from, to) {
        var list = state.categories;
        if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return;
        var item = list.splice(from, 1)[0];
        list.splice(to, 0, item);
        notify(['categories']);
      },

      /* ---------- 分类内容：网站 / 文件夹 / 组件 ---------- */
      addSite: function (catId, site) {
        var cat = catById(catId);
        var item = sanitizeSite(site);
        if (!cat || !item) return null;
        cat.items.push(item);
        notify(['categories']);
        return item;
      },
      updateSite: function (catId, itemId, patch) {
        var cat = catById(catId);
        if (!cat) return null;
        var idx = cat.items.findIndex(function (i) { return i.id === itemId && i.kind === 'site'; });
        if (idx < 0) return null;
        var merged = sanitizeSite(Object.assign({}, cat.items[idx], patch, { id: itemId }));
        if (!merged) return null;
        cat.items[idx] = merged;
        notify(['categories']);
        return merged;
      },
      removeItem: function (catId, itemId) {
        var cat = catById(catId);
        if (!cat) return false;
        var before = cat.items.length;
        cat.items = cat.items.filter(function (i) { return i.id !== itemId; });
        if (cat.items.length === before) return false;
        notify(['categories']);
        return true;
      },
      reorderItems: function (catId, orderedIds) {
        var cat = catById(catId);
        if (!cat || !Array.isArray(orderedIds)) return;
        var map = {};
        cat.items.forEach(function (i) { map[i.id] = i; });
        var next = [];
        orderedIds.forEach(function (id) {
          if (map[id]) { next.push(map[id]); delete map[id]; }
        });
        cat.items.forEach(function (i) { if (map[i.id]) next.push(i); });
        cat.items = next;
        notify(['categories']);
      },
      moveItem: function (catId, from, to) {
        var cat = catById(catId);
        if (!cat) return;
        var list = cat.items;
        if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return;
        var item = list.splice(from, 1)[0];
        list.splice(to, 0, item);
        notify(['categories']);
      },
      moveItemToCategory: function (fromCatId, itemId, toCatId) {
        var from = catById(fromCatId);
        var to = catById(toCatId);
        if (!from || !to || from.id === to.id) return { ok: false, error: '目标分类无效' };
        var idx = from.items.findIndex(function (i) { return i.id === itemId; });
        if (idx < 0) return { ok: false, error: '找不到这个项目' };
        var item = from.items[idx];
        if (item.kind === 'widget' && to.items.some(function (i) { return i.kind === 'widget' && i.type === item.type; })) {
          return { ok: false, error: '目标分类已经有这个组件了' };
        }
        from.items.splice(idx, 1);
        to.items.push(item);
        notify(['categories']);
        return { ok: true, item: item };
      },
      setItemSize: function (catId, itemId, size) {
        var cat = catById(catId);
        if (!cat || SIZES.indexOf(size) < 0) return;
        var item = cat.items.find(function (i) { return i.id === itemId && i.kind === 'widget'; });
        if (!item) return;
        item.size = size;
        notify(['categories']);
      },
      addWidgetItem: function (catId, type, size) {
        var cat = catById(catId);
        if (!cat || typeof type !== 'string' || !type) return null;
        if (cat.items.some(function (i) { return i.kind === 'widget' && i.type === type; })) return null;
        var item = { id: U.uid('wd'), kind: 'widget', type: type, size: SIZES.indexOf(size) >= 0 ? size : 'm' };
        cat.items.push(item);
        notify(['categories']);
        return item;
      },
      addFolder: function (catId, name) {
        var cat = catById(catId);
        if (!cat) return null;
        var item = {
          id: U.uid('fd'),
          kind: 'folder',
          name: String(name || '新建文件夹').trim().slice(0, 24) || '新建文件夹',
          sites: []
        };
        cat.items.push(item);
        notify(['categories']);
        return item;
      },
      renameFolder: function (catId, itemId, name) {
        var cat = catById(catId);
        if (!cat) return;
        var folder = cat.items.find(function (i) { return i.id === itemId && i.kind === 'folder'; });
        var next = String(name || '').trim().slice(0, 24);
        if (!folder || !next) return;
        folder.name = next;
        notify(['categories']);
      },
      addSiteToFolder: function (catId, folderId, site) {
        var cat = catById(catId);
        if (!cat) return null;
        var folder = cat.items.find(function (i) { return i.id === folderId && i.kind === 'folder'; });
        var item = sanitizeSite(site);
        if (!folder || !item) return null;
        if (folder.sites.length >= 40) return null;
        folder.sites.push(item);
        notify(['categories']);
        return item;
      },
      updateFolderSite: function (catId, folderId, siteId, patch) {
        var cat = catById(catId);
        if (!cat) return null;
        var folder = cat.items.find(function (i) { return i.id === folderId && i.kind === 'folder'; });
        if (!folder) return null;
        var idx = folder.sites.findIndex(function (s) { return s.id === siteId; });
        if (idx < 0) return null;
        var merged = sanitizeSite(Object.assign({}, folder.sites[idx], patch, { id: siteId }));
        if (!merged) return null;
        folder.sites[idx] = merged;
        notify(['categories']);
        return merged;
      },
      removeSiteFromFolder: function (catId, folderId, siteId) {
        var cat = catById(catId);
        if (!cat) return false;
        var folder = cat.items.find(function (i) { return i.id === folderId && i.kind === 'folder'; });
        if (!folder) return false;
        var before = folder.sites.length;
        folder.sites = folder.sites.filter(function (s) { return s.id !== siteId; });
        if (folder.sites.length === before) return false;
        notify(['categories']);
        return true;
      },

      /* ---------- 兼容旧接口：作用于当前分类 ---------- */
      hasWidget: function (type) {
        var cat = activeCat();
        return !!cat && cat.items.some(function (i) { return i.kind === 'widget' && i.type === type; });
      },
      addWidget: function (type, size) { return this.addWidgetItem(state.activeCategory, type, size); },
      removeWidget: function (type) {
        var cat = activeCat();
        if (!cat) return;
        var item = cat.items.find(function (i) { return i.kind === 'widget' && i.type === type; });
        if (item) this.removeItem(cat.id, item.id);
      },
      setWidgetSize: function (type, size) {
        var cat = activeCat();
        if (!cat) return;
        var item = cat.items.find(function (i) { return i.kind === 'widget' && i.type === type; });
        if (item) this.setItemSize(cat.id, item.id, size);
      },
      moveWidget: function (from, to) { this.moveItem(state.activeCategory, from, to); },

      /* ---------- 其它 ---------- */
      addSearchHistory: function (q) {
        var query = String(q || '').trim();
        if (!query) return;
        state.searchHistory = [query].concat(state.searchHistory.filter(function (x) { return x !== query; })).slice(0, 8);
        notify(['searchHistory']);
      },
      clearSearchHistory: function () {
        state.searchHistory = [];
        notify(['searchHistory']);
      },
      setPomodoro: function (patch) {
        Object.assign(state.pomodoro, patch);
        notify(['pomodoro']);
      },
      setQuoteOffset: function (n) {
        state.quoteOffset = n;
        notify(['quoteOffset']);
      },
      toggleQuoteFav: function (idx) {
        var i = state.quoteFav.indexOf(idx);
        if (i >= 0) state.quoteFav.splice(i, 1);
        else state.quoteFav.push(idx);
        notify(['quoteFav']);
      },
      addAiMessage: function (role, text, reasoning) {
        state.aiMessages.push({
          role: role,
          text: String(text || '').slice(0, 4000),
          reasoning: String(reasoning || '').trim().slice(0, 8000),
          ts: Date.now()
        });
        if (state.aiMessages.length > 60) state.aiMessages = state.aiMessages.slice(-60);
        notify(['aiMessages']);
      },
      clearAiMessages: function () {
        state.aiMessages = D.defaultState(Date.now()).aiMessages;
        notify(['aiMessages']);
      }
    };
  }

  var Store = createStore;
  Store.validateImport = validateImport;
  Store.mergeDefaults = mergeDefaults;
  Store.sanitizeLayout = sanitizeLayout;
  Store.sanitizeCategories = sanitizeCategories;
  Store.sanitizeSettings = sanitizeSettings;
  Store.sanitizeSite = sanitizeSite;
  Store.sanitizeItem = sanitizeItem;
  Store.migrateState = migrateState;
  Store.sanitizeShortcuts = sanitizeShortcuts;
  Store.sanitizeCollections = sanitizeCollections;
  Store.SIZES = SIZES;
  root.LumenStore = Store;
  if (typeof module === 'object' && module.exports) module.exports = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
