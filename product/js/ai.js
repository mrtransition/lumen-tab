/* Lumen Tab — AI 助手：默认本地规则引擎；可切换 OpenAI 兼容 API 模型 */
(function (root) {
  'use strict';
  var U = root.LumenUtil;
  var D = root.LumenData;
  var I = root.LumenIcons;

  var ctx = null;
  var els = {};
  var typingTimer = null;
  var TYPE_DELAY = 420;
  var busy = false;
  var abortCtrl = null;
  var sessionVersion = 0;

  function init(context) {
    ctx = context;
    els.messages = document.getElementById('aiMessages');
    els.chips = document.getElementById('aiChips');
    els.form = document.getElementById('aiForm');
    els.input = document.getElementById('aiInput');
    els.sendBtn = document.getElementById('aiSendBtn');
    els.stopBtn = document.getElementById('aiStopBtn');
    els.modeTag = document.getElementById('aiModeTag');
    els.note = document.getElementById('aiNote');
    els.configBtn = document.getElementById('aiConfigBtn');
    els.newBtn = document.getElementById('aiNewBtn');

    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      send(els.input.value);
    });

    els.chips.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-prompt]');
      if (!btn) return;
      send(btn.dataset.prompt);
    });

    els.messages.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-md-copy]');
      if (!btn) return;
      var box = btn.closest('.md-code');
      var code = box && box.querySelector('code');
      if (!code) return;
      U.copyText(code.textContent).then(function () {
        btn.textContent = '已复制';
        ctx.toast('代码已复制', 'ok');
        setTimeout(function () {
          if (btn.isConnected) btn.textContent = '复制';
        }, 1400);
      }).catch(function (err) {
        ctx.toast((err && err.message) || '复制失败', 'err');
      });
    });

    els.stopBtn.addEventListener('click', function () {
      if (abortCtrl) abortCtrl.abort();
    });

    els.configBtn.addEventListener('click', function () {
      if (ctx.openSettingsTab) ctx.openSettingsTab('ai');
      else if (root.LumenUI) root.LumenUI.openPanel('settings');
    });

    if (els.newBtn) els.newBtn.addEventListener('click', startNewSession);

    ctx.store.on('settings', syncMode);
    syncMode();
  }

  function syncMode() {
    var ai = (ctx.store.get().settings.ai) || {};
    var api = ai.mode === 'api';
    if (els.modeTag) {
      els.modeTag.textContent = api ? (ai.model || 'API 模型') : '本地规则';
      els.modeTag.title = api ? ('通过 ' + (ai.baseUrl || 'API') + ' 调用') : '离线规则引擎';
    }
    if (els.note) {
      els.note.textContent = api
        ? '回复由 ' + (ai.model || '配置的模型') + ' 生成；请求会发送到你配置的接口，本机上下文仅作参考。'
        : '离线规则引擎，不会发起网络请求；回复基于你本机数据。';
    }
  }

  function markdownHtml(text) {
    if (!root.LumenMarkdown) return null;
    try { return root.LumenMarkdown.render(text); }
    catch (err) { return null; }
  }

  function paintAiBubble(bubble, text) {
    if (!bubble) return;
    var html = markdownHtml(text);
    if (html === null) {
      bubble.textContent = text;
      return;
    }
    bubble.classList.add('msg__bubble--md');
    bubble.innerHTML = html;
  }

  /* ---------- 渲染 ---------- */
  function renderMessages() {
    var msgs = ctx.store.get().aiMessages;
    els.messages.innerHTML = msgs.map(function (m) {
      var time = new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      var isUser = m.role === 'user';
      var think = !isUser && m.reasoning
        ? '<details class="msg__think"><summary>思考过程</summary><div class="msg__think-body"></div></details>'
        : '';
      return '<div class="msg msg--' + (isUser ? 'user' : 'ai') + '">' +
        think +
        '<div class="msg__bubble' + (isUser ? '' : ' msg__bubble--md') + '"></div>' +
        '<span class="msg__time">' + time + '</span>' +
      '</div>';
    }).join('');
    // 文本用 textContent 写入，Markdown 只接受白名单语法后再生成标签
    var nodes = els.messages.querySelectorAll('.msg');
    msgs.forEach(function (m, i) {
      var node = nodes[i];
      if (!node) return;
      if (m.reasoning) {
        var body = node.querySelector('.msg__think-body');
        if (body) body.textContent = m.reasoning;
      }
      var bubble = node.querySelector('.msg__bubble');
      if (!bubble) return;
      if (m.role === 'user') bubble.textContent = m.text;
      else paintAiBubble(bubble, m.text);
    });
    scrollToBottom();
  }

  function appendTyping() {
    var el = document.createElement('div');
    el.className = 'msg msg--ai msg--typing';
    el.innerHTML = '<div class="msg__bubble"><i></i><i></i><i></i></div>';
    els.messages.appendChild(el);
    scrollToBottom();
    return el;
  }

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  /* ---------- 发送 ---------- */
  function resetSession() {
    sessionVersion += 1;
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    if (abortCtrl) {
      try { abortCtrl.abort(); } catch (err) { /* 忽略中止失败 */ }
      abortCtrl = null;
    }
    setBusyUi(false);
    if (els.input) els.input.value = '';
    ctx.store.clearAiMessages();
    renderMessages();
    scrollToBottom();
    if (els.input) els.input.focus();
  }

  function startNewSession() {
    var current = ctx.store.get().aiMessages;
    var hasHistory = current.some(function (m) { return m.role === 'user'; });
    var ask = hasHistory
      ? ctx.confirm({
          title: '开始新会话',
          message: '当前对话会从本机清除，且不会被重新加载。',
          confirmText: '开始新会话'
        })
      : Promise.resolve(true);
    ask.then(function (ok) {
      if (!ok) return;
      resetSession();
      ctx.toast('已开始新会话', 'ok');
    });
  }

  function send(raw) {
    var text = String(raw || '').trim();
    if (!text || busy) return;
    els.input.value = '';

    // 清空对话始终在本地处理，不把控制指令发给模型
    if (has(text, ['清空对话', '清除对话', '清空聊天', '重置对话'])) {
      resetSession();
      ctx.toast('对话已清空', 'ok');
      return;
    }

    var epoch = sessionVersion;
    ctx.store.addAiMessage('user', text);
    renderMessages();
    var ai = (ctx.store.get().settings.ai) || {};
    if (ai.mode === 'api') sendViaApi(ai, epoch);
    else sendLocal(text, epoch);
  }

  function sendLocal(text, epoch) {
    var typing = appendTyping();
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(function () {
      if (epoch !== sessionVersion) return;
      typing.remove();
      var answer = reply(text);
      ctx.store.addAiMessage('ai', answer);
      renderMessages();
      typingTimer = null;
    }, TYPE_DELAY);
  }

  function setBusyUi(on) {
    busy = on;
    if (els.sendBtn) els.sendBtn.hidden = on;
    if (els.stopBtn) {
      els.stopBtn.hidden = !on;
      els.stopBtn.disabled = false;
    }
    if (els.form) els.form.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function appendError(message) {
    var el = document.createElement('div');
    el.className = 'msg msg--ai msg--error';
    el.innerHTML = '<div class="msg__bubble"></div><span class="msg__time">提示</span>';
    el.querySelector('.msg__bubble').textContent = '⚠️ ' + message;
    els.messages.appendChild(el);
    scrollToBottom();
  }

  function appendStreaming() {
    var el = document.createElement('div');
    el.className = 'msg msg--ai msg--streaming';
    el.innerHTML =
      '<details class="msg__think" hidden><summary>思考过程</summary><div class="msg__think-body"></div></details>' +
      '<div class="msg__bubble msg__bubble--md"></div><span class="msg__time">生成中</span>';
    els.messages.appendChild(el);
    scrollToBottom();
    return {
      el: el,
      think: el.querySelector('.msg__think'),
      summary: el.querySelector('.msg__think summary'),
      thinkBody: el.querySelector('.msg__think-body'),
      bubble: el.querySelector('.msg__bubble'),
      time: el.querySelector('.msg__time')
    };
  }

  function apiConfig() {
    var ai = (ctx.store.get().settings.ai) || {};
    return {
      baseUrl: ai.baseUrl || '',
      model: ai.model || '',
      apiKey: ai.apiKey || '',
      temperature: ai.temperature,
      maxTokens: ai.maxTokens
    };
  }

  function apiContext() {
    var s = ctx.store.get();
    var openTodos = s.todos.filter(function (t) { return !t.done; });
    var lines = [];
    lines.push('你是 Lumen Tab 新标签页里的 AI 助手。用简体中文回答，简洁、具体、可执行。');
    var custom = String((s.settings.ai && s.settings.ai.instructions) || '').trim();
    if (custom) {
      lines.push('用户对助手的附加设定（在不违背事实与安全要求的前提下遵循）：');
      lines.push(custom);
    }
    lines.push('当前时间：' + U.fmtDateZh(new Date()) + ' ' + U.fmtClock(new Date(), true) + '。');
    lines.push('以下是你可参考的本机数据（来自用户本地，不要声称已经上传到云端）：');
    lines.push('· 待办：' + (openTodos.length
      ? openTodos.slice(0, 10).map(function (t) { return t.text; }).join('；') + (openTodos.length > 10 ? ' 等' : '')
      : '没有未完成待办'));
    if (s.habits.length) {
      lines.push('· 习惯：' + s.habits.slice(0, 8).map(function (h) {
        return h.name + '（连续 ' + streak(h.dates) + ' 天）';
      }).join('；'));
    }
    var dates = sortedCountdowns().slice(0, 5);
    if (dates.length) {
      lines.push('· 倒计时：' + dates.map(function (e) {
        return e.c.title + ' ' + U.daysText(e.days);
      }).join('；'));
    }
    var weather = weatherBlock();
    if (weather) lines.push('· 天气（实时缓存或演示）：' + weather.split('\n')[0]);
    lines.push('你无法直接修改应用里的待办、习惯或计时器；如果用户要求执行这类操作，请给出可直接复制的文本，并提醒切回「本地规则」模式执行。');
    lines.push('不要编造没有提供的个人数据；不知道就直说。');
    return lines.join('\n');
  }

  function apiMessages() {
    var history = ctx.store.get().aiMessages.slice(-14).map(function (m) {
      return {
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.text || '').slice(0, 4000)
      };
    });
    return [{ role: 'system', content: apiContext() }].concat(history);
  }

  function sendViaApi(ai, epoch) {
    var API = root.LumenAIApi;
    if (!API) {
      appendError('接口模块没有加载，请刷新页面后重试。');
      return;
    }
    var invalid = API.configError(apiConfig());
    if (invalid) {
      appendError(invalid + '。请点右上角齿轮，在「设置 → AI」里完成配置。');
      ctx.toast(invalid, 'err');
      return;
    }

    setBusyUi(true);
    abortCtrl = new AbortController();
    var typing = appendTyping();
    var stream = null;
    var answer = '';
    var reasoning = '';

    function ensureStream() {
      if (!stream) {
        typing.remove();
        stream = appendStreaming();
      }
      return stream;
    }

    function persistPartial(fallback) {
      var a = answer.trim();
      var r = reasoning.trim();
      if (!a && !r) return false;
      ctx.store.addAiMessage('ai', a || fallback, r);
      renderMessages();
      return true;
    }

    API.chat(apiConfig(), apiMessages(), {
      signal: abortCtrl.signal,
      onReasoning: function (piece) {
        if (epoch !== sessionVersion || !busy) return;
        var ui = ensureStream();
        reasoning += piece;
        ui.think.hidden = false;
        ui.think.open = true;
        ui.summary.textContent = '思考中…';
        ui.thinkBody.textContent = reasoning;
        ui.thinkBody.scrollTop = ui.thinkBody.scrollHeight;
        scrollToBottom();
      },
      onDelta: function (piece) {
        if (epoch !== sessionVersion || !busy) return;
        var ui = ensureStream();
        answer += piece;
        paintAiBubble(ui.bubble, answer);
        if (reasoning.trim()) ui.summary.textContent = '思考过程';
        scrollToBottom();
      }
    }).then(function (res) {
      typing.remove();
      if (stream) stream.el.remove();
      if (epoch !== sessionVersion) return;
      var finalText = String(res.text || answer || '').trim();
      var finalReasoning = String(res.reasoning || reasoning || '').trim();
      if (!finalText) throw new Error('模型没有返回文本');
      ctx.store.addAiMessage('ai', finalText, finalReasoning);
      renderMessages();
    }).catch(function (err) {
      typing.remove();
      if (stream) stream.el.remove();
      if (epoch !== sessionVersion) return;
      if (err && err.name === 'AbortError') {
        persistPartial('（已停止生成）');
        ctx.toast('已停止生成', 'ok');
        return;
      }
      persistPartial('（生成中断）');
      appendError((err && err.message) || '请求失败');
      ctx.toast((err && err.message) || 'AI 请求失败', 'err');
    }).finally(function () {
      if (epoch !== sessionVersion) return;
      abortCtrl = null;
      setBusyUi(false);
      if (els.input) els.input.focus();
    });
  }

  function open() {
    renderMessages();
    syncMode();
    setBusyUi(busy);
    setTimeout(function () { els.input && els.input.focus(); }, 320);
  }

  /* ---------- 规则引擎 ---------- */
  function has(text, words) {
    return words.some(function (w) { return text.indexOf(w) >= 0; });
  }

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

  function sortedCountdowns() {
    return ctx.store.get().countdowns.map(function (c) {
      return { c: c, days: U.daysUntil(c.date) };
    }).sort(function (a, b) {
      var ap = a.days < 0, bp = b.days < 0;
      if (ap !== bp) return ap ? 1 : -1;
      return ap ? b.days - a.days : a.days - b.days;
    });
  }

  function weatherBlock() {
    var s = ctx.store.get();
    var wx = root.LumenWidgets.weather;
    if (!wx) return '';
    var city = D.CITIES.find(function (c) { return c.id === s.weatherCity; }) || D.CITIES[0];
    var cached = s.settings.weatherSource !== 'demo' && root.LumenWeather
      ? root.LumenWeather.peek(city.id) : null;
    var now = cached && cached.current ? cached.current : wx.currentReading(city, new Date());
    var today = cached && cached.days && cached.days[0]
      ? cached.days[0].fc : wx.dayForecast(city, U.todayKey());
    var tip = '';
    if (now.cond.key.indexOf('rain') >= 0 || now.cond.key === 'storm') tip = '出门记得带伞。';
    else if (now.cond.key === 'snow') tip = '路滑，穿暖一点。';
    else if (now.temp >= 30) tip = '注意补水防晒。';
    else if (now.temp <= 5) tip = '注意保暖。';
    else tip = '体感还算舒服。';
    var source = cached
      ? (cached.stale ? '（Open-Meteo 缓存）' : '（Open-Meteo 实时数据）')
      : '（演示数据，未联网）';
    return city.name + '现在 ' + now.temp + '°C，' + now.cond.label + '，' + today.low + '° ~ ' + today.high +
      '°，湿度 ' + now.humidity + '%。' + tip + '\n' + source;
  }

  function reply(raw) {
    var text = String(raw).toLowerCase();
    var s = ctx.store.get();
    var todos = s.todos;
    var openTodos = todos.filter(function (t) { return !t.done; });
    var doneTodos = todos.filter(function (t) { return t.done; });

    if (has(text, ['清空对话', '清除对话', '清空聊天', '重置对话'])) {
      ctx.store.clearAiMessages();
      renderMessages();
      return '对话已清空。';
    }

    if (has(text, ['帮助', '能做什么', '会什么', '怎么用', '功能'])) {
      return [
        '我能做的事（都在本地完成）：',
        '· 帮你看待办：说「总结待办」',
        '· 生成今日计划：说「帮我安排今天」',
        '· 读天气：说「今天天气怎么样」',
        '· 看习惯：说「我的习惯坚持得怎么样」',
        '· 数日子：说「距离元旦还有多少天」',
        '· 开始专注：说「开始番茄钟」',
        '· 要点鼓励：说「给我一点鼓励」'
      ].join('\n');
    }

    if (has(text, ['几点', '现在时间', '今天几号', '日期', '星期几'])) {
      var now = new Date();
      return '现在是 ' + U.fmtDateZh(now) + ' ' + U.fmtClock(now, true) + '。' +
        '今年已经过去 ' + U.yearProgress(now).percent + '%，还剩 ' + U.yearProgress(now).left + ' 天。';
    }

    if (has(text, ['天气', '气温', '下雨', '温度'])) {
      var block = weatherBlock();
      return block || '天气模块暂时不可用。';
    }

    if (has(text, ['安排', '计划', '规划', '今天做'])) {
      var pool = [
        '花 25 分钟处理最重要的那件事',
        '列出今天的三件关键任务',
        '留 20 分钟散步或放空',
        '回复积压的消息和邮件'
      ];
      var existing = todos.map(function (t) { return t.text; });
      var picked = [];
      for (var i = 0; i < pool.length && picked.length < 3; i++) {
        if (existing.indexOf(pool[i]) < 0) picked.push(pool[i]);
      }
      if (!picked.length) {
        return '你的待办里已经有这些安排了，先专注完成一件吧。';
      }
      picked.forEach(function (p) { ctx.store.addTodo(p); });
      return [
        '给今天排了 ' + picked.length + ' 件轻量任务，已写进待办：',
        picked.map(function (p) { return '· ' + p; }).join('\n'),
        '',
        '不用一次做完，先挑一件开始就好。'
      ].join('\n');
    }

    if (has(text, ['待办', '任务', '进度', '没做完', '剩什么'])) {
      if (!todos.length) return '待办清单是空的，今天可以轻装出发。';
      var lines = ['你有 ' + todos.length + ' 条待办，已完成 ' + doneTodos.length + ' 条，还剩 ' + openTodos.length + ' 条。'];
      if (openTodos.length) {
        lines.push('', '还没完成的：');
        openTodos.slice(0, 6).forEach(function (t) { lines.push('· ' + t.text); });
        if (openTodos.length > 6) lines.push('…… 还有 ' + (openTodos.length - 6) + ' 条');
        lines.push('', '挑一条最短的，两分钟能做完就先做掉。');
      } else {
        lines.push('全部完成，可以给自己一点奖励。');
      }
      return lines.join('\n');
    }

    if (has(text, ['习惯', '打卡', '坚持'])) {
      var habits = s.habits;
      if (!habits.length) return '还没有添加习惯。可以在「习惯打卡」卡片里加一个想坚持的事。';
      var todayDone = habits.filter(function (h) { return h.dates.indexOf(U.todayKey()) >= 0; }).length;
      var lines = ['今天已完成 ' + todayDone + ' / ' + habits.length + ' 个习惯。'];
      habits.forEach(function (h) {
        lines.push('· ' + h.name + '：连续 ' + streak(h.dates) + ' 天');
      });
      lines.push('', todayDone < habits.length ? '还没打卡的习惯，现在补一个？' : '今天全勤，很稳。');
      return lines.join('\n');
    }

    if (has(text, ['倒计时', '纪念日', '还有多少天', '多少天', '距离', '元旦', '春节'])) {
      var list = sortedCountdowns();
      if (!list.length) return '还没有设置倒计时。可以在「倒计时」卡片里加一个日期。';
      var near = list[0];
      var lines = ['最近的日期是「' + near.c.title + '」：' + U.daysText(near.days) + '。'];
      if (list.length > 1) {
        lines.push('', '其它日期：');
        list.slice(1, 5).forEach(function (e) { lines.push('· ' + e.c.title + '：' + U.daysText(e.days)); });
      }
      return lines.join('\n');
    }

    if (has(text, ['番茄', '专注', '计时', '高效'])) {
      var mins = s.pomodoro.focus || 25;
      ctx.store.setPomodoro({ mode: 'focus', running: true, endsAt: Date.now() + mins * 60000, remaining: mins * 60 });
      if (ctx.rerender) ctx.rerender();
      return '已帮你开启一个 ' + mins + ' 分钟番茄钟 🍅\n放下手机，只做一件事。结束我会在主页提示你。';
    }

    if (has(text, ['鼓励', '加油', '累', '焦虑', '烦', '不想干', '坚持不下', 'emo', '难过'])) {
      var idx = (U.dayOfYear() - 1 + s.quoteOffset) % D.QUOTES.length;
      if (idx < 0) idx += D.QUOTES.length;
      return '先深呼吸一下。\n\n「' + D.QUOTES[idx].text + '」\n—— ' + D.QUOTES[idx].author + '\n\n不必今天解决所有事，先完成一件最小的。';
    }

    if (has(text, ['总结', '复盘', '周报', '述职'])) {
      return [
        '【今日小结】' + U.fmtDateZh(new Date()),
        '· 待办：完成 ' + doneTodos.length + ' / ' + todos.length + (openTodos.length ? '，还剩 ' + openTodos.length + ' 条' : '，已清空'),
        '· 习惯：' + s.habits.filter(function (h) { return h.dates.indexOf(U.todayKey()) >= 0; }).length + ' / ' + s.habits.length + ' 已打卡',
        '· 最近的日子：' + (sortedCountdowns()[0] ? sortedCountdowns()[0].c.title + ' ' + U.daysText(sortedCountdowns()[0].days) : '暂无'),
        '· 年度进度：' + U.yearProgress().percent + '%',
        '',
        '可以照着这个结构写周报。'
      ].join('\n');
    }

    if (has(text, ['你好', 'hi', 'hello', '嗨', '在吗', '早上好', '晚上好'])) {
      var name = s.settings.name ? s.settings.name : '你';
      return U.greeting() + '，' + name + '。\n今天是 ' + U.fmtDateZh(new Date()) + '，' +
        (openTodos.length ? '还有 ' + openTodos.length + ' 条待办没完成。' : '待办已经清空了。') +
        '\n需要我帮你安排今天吗？';
    }

    if (has(text, ['搜索', '查一下', '找一下', '百度', '谷歌'])) {
      return '直接把关键词打进上方搜索框会更快。\n输入网址可以直接跳转，输入关键词会用你当前选择的搜索引擎打开新标签页。';
    }

    if (has(text, ['谢谢', '感谢', '辛苦'])) {
      return '不客气，随时叫我。';
    }

    return [
      '这句话我还没学会（我只是一套本地规则，不是大模型）。',
      '',
      '可以试试：',
      '· 帮我安排今天',
      '· 总结一下我的待办',
      '· 今天天气怎么样',
      '· 距离元旦还有多少天',
      '· 给我一点鼓励'
    ].join('\n');
  }

  root.LumenAI = {
    init: init,
    open: open,
    send: send,
    replyForTest: reply
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
