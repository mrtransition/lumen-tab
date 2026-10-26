/* Lumen Tab — 效率类小组件（待办 / 便签 / 倒计时 / 习惯 / 番茄钟） */
(function (root) {
  'use strict';
  var U = root.LumenUtil;
  var D = root.LumenData;
  var I = root.LumenIcons;
  var Widgets = root.LumenWidgets;
  var esc = U.escapeHtml;

  /* ============================================================
     待办清单
     ============================================================ */
  Widgets.register({
    id: 'todo',
    name: '待办清单',
    desc: '随手记下要做的事，勾掉就很爽',
    icon: 'list',
    sizes: ['s', 'm', 'l'],
    defaultSize: 'm',
    mount: function (body, ctx) {
      body.innerHTML =
        '<div class="todo">' +
          '<form class="todo__form">' +
            '<input class="todo__input" type="text" maxlength="140" placeholder="添加一件要做的事…" aria-label="新待办">' +
            '<button class="todo__add" type="submit" aria-label="添加待办">' + I.svg('plus', 16) + '</button>' +
          '</form>' +
          '<ul class="todo__list" aria-label="待办列表"></ul>' +
          '<div class="todo__foot">' +
            '<div class="todo__bar"><i data-role="bar"></i></div>' +
            '<span data-role="count">0 / 0</span>' +
            '<button class="todo__clear" type="button" data-role="clear">清理已完成</button>' +
          '</div>' +
        '</div>';

      var form = body.querySelector('.todo__form');
      var input = body.querySelector('.todo__input');
      var list = body.querySelector('.todo__list');
      var bar = body.querySelector('[data-role="bar"]');
      var count = body.querySelector('[data-role="count"]');
      var clearBtn = body.querySelector('[data-role="clear"]');

      function renderList() {
        var todos = ctx.store.get().todos;
        var done = todos.filter(function (t) { return t.done; }).length;
        if (!todos.length) {
          list.innerHTML = '<li class="empty">' + I.svg('check', 22) + '<span>还没有待办，加一件吧</span></li>';
        } else {
          list.innerHTML = todos.map(function (t) {
            return '<li class="todo__item' + (t.done ? ' is-done' : '') + '" data-id="' + esc(t.id) + '">' +
              '<button class="todo__check" type="button" data-act="toggle" aria-pressed="' + (t.done ? 'true' : 'false') +
                '" aria-label="' + (t.done ? '标记未完成' : '标记完成') + '">' + I.svg('check', 12) + '</button>' +
              '<span class="todo__text">' + esc(t.text) + '</span>' +
              '<button class="mini-btn todo__del" type="button" data-act="del" aria-label="删除待办">' + I.svg('x', 14) + '</button>' +
            '</li>';
          }).join('');
        }
        count.textContent = done + ' / ' + todos.length;
        bar.style.width = todos.length ? Math.round((done / todos.length) * 100) + '%' : '0%';
        clearBtn.hidden = done === 0;
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!input.value.trim()) return;
        ctx.store.addTodo(input.value);
        input.value = '';
        input.focus();
      });

      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (!btn) return;
        var item = btn.closest('[data-id]');
        if (!item) return;
        if (btn.dataset.act === 'toggle') ctx.store.toggleTodo(item.dataset.id);
        else if (btn.dataset.act === 'del') ctx.store.removeTodo(item.dataset.id);
      });

      clearBtn.addEventListener('click', function () {
        var n = ctx.store.get().todos.filter(function (t) { return t.done; }).length;
        if (!n) return;
        ctx.confirm({
          title: '清理已完成',
          message: '将删除 ' + n + ' 条已完成的待办，操作不可撤销。',
          confirmText: '清理',
          danger: true
        }).then(function (ok) {
          if (ok) {
            ctx.store.clearDoneTodos();
            ctx.toast('已清理 ' + n + ' 条待办', 'ok');
          }
        });
      });

      var off = ctx.store.on('todos', renderList);
      renderList();
      return { destroy: off };
    }
  });

  /* ============================================================
     便签
     ============================================================ */
  Widgets.register({
    id: 'note',
    name: '便签',
    desc: '多张便签，自动保存，随时记录灵感',
    icon: 'note',
    sizes: ['m', 'l'],
    defaultSize: 'm',
    mount: function (body, ctx) {
      if (!ctx.store.get().notes.length) ctx.store.addNote();

      body.innerHTML =
        '<div class="note">' +
          '<div class="note__tabs">' +
            '<div class="note__tabs-inner" data-role="tabs" style="display:flex;gap:4px;min-width:0;overflow-x:auto"></div>' +
            '<button class="mini-btn" type="button" data-role="add" aria-label="新建便签" title="新建便签" style="margin-left:auto;flex:none">' + I.svg('plus', 15) + '</button>' +
          '</div>' +
          '<input class="note__title" type="text" maxlength="40" placeholder="标题" aria-label="便签标题">' +
          '<textarea class="note__body" placeholder="写点什么…" aria-label="便签内容"></textarea>' +
          '<div class="note__foot">' +
            '<span data-role="meta">已保存</span>' +
            '<button class="mini-btn mini-btn--danger" type="button" data-role="del" aria-label="删除便签" title="删除便签">' + I.svg('trash', 14) + '</button>' +
          '</div>' +
        '</div>';

      var tabsEl = body.querySelector('[data-role="tabs"]');
      var titleEl = body.querySelector('.note__title');
      var textEl = body.querySelector('.note__body');
      var metaEl = body.querySelector('[data-role="meta"]');
      var activeId = ctx.store.get().notes[0].id;

      function current() {
        return ctx.store.get().notes.find(function (n) { return n.id === activeId; }) || null;
      }

      function renderTabs() {
        var notes = ctx.store.get().notes;
        tabsEl.innerHTML = notes.map(function (n) {
          return '<button type="button" class="note__tab' + (n.id === activeId ? ' is-active' : '') + '" data-id="' + esc(n.id) + '">' +
            esc(n.title || '未命名') + '</button>';
        }).join('');
      }

      function load() {
        var note = current();
        if (!note) return;
        titleEl.value = note.title || '';
        textEl.value = note.body || '';
        metaEl.textContent = '已保存 · ' + new Date(note.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      }

      var pending = null;
      var dirty = false;

      function persist() {
        if (!pending && !dirty) return;
        if (pending) { clearTimeout(pending); pending = null; }
        if (!dirty) return;
        var note = current();
        if (note) {
          ctx.store.updateNote(note.id, { title: titleEl.value, body: textEl.value });
          metaEl.textContent = '已保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          renderTabs();
        }
        dirty = false;
      }

      function scheduleSave() {
        metaEl.textContent = '编辑中…';
        dirty = true;
        if (pending) clearTimeout(pending);
        pending = setTimeout(function () {
          pending = null;
          persist();
        }, 450);
      }

      titleEl.addEventListener('input', scheduleSave);
      textEl.addEventListener('input', scheduleSave);

      tabsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-id]');
        if (!btn || btn.dataset.id === activeId) return;
        persist();
        activeId = btn.dataset.id;
        renderTabs();
        load();
      });

      body.querySelector('[data-role="add"]').addEventListener('click', function () {
        persist();
        var note = ctx.store.addNote();
        activeId = note.id;
        renderTabs();
        load();
        titleEl.focus();
      });

      body.querySelector('[data-role="del"]').addEventListener('click', function () {
        persist();
        var note = current();
        if (!note) return;
        ctx.confirm({
          title: '删除便签',
          message: '「' + (note.title || '未命名') + '」将被删除，操作不可撤销。',
          confirmText: '删除',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          ctx.store.removeNote(note.id);
          if (!ctx.store.get().notes.length) ctx.store.addNote();
          activeId = ctx.store.get().notes[0].id;
          renderTabs();
          load();
          ctx.toast('便签已删除');
        });
      });

      renderTabs();
      load();

      return {
        destroy: function () { persist(); }
      };
    }
  });

  /* ============================================================
     倒计时 / 纪念日
     ============================================================ */
  Widgets.register({
    id: 'countdown',
    name: '倒计时',
    desc: '纪念日与目标日期，一眼看到还剩几天',
    icon: 'clock',
    sizes: ['s', 'm'],
    defaultSize: 's',
    mount: function (body, ctx) {
      body.innerHTML =
        '<div class="cd">' +
          '<ul class="cd__list" aria-label="倒计时列表"></ul>' +
          '<div class="cd__foot">' +
            '<button class="mini-btn mini-btn--accent" type="button" data-role="toggle-form" aria-label="添加倒数日" title="添加倒数日">' + I.svg('plus', 15) + '</button>' +
            '<form class="cd__form" hidden>' +
              '<input class="ghost-input" type="text" maxlength="20" placeholder="名称，如：项目上线" aria-label="倒数日名称">' +
              '<input class="ghost-input" type="date" aria-label="日期">' +
              '<button class="mini-btn mini-btn--accent" type="submit" aria-label="保存">' + I.svg('check', 15) + '</button>' +
            '</form>' +
          '</div>' +
        '</div>';

      var listEl = body.querySelector('.cd__list');
      var form = body.querySelector('.cd__form');
      var toggle = body.querySelector('[data-role="toggle-form"]');
      var titleInput = form.querySelector('input[type="text"]');
      var dateInput = form.querySelector('input[type="date"]');

      function render() {
        var items = ctx.store.get().countdowns.map(function (c) {
          return { item: c, days: U.daysUntil(c.date) };
        }).sort(function (a, b) {
          var aPast = a.days < 0, bPast = b.days < 0;
          if (aPast !== bPast) return aPast ? 1 : -1;
          return aPast ? b.days - a.days : a.days - b.days;
        });

        if (!items.length) {
          listEl.innerHTML = '<li class="empty">' + I.svg('clock', 20) + '<span>还没有倒数日</span></li>';
          return;
        }

        listEl.innerHTML = items.map(function (entry) {
          var c = entry.item;
          var d = entry.days;
          var past = d < 0;
          var num = Math.abs(d);
          var small = past ? '天前' : '天';
          var cls = 'cd__item' + (past ? ' is-past' : '') + (d === 0 ? ' is-today' : '');
          var dateLabel = c.date.slice(5).replace('-', '/');
          if (d === 0) small = '今天';
          return '<li class="' + cls + '" data-id="' + esc(c.id) + '">' +
            '<span class="cd__num"><b>' + (d === 0 ? '今天' : num) + '</b>' + (d === 0 ? '' : '<small>' + small + '</small>') + '</span>' +
            '<span class="cd__info">' +
              '<span class="cd__title">' + esc(c.title) + (c.kind === 'anniversary' ? ' <span class="tag">纪念</span>' : '') + '</span>' +
              '<span class="cd__date">' + dateLabel + ' · ' + U.daysText(d) + '</span>' +
            '</span>' +
            '<button class="mini-btn mini-btn--danger cd__remove" type="button" data-act="del" aria-label="删除">' + I.svg('x', 14) + '</button>' +
          '</li>';
        }).join('');
      }

      toggle.addEventListener('click', function () {
        form.hidden = !form.hidden;
        if (!form.hidden) {
          if (!dateInput.value) dateInput.value = U.addDays(U.todayKey(), 30);
          titleInput.focus();
        }
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var title = titleInput.value.trim();
        if (!title) { ctx.toast('先起个名字吧'); return; }
        var added = ctx.store.addCountdown(title, dateInput.value, 'countdown');
        if (!added) { ctx.toast('日期不合法', 'err'); return; }
        titleInput.value = '';
        form.hidden = true;
        ctx.toast('已添加倒数日', 'ok');
      });

      listEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act="del"]');
        if (!btn) return;
        var li = btn.closest('[data-id]');
        ctx.store.removeCountdown(li.dataset.id);
      });

      var off = ctx.store.on('countdowns', render);
      render();
      return { destroy: off };
    }
  });

  /* ============================================================
     习惯打卡
     ============================================================ */
  Widgets.register({
    id: 'habits',
    name: '习惯打卡',
    desc: '最近 7 天打卡，自动计算连续天数',
    icon: 'target',
    sizes: ['m', 'l'],
    defaultSize: 'm',
    mount: function (body, ctx) {
      var days = U.lastNDays(7);

      body.innerHTML =
        '<div class="hb">' +
          '<div class="hb__head">' +
            '<span style="text-align:left;padding-left:2px">习惯</span>' +
            days.map(function (d) { return '<span>' + U.weekdayShort(d) + '</span>'; }).join('') +
            '<span>连续</span>' +
          '</div>' +
          '<div class="hb__list" data-role="rows"></div>' +
          '<form class="hb__foot">' +
            '<input class="ghost-input" type="text" maxlength="20" placeholder="添加习惯，如：阅读" aria-label="新习惯">' +
            '<button class="mini-btn mini-btn--accent" type="submit" aria-label="添加习惯">' + I.svg('plus', 15) + '</button>' +
          '</form>' +
        '</div>';

      var rowsEl = body.querySelector('[data-role="rows"]');
      var form = body.querySelector('.hb__foot');
      var input = form.querySelector('input');
      var today = U.todayKey();

      function streak(dates) {
        var set = {};
        dates.forEach(function (d) { set[d] = true; });
        var cursor = new Date();
        if (!set[U.todayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
        var n = 0;
        while (set[U.todayKey(cursor)]) {
          n++;
          cursor.setDate(cursor.getDate() - 1);
          if (n > 400) break;
        }
        return n;
      }

      function render() {
        var habits = ctx.store.get().habits;
        if (!habits.length) {
          rowsEl.innerHTML = '<div class="empty">' + I.svg('target', 20) + '<span>添加一个想坚持的习惯</span></div>';
          return;
        }
        rowsEl.innerHTML = habits.map(function (h) {
          var set = {};
          h.dates.forEach(function (d) { set[d] = true; });
          return '<div class="hb__row" data-id="' + esc(h.id) + '">' +
            '<span class="hb__name" title="' + esc(h.name) + '">' + esc(h.name) + '</span>' +
            days.map(function (d) {
              var cls = 'hb__dot' + (set[d] ? ' is-on' : '') + (d === today ? ' is-today' : '');
              return '<button type="button" class="' + cls + '" data-date="' + d + '" aria-label="' + esc(h.name) + ' ' + d + (set[d] ? ' 已打卡' : ' 未打卡') + '" aria-pressed="' + (set[d] ? 'true' : 'false') + '"></button>';
            }).join('') +
            '<span class="hb__streak">' + I.svg('flame', 11) + streak(h.dates) + '</span>' +
          '</div>';
        }).join('');
      }

      rowsEl.addEventListener('click', function (e) {
        var dot = e.target.closest('.hb__dot');
        if (!dot) return;
        var row = dot.closest('[data-id]');
        ctx.store.toggleHabitDate(row.dataset.id, dot.dataset.date);
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = input.value.trim();
        if (!name) return;
        ctx.store.addHabit(name);
        input.value = '';
      });

      var off = ctx.store.on('habits', render);
      render();
      return { destroy: off };
    }
  });

  /* ============================================================
     番茄钟
     ============================================================ */
  Widgets.register({
    id: 'pomodoro',
    name: '番茄钟',
    desc: '25 分钟专注 + 5 分钟休息，进度环实时可见',
    icon: 'timer',
    sizes: ['s', 'm'],
    defaultSize: 's',
    mount: function (body, ctx) {
      var C = 2 * Math.PI * 36;

      body.innerHTML =
        '<div class="pomo">' +
          '<div class="pomo__ring">' +
            '<svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">' +
              '<circle class="pomo__track" cx="42" cy="42" r="36"></circle>' +
              '<circle class="pomo__bar" cx="42" cy="42" r="36" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="0"></circle>' +
            '</svg>' +
            '<div class="pomo__center">' +
              '<span class="pomo__time" data-role="time">25:00</span>' +
              '<span class="pomo__label" data-role="label">专注</span>' +
            '</div>' +
          '</div>' +
          '<div class="pomo__controls">' +
            '<button class="pomo__btn pomo__btn--main" type="button" data-role="toggle">开始</button>' +
            '<button class="pomo__btn" type="button" data-role="reset">重置</button>' +
          '</div>' +
        '</div>';

      var rootEl = body.querySelector('.pomo');
      var bar = body.querySelector('.pomo__bar');
      var timeEl = body.querySelector('[data-role="time"]');
      var labelEl = body.querySelector('[data-role="label"]');
      var toggleBtn = body.querySelector('[data-role="toggle"]');
      var resetBtn = body.querySelector('[data-role="reset"]');
      var timer = null;
      var guardTimer = null;

      function totalSeconds() {
        var p = ctx.store.get().pomodoro;
        return (p.mode === 'focus' ? p.focus : p.rest) * 60;
      }

      function remainingSeconds() {
        var p = ctx.store.get().pomodoro;
        if (p.running && p.endsAt) return Math.max(0, (p.endsAt - Date.now()) / 1000);
        return Math.max(0, p.remaining);
      }

      function paint() {
        var p = ctx.store.get().pomodoro;
        var left = remainingSeconds();
        var total = totalSeconds();
        var ratio = total ? U.clamp(left / total, 0, 1) : 0;
        body.querySelector('.pomo').classList.toggle('is-break', p.mode === 'rest');
        timeEl.textContent = U.formatDuration(Math.ceil(left));
        labelEl.textContent = p.mode === 'focus' ? '专注' : '休息';
        toggleBtn.textContent = p.running ? '暂停' : (left < total ? '继续' : '开始');
        bar.setAttribute('stroke-dashoffset', (C * (1 - ratio)).toFixed(2));
      }

      function complete() {
        var p = ctx.store.get().pomodoro;
        var nextMode = p.mode === 'focus' ? 'rest' : 'focus';
        var nextSec = (nextMode === 'focus' ? p.focus : p.rest) * 60;
        ctx.store.setPomodoro({ mode: nextMode, running: false, endsAt: null, remaining: nextSec });
        paint();
        ctx.toast(p.mode === 'focus' ? '专注完成，休息一下 ☕' : '休息结束，继续专注 🍅', 'ok');
        if (timer) { clearInterval(timer); timer = null; }
      }

      function tick() {
        var p = ctx.store.get().pomodoro;
        if (!p.running) return;
        if (remainingSeconds() <= 0.05) {
          complete();
          return;
        }
        paint();
      }

      function ensureTimer() {
        if (timer) return;
        timer = setInterval(tick, 300);
      }

      toggleBtn.addEventListener('click', function () {
        var p = ctx.store.get().pomodoro;
        if (p.running) {
          var left = remainingSeconds();
          ctx.store.setPomodoro({ running: false, endsAt: null, remaining: Math.max(0, left) });
          paint();
          return;
        }
        var total = totalSeconds();
        var remaining = p.remaining > 0 ? p.remaining : total;
        ctx.store.setPomodoro({ running: true, endsAt: Date.now() + remaining * 1000 });
        ensureTimer();
        paint();
      });

      resetBtn.addEventListener('click', function () {
        var p = ctx.store.get().pomodoro;
        ctx.store.setPomodoro({ running: false, endsAt: null, mode: 'focus', remaining: p.focus * 60 });
        paint();
      });

      // 重新打开页面时，未结束的计时继续
      var p0 = ctx.store.get().pomodoro;
      if (p0.running && p0.endsAt) {
        if (p0.endsAt <= Date.now()) {
          ctx.store.setPomodoro({ running: false, endsAt: null, mode: 'focus', remaining: p0.focus * 60 });
        } else {
          ensureTimer();
          guardTimer = setInterval(function () {
            var p = ctx.store.get().pomodoro;
            if (!p.running) { clearInterval(guardTimer); guardTimer = null; return; }
            if (p.endsAt <= Date.now()) { clearInterval(guardTimer); guardTimer = null; complete(); }
          }, 500);
        }
      }
      paint();

      return {
        destroy: function () {
          if (timer) clearInterval(timer);
          if (guardTimer) clearInterval(guardTimer);
          timer = null;
          guardTimer = null;
        }
      };
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
