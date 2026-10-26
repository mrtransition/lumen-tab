/* Lumen Tab — WeTab 备份导入：把 WeTab 导出的 .data JSON 转成 Lumen v2 状态 */
(function (root) {
  'use strict';
  var U = root.LumenUtil;
  var D = root.LumenData;

  var CATEGORY_ICONS = {
    'icon-zhuye': '🏠',
    'icon-keji': '💼',
    'icon-chengxu': '💻',
    'icon-chuangyi': '✨',
    'icon-dili': '📥',
    'icon-sheji': '🎨',
    'icon-tupian': '🖼️',
    'icon-gongju': '🧰',
    'i:stars-28-outline-bold': '⭐'
  };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return String(v == null ? '' : v).trim(); }
  function cleanText(v, max) {
    var text = String(v == null ? '' : v)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return max ? text.slice(0, max) : text;
  }

  /** WeTab 备份的最稳定特征：data.store-icon.icons 是分类数组 */
  function isWeTab(raw) {
    if (!isObj(raw) || !isObj(raw.data)) return false;
    var iconData = raw.data['store-icon'];
    return isObj(iconData) && Array.isArray(iconData.icons);
  }

  /** #rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba() → #rrggbb；透明色交给调色板 */
  function parseColor(value) {
    var raw = str(value);
    var m = raw.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      var hex = m[1];
      if (hex.length === 3 || hex.length === 4) {
        hex = hex.split('').map(function (c) { return c + c; }).join('');
      }
      if (hex.length === 8) {
        if (parseInt(hex.slice(6), 16) / 255 < 0.6) return null;
        hex = hex.slice(0, 6);
      }
      if (hex.length === 6) return '#' + hex.toLowerCase();
      return null;
    }
    var rgba = raw.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (!rgba) return null;
    var alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    if (!Number.isFinite(alpha) || alpha < 0.6) return null;
    var rgb = [rgba[1], rgba[2], rgba[3]].map(function (n) {
      return Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
    });
    return '#' + rgb.map(function (n) { return n.toString(16).padStart(2, '0'); }).join('');
  }

  function paletteColor(key) {
    var hash = Math.abs(U.hashStr(String(key || 'webtab')));
    return D.SITE_COLORS[hash % D.SITE_COLORS.length];
  }

  function hostName(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, '') || '未命名';
    } catch (err) {
      return '未命名';
    }
  }

  function categoryEmoji(cat, index) {
    var icon = str(cat.iconClass);
    if (CATEGORY_ICONS[icon]) return CATEGORY_ICONS[icon];
    var fromName = U.firstGrapheme(cleanText(cat.name, 16));
    if (fromName && !/^[a-z0-9]$/i.test(fromName)) return fromName;
    return D.CATEGORY_EMOJIS[index % D.CATEGORY_EMOJIS.length];
  }

  function siteEmoji(child, name) {
    var text = cleanText(child.bgText, 8);
    return U.firstGrapheme(text) || U.firstGrapheme(name) || '🔗';
  }

  function dataImage(value) {
    return typeof value === 'string' &&
      /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value) &&
      value.length <= 6000000 ? value : '';
  }

  function mapWallpaper(data, meta) {
    var wp = isObj(data['store-wallpaper']) ? data['store-wallpaper'] : null;
    if (!wp) return null;
    var image = dataImage(wp.customWallpaperUrl) ||
      (wp.bgType === 'image' ? dataImage(wp.src) : '');
    if (image) {
      meta.wallpaperImported = true;
      var blur = Number(wp.blur);
      return {
        image: image,
        blur: Number.isFinite(blur) ? U.clamp(blur, 0, 24) : 0
      };
    }
    if (wp.bgType || wp.src || wp.customWallpaperUrl || wp.videoBgConf || wp.gradientConf) {
      meta.wallpaperSkipped = true;
    }
    return null;
  }

  function mapCity(data, meta) {
    var weather = isObj(data['store-weather']) ? data['store-weather'] : null;
    if (!weather) return '';
    var added = Array.isArray(weather.addedCity) ? weather.addedCity.filter(isObj) : [];
    var activeId = str(weather.activeCityId);
    var entry = added.find(function (c) { return str(c.id) === activeId || str(c.cid) === activeId; }) || added[0];
    if (!entry) return '';

    var name = cleanText(entry.name, 30);
    var byName = D.CITIES.find(function (c) {
      return name && (name.indexOf(c.name) >= 0 || c.name.indexOf(name) >= 0);
    });
    var lat = Number(entry.lat);
    var lon = Number(entry.lon);
    var best = null;
    var bestDistance = Infinity;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      D.CITIES.forEach(function (city) {
        if (!Number.isFinite(city.lat) || !Number.isFinite(city.lon)) return;
        var dLat = (lat - city.lat) * Math.PI / 180;
        var dLon = (lon - city.lon) * Math.PI / 180;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat * Math.PI / 180) * Math.cos(city.lat * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        var distance = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = city;
        }
      });
    }
    if (best && bestDistance <= 350) {
      meta.weatherMapped = true;
      meta.weatherFrom = name || 'WeTab 城市';
      meta.weatherCity = best.name;
      return best.id;
    }
    if (byName) {
      meta.weatherMapped = true;
      meta.weatherFrom = name;
      meta.weatherCity = byName.name;
      return byName.id;
    }
    meta.weatherMapped = false;
    meta.weatherFrom = name;
    return '';
  }

  function mapSettings(data, meta) {
    var out = {};
    var setting = isObj(data['store-setting']) ? data['store-setting'] : {};
    if (setting.followSystem === true) out.theme = 'auto';
    else if (setting.theme === 'light' || setting.theme === 'dark') out.theme = setting.theme;
    if (setting.leftBarDisplayStatus === 'hide') out.railCollapsed = true;
    if (setting.iconOpenMethod === 'new-tab') out.openInNewTab = true;
    else if (setting.iconOpenMethod === 'current' || setting.iconOpenMethod === 'current-tab') out.openInNewTab = false;
    if (setting.iconSize === 'icon-s') out.density = 'compact';
    var wallpaper = mapWallpaper(data, meta);
    if (wallpaper) out.wallpaper = wallpaper;
    return out;
  }

  function convert(raw) {
    if (!isWeTab(raw)) return { ok: false, error: '这不是 WeTab 备份文件' };
    var iconData = raw.data['store-icon'];
    var sourceCats = iconData.icons;
    if (!sourceCats.length) return { ok: false, error: 'WeTab 备份里没有分类数据' };

    var meta = {
      categories: 0,
      sites: 0,
      invalidSites: 0,
      widgetsSkipped: 0,
      unknownItems: 0,
      emptyCategories: 0,
      imageIcons: 0,
      dockTotal: 0,
      dockImported: 0,
      wallpaperImported: false,
      wallpaperSkipped: false,
      weatherMapped: false
    };
    var usedCats = Object.create(null);
    var usedSites = Object.create(null);
    var siteByOriginalId = Object.create(null);
    var categories = [];

    sourceCats.forEach(function (cat, catIndex) {
      if (!isObj(cat)) return;
      var catId = str(cat.id);
      if (!catId || usedCats[catId]) catId = U.uid('cat');
      usedCats[catId] = true;

      var items = [];
      (Array.isArray(cat.children) ? cat.children : []).forEach(function (child) {
        if (!isObj(child)) return;
        var type = str(child.type).toLowerCase() || (child.target ? 'site' : '');
        if (type === 'widget') {
          meta.widgetsSkipped++;
          return;
        }
        if (type !== 'site') {
          meta.unknownItems++;
          return;
        }

        var url = U.normalizeWebUrl(child.target);
        if (!url) {
          meta.invalidSites++;
          return;
        }
        var name = cleanText(child.name, 30) || hostName(url);
        var siteId = str(child.id);
        if (!siteId || usedSites[siteId]) siteId = U.uid('site');
        usedSites[siteId] = true;
        var site = {
          id: siteId,
          kind: 'site',
          name: name,
          url: url,
          emoji: siteEmoji(child, name),
          color: parseColor(child.bgColor) || paletteColor(name + url)
        };
        items.push(site);
        meta.sites++;
        if (child.bgType === 'image') meta.imageIcons++;
        if (child.id && !siteByOriginalId[child.id]) siteByOriginalId[child.id] = site;
      });

      if (!items.length) meta.emptyCategories++;
      categories.push({
        id: catId,
        name: cleanText(cat.name, 16) || '未命名',
        emoji: categoryEmoji(cat, catIndex),
        items: items
      });
    });

    if (!categories.length) return { ok: false, error: 'WeTab 备份里没有可用分类' };
    meta.categories = categories.length;

    var dockIds = Array.isArray(iconData.dockIdList) ? iconData.dockIdList : [];
    meta.dockTotal = dockIds.length;
    var shortcuts = [];
    var seenDock = Object.create(null);
    dockIds.forEach(function (id) {
      var site = siteByOriginalId[str(id)];
      if (!site || seenDock[site.id] || shortcuts.length >= 12) return;
      seenDock[site.id] = true;
      shortcuts.push({
        id: 'sc-wt-' + shortcuts.length,
        name: site.name,
        url: site.url,
        emoji: site.emoji,
        color: site.color
      });
    });
    meta.dockImported = shortcuts.length;

    var state = D.defaultState(Date.now());
    state.settings = Object.assign({}, state.settings, mapSettings(raw.data, meta));
    state.categories = categories;
    state.activeCategory = categories[0].id;
    state.shortcuts = shortcuts;
    // 导入是“替换”，不带入 Lumen 的示例待办 / 便签等数据
    state.todos = [];
    state.notes = [];
    state.countdowns = [];
    state.habits = [];
    state.aiMessages = [];
    state.searchHistory = [];
    state.quoteFav = [];
    state.quoteOffset = 0;
    var city = mapCity(raw.data, meta);
    if (city) state.weatherCity = city;

    return { ok: true, state: state, meta: meta };
  }

  var API = {
    isWeTab: isWeTab,
    convert: convert,
    parseColor: parseColor
  };
  root.LumenWeTabImport = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
