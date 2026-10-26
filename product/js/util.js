/* Lumen Tab — 通用工具（无依赖，浏览器 + Node 双用） */
(function (root, factory) {
  var api = factory();
  root.LumenUtil = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var DAY = 86400000;

  function pad(n, len) {
    return String(n).padStart(len || 2, '0');
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseKey(key) {
    var p = String(key).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function addDays(key, n) {
    var d = parseKey(key);
    d.setDate(d.getDate() + n);
    return todayKey(d);
  }

  function fmtClock(d, seconds) {
    d = d || new Date();
    var hh = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return seconds === false ? hh : hh + ':' + pad(d.getSeconds());
  }

  function fmtDateZh(d) {
    d = d || new Date();
    return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
  }

  function greeting(d) {
    d = d || new Date();
    var h = d.getHours();
    if (h < 5) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 23) return '晚上好';
    return '夜深了';
  }

  function dayOfYear(d) {
    d = d || new Date();
    var start = new Date(d.getFullYear(), 0, 1);
    return Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / DAY) + 1;
  }

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function yearProgress(d) {
    d = d || new Date();
    var total = isLeapYear(d.getFullYear()) ? 366 : 365;
    var passed = dayOfYear(d);
    return {
      year: d.getFullYear(),
      passed: passed,
      total: total,
      left: total - passed,
      percent: Math.round((passed / total) * 1000) / 10
    };
  }

  /** 距离目标日期还有多少天（今天 = 0，过去为负） */
  function daysUntil(dateStr, now) {
    var nowKey = todayKey(now || new Date());
    return Math.round((parseKey(dateStr) - parseKey(nowKey)) / DAY);
  }

  function lastNDays(n, now) {
    var base = todayKey(now || new Date());
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(addDays(base, -i));
    return out;
  }

  function weekdayShort(key) {
    return WEEKDAYS[parseKey(key).getDay()].replace('周', '');
  }

  var uidSeq = 0;
  function uid(prefix) {
    uidSeq = (uidSeq + 1) % 100000;
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + uidSeq.toString(36);
  }

  /** 32 位字符串哈希（FNV-1a 变体） */
  function hashStr(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** mulberry32：确定性伪随机 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seeded(seedStr) {
    return mulberry32(hashStr(String(seedStr)));
  }

  function pickSeeded(list, seedStr) {
    if (!list || !list.length) return null;
    return list[Math.floor(seeded(seedStr)() * list.length) % list.length];
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k === 'style') node.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    var list = Array.isArray(children) ? children : children == null ? [] : [children];
    list.forEach(function (c) {
      if (c == null || c === false) return;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 150);
    };
  }

  function normalizeUrl(input) {
    var raw = String(input == null ? '' : input).trim();
    if (!raw) return null;
    if (/^(https?|edge|chrome|about):\/\//i.test(raw)) return raw;
    if (/^https?:\/\/\S+$/i.test(raw)) return raw;
    if (/^[^\s/?#]+\.[^\s/?#]{2,}(\/\S*)?$/i.test(raw) || /^localhost(:\d+)?(\/\S*)?$/i.test(raw)) {
      return 'https://' + raw;
    }
    return null;
  }

  function buildSearchUrl(template, query) {
    return template + encodeURIComponent(query);
  }

  /** 只接受 http(s) 网页地址，避免导入数据里的危险协议 */
  function normalizeWebUrl(input) {
    var url = normalizeUrl(input);
    return url && /^https?:\/\//i.test(url) ? url : null;
  }

  /**
   * AI 接口地址：允许 http(s)，裸域名补 https，localhost 补 http。
   * 去掉末尾斜杠，拒绝账号密码、查询串和 hash，避免请求地址失控。
   */
  function normalizeApiBaseUrl(input) {
    var raw = String(input == null ? '' : input).trim();
    if (!raw) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(raw)) raw = 'http://' + raw;
      else raw = 'https://' + raw;
    }
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      var u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      if (u.username || u.password || u.search || u.hash) return '';
      return raw.replace(/[?#]+$/, '').replace(/\/+$/, '');
    } catch (err) {
      return '';
    }
  }

  /** 模型名只保留常见安全字符，避免拼进请求时出现控制字符 */
  function normalizeModelName(input) {
    var s = String(input == null ? '' : input).trim();
    return /^[A-Za-z0-9._:@/-]{1,100}$/.test(s) ? s : '';
  }

  function openUrl(url, newTab) {
    if (!url) return false;
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create && typeof chrome.runtime !== 'undefined' && chrome.runtime.id) {
        chrome.tabs.create({ url: url });
        return true;
      }
    } catch (e) { /* ignore */ }
    if (newTab === false) {
      location.href = url;
      return true;
    }
    // noopener 下 window.open 按规范返回 null，不能把 null 当成“被拦截”再回退到当前页
    window.open(url, '_blank', 'noopener');
    return true;
  }

  function downloadJSON(filename, data) {
    var text = JSON.stringify(data, null, 2);
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function readJSONFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        try { resolve(JSON.parse(String(reader.result))); }
        catch (e) { reject(new Error('JSON 解析失败：' + e.message)); }
      };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.readAsText(file);
    });
  }

  function readImageFile(file, maxBytes) {
    var limit = maxBytes || 12 * 1024 * 1024;
    return new Promise(function (resolve, reject) {
      if (!file.type || file.type.indexOf('image/') !== 0) return reject(new Error('请选择图片文件'));
      if (file.size > limit) return reject(new Error('图片过大，请选择小于 ' + Math.round(limit / 1024 / 1024) + 'MB 的图片'));
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result);
        // 小尺寸 GIF 保留动画；其它图片压到画布再存，避免 base64 撑爆 localStorage
        if (file.type === 'image/gif' && file.size <= 1.5 * 1024 * 1024) {
          resolve({ dataUrl: dataUrl, name: file.name });
          return;
        }
        var img = new Image();
        img.onload = function () {
          try {
            var maxDim = 1920;
            var scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
            var draw = function (dim, quality) {
              var w = Math.max(1, Math.round((img.width || 1) * dim));
              var h = Math.max(1, Math.round((img.height || 1) * dim));
              var canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              var g = canvas.getContext('2d');
              g.fillStyle = '#0b1020';
              g.fillRect(0, 0, w, h);
              g.drawImage(img, 0, 0, w, h);
              return canvas.toDataURL('image/jpeg', quality);
            };
            var out = draw(scale, 0.85);
            if (out.length > 2.8 * 1024 * 1024) out = draw(Math.min(scale, 0.7), 0.72);
            if (out.length > 3.4 * 1024 * 1024) {
              reject(new Error('图片压缩后仍然过大，请换一张'));
              return;
            }
            resolve({ dataUrl: out, name: file.name });
          } catch (e) {
            reject(new Error('图片处理失败'));
          }
        };
        img.onerror = function () { reject(new Error('图片解析失败，请换一张')); };
        img.src = dataUrl;
      };
      reader.onerror = function () { reject(new Error('图片读取失败')); };
      reader.readAsDataURL(file);
    });
  }

  function daysText(days) {
    if (days > 0) return '还有 ' + days + ' 天';
    if (days === 0) return '就是今天';
    return '已过去 ' + Math.abs(days) + ' 天';
  }

  function formatDuration(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }

  function firstGrapheme(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return '';
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        var seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        var it = seg.segment(s)[Symbol.iterator]().next();
        if (!it.done) return it.value.segment;
      }
    } catch (e) { /* 回退 */ }
    return Array.from(s)[0] || '';
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var prev = document.activeElement;
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand('copy');
        ta.remove();
        if (prev && typeof prev.focus === 'function' && prev.isConnected) prev.focus();
        if (ok) resolve(true);
        else reject(new Error('当前环境不支持剪贴板'));
      } catch (e) {
        if (prev && typeof prev.focus === 'function' && prev.isConnected) prev.focus();
        reject(new Error('复制失败'));
      }
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  return {
    WEEKDAYS: WEEKDAYS,
    DAY: DAY,
    pad: pad,
    clamp: clamp,
    todayKey: todayKey,
    parseKey: parseKey,
    addDays: addDays,
    fmtClock: fmtClock,
    fmtDateZh: fmtDateZh,
    greeting: greeting,
    dayOfYear: dayOfYear,
    yearProgress: yearProgress,
    daysUntil: daysUntil,
    lastNDays: lastNDays,
    weekdayShort: weekdayShort,
    uid: uid,
    hashStr: hashStr,
    mulberry32: mulberry32,
    seeded: seeded,
    pickSeeded: pickSeeded,
    escapeHtml: escapeHtml,
    el: el,
    debounce: debounce,
    normalizeUrl: normalizeUrl,
    normalizeWebUrl: normalizeWebUrl,
    normalizeApiBaseUrl: normalizeApiBaseUrl,
    normalizeModelName: normalizeModelName,
    buildSearchUrl: buildSearchUrl,
    openUrl: openUrl,
    downloadJSON: downloadJSON,
    readJSONFile: readJSONFile,
    readImageFile: readImageFile,
    daysText: daysText,
    formatDuration: formatDuration,
    copyText: copyText,
    firstGrapheme: firstGrapheme
  };
});
