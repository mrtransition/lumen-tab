/* Lumen Tab — 实时天气（Open-Meteo，无需 Key；失败时由小组件回退演示数据） */
(function (root) {
  'use strict';

  var D = root.LumenData;
  var CACHE_KEY = 'lumenTab.weather.v1';
  var TTL = 10 * 60 * 1000;
  var TIMEOUT = 9000;
  var DIRS = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];

  function baseCondition(key, label) {
    var found = D.CONDITIONS.find(function (c) { return c.key === key; });
    if (!found) return { key: 'overcast', label: '阴', icon: 'overcast' };
    return label ? { key: found.key, label: label, icon: found.icon } : found;
  }

  function conditionFor(code) {
    code = Number(code);
    if (code === 0) return baseCondition('sunny');
    if (code === 1) return baseCondition('partly', '晴间多云');
    if (code === 2) return baseCondition('partly');
    if (code === 3) return baseCondition('overcast');
    if (code === 45 || code === 48) return baseCondition('fog');
    if (code >= 51 && code <= 57) return baseCondition('rain', '毛毛雨');
    if (code === 61 || code === 80) return baseCondition('rain');
    if (code === 63 || code === 81) return baseCondition('heavy-rain', '中雨');
    if (code === 65 || code === 82) return baseCondition('heavy-rain', '大雨');
    if (code === 66 || code === 67) return baseCondition('heavy-rain', '冻雨');
    if (code === 71 || code === 73 || code === 85) return baseCondition('snow');
    if (code === 75 || code === 77 || code === 86) return baseCondition('snow', '大雪');
    if (code === 95) return baseCondition('storm');
    if (code === 96 || code === 99) return baseCondition('storm', '雷暴冰雹');
    return baseCondition('overcast');
  }

  function windLevel(speed) {
    var s = Math.max(0, Number(speed) || 0);
    if (s < 1) return 0;
    if (s <= 5) return 1;
    if (s <= 11) return 2;
    if (s <= 19) return 3;
    if (s <= 28) return 4;
    if (s <= 38) return 5;
    if (s <= 49) return 6;
    if (s <= 61) return 7;
    if (s <= 74) return 8;
    if (s <= 88) return 9;
    if (s <= 102) return 10;
    if (s <= 117) return 11;
    return 12;
  }

  function windText(speed, degrees) {
    var deg = Number(degrees);
    var dir = Number.isFinite(deg) ? DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] : '风向不定';
    var level = windLevel(speed);
    return level ? dir + ' ' + level + ' 级' : '静风';
  }

  function endpointFor(city) {
    if (!city || !Number.isFinite(Number(city.lat)) || !Number.isFinite(Number(city.lon))) return '';
    return 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + Number(city.lat).toFixed(4) +
      '&longitude=' + Number(city.lon).toFixed(4) +
      '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&timezone=auto&forecast_days=5&temperature_unit=celsius&wind_speed_unit=kmh';
  }

  function parsePayload(payload, now) {
    if (!payload || typeof payload !== 'object' || !payload.current || !payload.daily) {
      throw new Error('天气服务返回格式不正确');
    }
    var current = payload.current;
    var daily = payload.daily;
    var temp = Number(current.temperature_2m);
    var times = Array.isArray(daily.time) ? daily.time : [];
    var codes = Array.isArray(daily.weather_code) ? daily.weather_code : [];
    var highs = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
    var lows = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
    if (!Number.isFinite(temp) || !times.length) throw new Error('天气服务返回的数据不完整');

    var humidity = Number(current.relative_humidity_2m);
    var days = [];
    for (var i = 0; i < Math.min(5, times.length); i++) {
      var high = Number(highs[i]);
      var low = Number(lows[i]);
      if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
      days.push({
        key: String(times[i]),
        fc: {
          cond: conditionFor(codes[i]),
          mid: Math.round((high + low) / 2),
          low: Math.round(low),
          high: Math.round(high),
          humidity: Number.isFinite(humidity) ? Math.round(humidity) : 0
        }
      });
    }
    if (!days.length) throw new Error('天气服务没有返回预报数据');

    return {
      source: 'open-meteo',
      updatedAt: now || Date.now(),
      current: {
        temp: Math.round(temp),
        cond: conditionFor(current.weather_code),
        humidity: Number.isFinite(humidity) ? Math.round(humidity) : 0,
        high: days[0].fc.high,
        low: days[0].fc.low,
        wind: windText(current.wind_speed_10m, current.wind_direction_10m)
      },
      days: days
    };
  }

  function storageOf(opts) {
    if (opts && opts.storage !== undefined) return opts.storage;
    try { return root.localStorage || null; } catch (err) { return null; }
  }

  function readCache(cityId, storage) {
    if (!storage) return null;
    try {
      var all = JSON.parse(storage.getItem(CACHE_KEY) || 'null');
      var entry = all && all.cities && all.cities[cityId];
      if (!entry || !Number.isFinite(Number(entry.ts)) || !entry.data ||
        !entry.data.current || !Array.isArray(entry.data.days) ||
        !entry.data.days[0] || !entry.data.days[0].fc) return null;
      return entry;
    } catch (err) {
      return null;
    }
  }

  function writeCache(cityId, entry, storage) {
    if (!storage) return;
    try {
      var all = JSON.parse(storage.getItem(CACHE_KEY) || 'null') || {};
      if (!all.cities || typeof all.cities !== 'object') all.cities = {};
      all.cities[cityId] = entry;
      storage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (err) { /* 缓存失败不影响天气显示 */ }
  }

  function extend(data, extra) {
    var out = {};
    Object.keys(data).forEach(function (key) { out[key] = data[key]; });
    Object.keys(extra).forEach(function (key) { out[key] = extra[key]; });
    return out;
  }

  function fetchWeather(city, opts) {
    opts = opts || {};
    var fetchImpl = opts.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    var url = endpointFor(city);
    if (!fetchImpl) return Promise.reject(new Error('当前环境不支持联网获取天气'));
    if (!url) return Promise.reject(new Error('城市缺少经纬度'));

    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = Number(opts.timeout) || TIMEOUT;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout) : null;
    return fetchImpl(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
      .then(function (res) {
        if (!res || !res.ok) throw new Error('天气服务暂时不可用' + (res && res.status ? '（HTTP ' + res.status + '）' : ''));
        return res.json();
      })
      .then(function (payload) { return parsePayload(payload); })
      .catch(function (err) {
        if (err && err.name === 'AbortError') throw new Error('天气请求超时');
        throw err;
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function load(city, opts) {
    opts = opts || {};
    var storage = storageOf(opts);
    var cached = readCache(city.id, storage);
    if (!opts.force && cached && Date.now() - Number(cached.ts) < TTL) {
      return Promise.resolve(extend(cached.data, { cached: true, stale: false }));
    }
    return fetchWeather(city, opts).then(function (data) {
      writeCache(city.id, { ts: Date.now(), data: data }, storage);
      return data;
    }).catch(function (err) {
      if (cached) return extend(cached.data, { cached: true, stale: true, error: err });
      throw err;
    });
  }

  function peek(cityId, opts) {
    var cached = readCache(cityId, storageOf(opts));
    if (!cached) return null;
    return extend(cached.data, {
      cached: true,
      stale: Date.now() - Number(cached.ts) >= TTL,
      ts: Number(cached.ts)
    });
  }

  root.LumenWeather = {
    CACHE_KEY: CACHE_KEY,
    TTL: TTL,
    endpointFor: endpointFor,
    conditionFor: conditionFor,
    windText: windText,
    parsePayload: parsePayload,
    fetchWeather: fetchWeather,
    load: load,
    peek: peek
  };

  if (typeof module === 'object' && module.exports) module.exports = root.LumenWeather;
})(typeof globalThis !== 'undefined' ? globalThis : this);
