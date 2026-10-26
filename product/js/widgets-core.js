/* Lumen Tab — 小组件注册表 + 核心小组件（年度进度 / 天气 / 名言 / 日历 / 热榜） */
(function (root) {
  'use strict';
  var U = root.LumenUtil;
  var D = root.LumenData;
  var I = root.LumenIcons;

  var defs = Object.create(null);
  var order = [];

  function register(def) {
    if (!def || !def.id || typeof def.mount !== 'function') {
      throw new Error('组件定义不完整: ' + (def && def.id));
    }
    if (defs[def.id]) throw new Error('组件重复注册: ' + def.id);
    defs[def.id] = def;
    order.push(def.id);
  }

  var Widgets = {
    register: register,
    get: function (id) { return defs[id] || null; },
    has: function (id) { return !!defs[id]; },
    list: function () { return order.map(function (id) { return defs[id]; }); },
    ids: function () { return order.slice(); }
  };
  root.LumenWidgets = Widgets;

  /* ============================================================
     年度进度
     ============================================================ */
  register({
    id: 'year-progress',
    name: '年度进度',
    desc: '今年已经走过多少，还剩多少天',
    icon: 'target',
    sizes: ['s'],
    defaultSize: 's',
    mount: function (body) {
      var p = U.yearProgress();
      var r = 25;
      var c = 2 * Math.PI * r;
      var offset = c * (1 - p.passed / p.total);
      body.innerHTML =
        '<div class="yp">' +
          '<div class="yp__ring">' +
            '<svg viewBox="0 0 58 58" width="58" height="58" aria-hidden="true">' +
              '<circle class="yp__track" cx="29" cy="29" r="' + r + '"></circle>' +
              '<circle class="yp__bar" cx="29" cy="29" r="' + r + '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '"></circle>' +
            '</svg>' +
            '<span class="yp__pct">' + p.percent + '%</span>' +
          '</div>' +
          '<div class="yp__info">' +
            '<span class="yp__big">第 ' + p.passed + ' 天</span>' +
            '<span class="yp__small">' + p.year + ' 年还剩 ' + p.left + ' 天<br>已经走过 ' + p.percent + '%</span>' +
          '</div>' +
        '</div>';
    }
  });

  /* ============================================================
     天气（本地模拟，按城市 + 日期种子生成）
     ============================================================ */
  function dayForecast(city, dateKey) {
    var d = U.parseKey(dateKey);
    var rnd = U.seeded(city.id + '|' + dateKey + '|wx');
    var cond = D.CONDITIONS[Math.floor(rnd() * D.CONDITIONS.length) % D.CONDITIONS.length];
    var seasonal = Math.sin(((U.dayOfYear(d) - 80) / 365) * Math.PI * 2); // -1 ~ 1
    var base = city.base + seasonal * 2.2;
    var mid = Math.round(base + (rnd() * 5 - 2.5));
    var low = mid - (3 + Math.floor(rnd() * 5));
    var high = mid + (2 + Math.floor(rnd() * 4));
    var humidity = U.clamp(Math.round(city.humidity + (rnd() * 16 - 8)), 20, 98);
    return { cond: cond, mid: mid, low: low, high: high, humidity: humidity };
  }

  function currentReading(city, now) {
    var today = dayForecast(city, U.todayKey(now));
    var h = now.getHours() + now.getMinutes() / 60;
    var wave = Math.sin(((h - 9) / 24) * Math.PI * 2) * 3.2;
    return {
      temp: Math.round(today.mid + wave),
      cond: today.cond,
      humidity: today.humidity,
      high: today.high,
      low: today.low,
      wind: city.wind
    };
  }

  function weatherDays(city, now) {
    var today = U.todayKey(now);
    var days = [];
    for (var i = 0; i < 5; i++) {
      var key = U.addDays(today, i);
      days.push({
        key: key,
        label: i === 0 ? '今天' : i === 1 ? '明天' : '周' + U.weekdayShort(key),
        fc: dayForecast(city, key)
      });
    }
    return days;
  }

  function weatherSourceText(source, updatedAt, error) {
    if (source === 'demo') return '演示数据，不联网';
    if (source === 'loading') return '正在获取实时天气…';
    if (source === 'error') return '联网失败，显示演示数据';
    var stamp = updatedAt ? new Date(updatedAt) : new Date();
    var time = stamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (source === 'stale') return '离线缓存 · ' + time;
    return '实时 · Open-Meteo · ' + time;
  }

  register({
    id: 'weather',
    name: '天气',
    desc: '实时天气与五日预报（Open-Meteo；可切换演示数据）',
    icon: 'sun',
    sizes: ['s', 'm'],
    defaultSize: 'm',
    mount: function (body, ctx) {
      var state = ctx.store.get();
      var city = D.CITIES.find(function (c) { return c.id === state.weatherCity; }) || D.CITIES[0];
      var now = new Date();
      var live = state.settings.weatherSource !== 'demo';
      var demoCur = currentReading(city, now);
      var demoDays = weatherDays(city, now);
      var alive = true;

      body.classList.toggle('wx--s', ctx.size === 's');

      function paint(cur, days, source, error, updatedAt) {
        if (!alive) return;
        var cityOptions = D.CITIES.map(function (c) {
          return '<option value="' + c.id + '"' + (c.id === city.id ? ' selected' : '') + '>' + U.escapeHtml(c.name) + '</option>';
        }).join('');

        var forecast = [];
        for (var i = 0; i < 5; i++) {
          var item = days[i] || demoDays[i];
          var key = item.key || U.addDays(U.todayKey(), i);
          forecast.push({
            key: key,
            label: i === 0 ? '今天' : i === 1 ? '明天' : '周' + U.weekdayShort(key),
            fc: item.fc
          });
        }

        body.innerHTML =
          '<div class="wx" data-source="' + source + '">' +
            '<div class="wx__now">' +
              '<span class="wx__icon">' + I.svg(cur.cond.icon, 30) + '</span>' +
              '<div class="wx__main">' +
                '<div class="wx__temp">' + cur.temp + '<sup>°C</sup></div>' +
                '<div class="wx__meta">' +
                  '<span>' + U.escapeHtml(cur.cond.label) + '</span><span>·</span>' +
                  '<span>' + cur.low + '° ~ ' + cur.high + '°</span>' +
                  '<span>·</span><span>湿度 ' + cur.humidity + '%</span>' +
                '</div>' +
              '</div>' +
              '<select class="wx__city" aria-label="选择城市">' + cityOptions + '</select>' +
            '</div>' +
            '<div class="wx__meta wx__source"><span>' + U.escapeHtml(cur.wind) + '</span><span>·</span>' +
              '<span title="' + (error ? U.escapeHtml(error.message || '天气服务不可用') : '') + '">' +
                U.escapeHtml(weatherSourceText(source, updatedAt, error)) + '</span>' +
              (live ? '<button type="button" class="wx__refresh" data-role="refresh-weather" aria-label="刷新天气" title="刷新天气">↻</button>' : '') +
            '</div>' +
            '<div class="wx__days">' +
              forecast.map(function (d) {
                return '<div class="wx__day" title="' + U.escapeHtml(d.fc.cond.label) + '">' +
                  '<span class="wx__day-name">' + d.label + '</span>' +
                  I.svg(d.fc.cond.icon, 17) +
                  '<span class="wx__day-temp"><b>' + d.fc.high + '°</b> ' + d.fc.low + '°</span>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>';

        var select = body.querySelector('.wx__city');
        select.addEventListener('change', function () {
          alive = false;
          ctx.store.update(['weatherCity'], function (s) { s.weatherCity = select.value; });
          ctx.rerender();
        });

        var refresh = body.querySelector('[data-role="refresh-weather"]');
        if (refresh) {
          refresh.addEventListener('click', function () {
            refresh.disabled = true;
            load(true);
          });
        }
      }

      function load(force) {
        if (!live) {
          paint(demoCur, demoDays, 'demo');
          return;
        }
        var W = root.LumenWeather;
        if (!W) {
          paint(demoCur, demoDays, 'error', { message: '当前版本缺少天气模块' });
          return;
        }
        var cached = W.peek(city.id);
        if (cached && !force) paint(cached.current, cached.days, cached.stale ? 'stale' : 'live', cached.error, cached.updatedAt);
        else if (!cached) paint(demoCur, demoDays, 'loading');

        W.load(city, { force: !!force }).then(function (data) {
          if (!alive) return;
          paint(data.current, data.days, data.stale ? 'stale' : 'live', data.error, data.updatedAt);
        }).catch(function (err) {
          if (!alive) return;
          paint(demoCur, demoDays, 'error', err);
        });
      }

      load(false);
    }
  });

  /* ============================================================
     每日一句
     ============================================================ */
  register({
    id: 'quote',
    name: '每日一句',
    desc: '每天一句古文，可收藏与切换',
    icon: 'quote',
    sizes: ['s', 'm'],
    defaultSize: 's',
    mount: function (body, ctx) {
      var heading = '<div class="quote">' +
        '<p class="quote__text" data-role="text"></p>' +
        '<div class="quote__foot">' +
          '<span class="quote__author" data-role="author"></span>' +
          '<span class="quote__actions">' +
            '<button class="mini-btn" type="button" data-role="prev" aria-label="上一句" title="上一句">' + I.svg('chevron-left', 15) + '</button>' +
            '<button class="mini-btn" type="button" data-role="next" aria-label="下一句" title="下一句">' + I.svg('chevron-right', 15) + '</button>' +
            '<button class="mini-btn" type="button" data-role="fav" aria-label="收藏" title="收藏">' + I.svg('star', 15) + '</button>' +
          '</span>' +
        '</div>' +
      '</div>';
      body.innerHTML = heading;

      var textEl = body.querySelector('[data-role="text"]');
      var authorEl = body.querySelector('[data-role="author"]');
      var favBtn = body.querySelector('[data-role="fav"]');

      function index() {
        var s = ctx.store.get();
        var base = (U.dayOfYear() - 1 + s.quoteOffset) % D.QUOTES.length;
        if (base < 0) base += D.QUOTES.length;
        return base;
      }

      function render() {
        var idx = index();
        var q = D.QUOTES[idx];
        var faved = ctx.store.get().quoteFav.indexOf(idx) >= 0;
        textEl.textContent = q.text;
        authorEl.textContent = '—— ' + q.author;
        favBtn.classList.toggle('is-fav', faved);
        favBtn.setAttribute('aria-pressed', faved ? 'true' : 'false');
        favBtn.innerHTML = I.svg('star', 15);
      }

      body.querySelector('[data-role="prev"]').addEventListener('click', function () {
        ctx.store.setQuoteOffset(ctx.store.get().quoteOffset - 1);
        render();
      });
      body.querySelector('[data-role="next"]').addEventListener('click', function () {
        ctx.store.setQuoteOffset(ctx.store.get().quoteOffset + 1);
        render();
      });
      favBtn.addEventListener('click', function () {
        ctx.store.toggleQuoteFav(index());
        render();
        ctx.toast(idxFavMessage(index()), 'ok');
      });

      function idxFavMessage(idx) {
        return ctx.store.get().quoteFav.indexOf(idx) >= 0 ? '已收藏这句' : '已取消收藏';
      }

      render();
    }
  });

  /* ============================================================
     日历
     ============================================================ */
  register({
    id: 'calendar',
    name: '日历',
    desc: '月历视图，标注今天与倒计时日期',
    icon: 'calendar',
    sizes: ['s', 'm'],
    defaultSize: 'm',
    mount: function (body, ctx) {
      var DOW = ['日', '一', '二', '三', '四', '五', '六'];

      function cursorDate() {
        var c = ctx.store.get().calendarCursor || U.todayKey().slice(0, 7);
        var p = c.split('-').map(Number);
        return new Date(p[0], p[1] - 1, 1);
      }

      function moveBy(n) {
        var d = cursorDate();
        d.setMonth(d.getMonth() + n);
        var key = d.getFullYear() + '-' + U.pad(d.getMonth() + 1);
        ctx.store.update(['calendarCursor'], function (s) { s.calendarCursor = key; });
        render();
      }

      function render() {
        var cur = cursorDate();
        var y = cur.getFullYear();
        var m = cur.getMonth();
        var firstDow = new Date(y, m, 1).getDay();
        var daysInMonth = new Date(y, m + 1, 0).getDate();
        var prevDays = new Date(y, m, 0).getDate();
        var today = U.todayKey();
        var marks = {};
        ctx.store.get().countdowns.forEach(function (c) {
          if (c.date.slice(0, 7) === y + '-' + U.pad(m + 1)) marks[Number(c.date.slice(8, 10))] = c.title;
        });

        var cells = [];
        var total = Math.ceil((firstDow + daysInMonth) / 7) * 7;
        for (var i = 0; i < total; i++) {
          var dayNum;
          var other = false;
          if (i < firstDow) {
            dayNum = prevDays - firstDow + i + 1;
            other = true;
          } else if (i >= firstDow + daysInMonth) {
            dayNum = i - (firstDow + daysInMonth) + 1;
            other = true;
          } else {
            dayNum = i - firstDow + 1;
          }
          var key = y + '-' + U.pad(m + 1) + '-' + U.pad(dayNum);
          var dow = i % 7;
          var cls = 'cal__day' + (other ? ' is-other' : '') + (dow === 0 || dow === 6 ? ' is-weekend' : (other ? '' : ''));
          if (!other && key === today) cls += ' is-today';
          if (!other && marks[dayNum]) cls += ' has-dot';
          cells.push('<button type="button" class="' + cls + '" data-date="' + key + '" data-other="' + (other ? '1' : '') + '"' +
            (marks[dayNum] ? ' title="' + U.escapeHtml(marks[dayNum]) + '"' : '') + '>' + dayNum + '</button>');
        }

        body.innerHTML =
          '<div class="cal">' +
            '<div class="cal__head">' +
              '<span class="cal__month">' + y + ' 年 ' + (m + 1) + ' 月</span>' +
              '<span class="cal__nav">' +
                '<button class="mini-btn" type="button" data-nav="-1" aria-label="上个月">' + I.svg('chevron-left', 15) + '</button>' +
                '<button class="mini-btn" type="button" data-nav="0" aria-label="回到今天" title="回到今天">' + I.svg('target', 14) + '</button>' +
                '<button class="mini-btn" type="button" data-nav="1" aria-label="下个月">' + I.svg('chevron-right', 15) + '</button>' +
              '</span>' +
            '</div>' +
            '<div class="cal__grid">' +
              DOW.map(function (d) { return '<span class="cal__dow">' + d + '</span>'; }).join('') +
              cells.join('') +
            '</div>' +
          '</div>';

        body.querySelectorAll('[data-nav]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var n = Number(btn.dataset.nav);
            if (n === 0) {
              ctx.store.update(['calendarCursor'], function (s) { s.calendarCursor = U.todayKey().slice(0, 7); });
              render();
            } else {
              moveBy(n);
            }
          });
        });

        body.querySelectorAll('.cal__day').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var key = btn.dataset.date;
            var diff = U.daysUntil(key);
            var txt = key.replace(/-/g, '/') + ' · ' + (diff === 0 ? '就是今天' : diff > 0 ? '距今还有 ' + diff + ' 天' : '已过去 ' + Math.abs(diff) + ' 天');
            ctx.toast(txt);
          });
        });
      }

      render();
    }
  });

  /* ============================================================
     热榜（演示数据）
     ============================================================ */
  register({
    id: 'hotlist',
    name: '热榜',
    desc: '微博 / 知乎 / 百度 模拟热榜，点击可搜索',
    icon: 'flame',
    sizes: ['s', 'm'],
    defaultSize: 'm',
    mount: function (body, ctx) {
      function render() {
        var state = ctx.store.get();
        var source = D.HOT_SOURCES.find(function (s) { return s.id === state.hotSource; }) || D.HOT_SOURCES[0];
        var rnd = U.seeded(source.id + '|' + U.todayKey() + '|hot');
        var items = source.items.map(function (title, i) {
          var heat = 120 + Math.floor(rnd() * 880);
          return { title: title, heat: heat };
        });

        body.innerHTML =
          '<div class="hot">' +
            '<div class="hot__tabs">' +
              D.HOT_SOURCES.map(function (s) {
                return '<button type="button" class="hot__tab' + (s.id === source.id ? ' is-active' : '') + '" data-src="' + s.id + '">' + s.name + '</button>';
              }).join('') +
              '<span class="hot__badge">演示</span>' +
            '</div>' +
            '<ol class="hot__list">' +
              items.map(function (it, i) {
                return '<li><button type="button" class="hot__item" data-q="' + U.escapeHtml(it.title) + '">' +
                  '<span class="hot__rank">' + (i + 1) + '</span>' +
                  '<span class="hot__title">' + U.escapeHtml(it.title) + '</span>' +
                  '<span class="hot__heat">' + it.heat + '万</span>' +
                '</button></li>';
              }).join('') +
            '</ol>' +
          '</div>';

        body.querySelectorAll('.hot__tab').forEach(function (btn) {
          btn.addEventListener('click', function () {
            ctx.store.update(['hotSource'], function (s) { s.hotSource = btn.dataset.src; });
            render();
          });
        });

        body.querySelectorAll('.hot__item').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var s = ctx.store.get();
            var engine = D.ENGINES.find(function (e) { return e.id === s.settings.searchEngine; }) || D.ENGINES[0];
            ctx.openUrl(engine.url + encodeURIComponent(btn.dataset.q));
          });
        });
      }

      render();
    }
  });

  // 供 AI 助手复用同一套天气算法
  Widgets.weather = { dayForecast: dayForecast, currentReading: currentReading };
})(typeof globalThis !== 'undefined' ? globalThis : this);
