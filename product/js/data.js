/* Lumen Tab — 静态数据与默认状态（本地优先；天气可联网，演示数据可替换 provider） */
(function (root) {
  'use strict';
  var U = root.LumenUtil;

  var STATE_VERSION = 2;

  var ENGINES = [
    { id: 'bing', name: '必应', badge: 'B', url: 'https://www.bing.com/search?q=', color: '#2f9bf0' },
    { id: 'baidu', name: '百度', badge: '百', url: 'https://www.baidu.com/s?wd=', color: '#3f63f5' },
    { id: 'google', name: 'Google', badge: 'G', url: 'https://www.google.com/search?q=', color: '#ea4335' },
    { id: 'zhihu', name: '知乎', badge: '知', url: 'https://www.zhihu.com/search?type=content&q=', color: '#0084ff' },
    { id: 'bilibili', name: 'B 站', badge: 'B', url: 'https://search.bilibili.com/all?keyword=', color: '#fb7299' }
  ];

  var ACCENTS = [
    { id: 'cyan', name: '流光蓝', value: '#38bdf8', ink: '#03121d' },
    { id: 'violet', name: '星云紫', value: '#a78bfa', ink: '#120a26' },
    { id: 'pink', name: '樱花粉', value: '#fb7185', ink: '#23050f' },
    { id: 'amber', name: '暖阳橙', value: '#fbbf24', ink: '#221500' },
    { id: 'emerald', name: '薄荷绿', value: '#34d399', ink: '#032016' }
  ];

  var WALLPAPERS = [
    {
      id: 'aurora', name: '极光',
      css: 'radial-gradient(120% 110% at 14% 8%, #0b3b6f 0%, rgba(11,59,111,0) 58%),' +
        'radial-gradient(95% 85% at 84% 16%, #1d4ed8 0%, rgba(29,78,216,0) 55%),' +
        'radial-gradient(120% 120% at 62% 96%, #0891b2 0%, rgba(8,145,178,0) 62%),' +
        'linear-gradient(160deg, #050b1a 0%, #0a1730 52%, #061224 100%)'
    },
    {
      id: 'dusk', name: '暮色',
      css: 'radial-gradient(110% 90% at 78% 12%, #7c2d5a 0%, rgba(124,45,90,0) 58%),' +
        'radial-gradient(90% 80% at 18% 82%, #b45309 0%, rgba(180,83,9,0) 55%),' +
        'radial-gradient(120% 120% at 50% 100%, #4c1d95 0%, rgba(76,29,149,0) 60%),' +
        'linear-gradient(170deg, #120a1f 0%, #1a1030 55%, #0d0716 100%)'
    },
    {
      id: 'deepsea', name: '深海',
      css: 'radial-gradient(100% 80% at 22% 18%, #0e7490 0%, rgba(14,116,144,0) 58%),' +
        'radial-gradient(90% 90% at 82% 74%, #155e75 0%, rgba(21,94,117,0) 60%),' +
        'linear-gradient(155deg, #04141b 0%, #062a33 58%, #021016 100%)'
    },
    {
      id: 'sakura', name: '樱',
      css: 'radial-gradient(100% 85% at 78% 12%, #db2777 0%, rgba(219,39,119,0) 55%),' +
        'radial-gradient(95% 90% at 16% 78%, #7e22ce 0%, rgba(126,34,206,0) 58%),' +
        'radial-gradient(120% 120% at 50% 108%, #be185d 0%, rgba(190,24,93,0) 62%),' +
        'linear-gradient(165deg, #1a0616 0%, #2a0a26 52%, #12040f 100%)'
    },
    {
      id: 'forest', name: '林间',
      css: 'radial-gradient(105% 85% at 20% 14%, #166534 0%, rgba(22,101,52,0) 58%),' +
        'radial-gradient(95% 90% at 84% 80%, #115e59 0%, rgba(17,94,89,0) 60%),' +
        'linear-gradient(160deg, #04120b 0%, #082018 55%, #030d08 100%)'
    },
    {
      id: 'ink', name: '墨',
      css: 'radial-gradient(110% 90% at 70% 10%, #334155 0%, rgba(51,65,85,0) 60%),' +
        'radial-gradient(100% 90% at 12% 88%, #1e293b 0%, rgba(30,41,59,0) 58%),' +
        'linear-gradient(155deg, #0b0f14 0%, #151b24 60%, #080b10 100%)'
    },
    {
      id: 'mint', name: '薄荷',
      css: 'radial-gradient(100% 90% at 18% 10%, #a7f3d0 0%, rgba(167,243,208,0) 60%),' +
        'radial-gradient(95% 90% at 82% 24%, #bae6fd 0%, rgba(186,230,253,0) 58%),' +
        'radial-gradient(110% 110% at 60% 100%, #99f6e4 0%, rgba(153,246,228,0) 62%),' +
        'linear-gradient(160deg, #f0fdfa 0%, #e0f2fe 55%, #ecfeff 100%)'
    },
    {
      id: 'sunrise', name: '晨光',
      css: 'radial-gradient(95% 85% at 82% 12%, #fed7aa 0%, rgba(254,215,170,0) 58%),' +
        'radial-gradient(100% 90% at 16% 26%, #fecdd3 0%, rgba(254,205,211,0) 62%),' +
        'radial-gradient(120% 120% at 50% 102%, #fde68a 0%, rgba(253,230,138,0) 60%),' +
        'linear-gradient(165deg, #fff7ed 0%, #fef2f2 52%, #fffbeb 100%)'
    }
  ];

  var CITIES = [
    { id: 'beijing', name: '北京', base: 18, humidity: 42, wind: '东北风 3 级', lat: 39.9042, lon: 116.4074 },
    { id: 'shanghai', name: '上海', base: 22, humidity: 68, wind: '东南风 2 级', lat: 31.2304, lon: 121.4737 },
    { id: 'guangzhou', name: '广州', base: 27, humidity: 74, wind: '南风 2 级', lat: 23.1291, lon: 113.2644 },
    { id: 'shenzhen', name: '深圳', base: 27, humidity: 72, wind: '东风 3 级', lat: 22.5431, lon: 114.0579 },
    { id: 'chengdu', name: '成都', base: 20, humidity: 80, wind: '北风 1 级', lat: 30.5728, lon: 104.0668 },
    { id: 'hangzhou', name: '杭州', base: 22, humidity: 70, wind: '东风 2 级', lat: 30.2741, lon: 120.1551 },
    { id: 'wuhan', name: '武汉', base: 21, humidity: 66, wind: '北风 2 级', lat: 30.5928, lon: 114.3055 },
    { id: 'xian', name: '西安', base: 17, humidity: 55, wind: '西风 2 级', lat: 34.3416, lon: 108.9398 }
  ];

  var CONDITIONS = [
    { key: 'sunny', label: '晴', icon: 'sun' },
    { key: 'partly', label: '多云', icon: 'partly' },
    { key: 'overcast', label: '阴', icon: 'overcast' },
    { key: 'fog', label: '雾', icon: 'fog' },
    { key: 'rain', label: '小雨', icon: 'rain' },
    { key: 'heavy-rain', label: '中雨', icon: 'heavy-rain' },
    { key: 'storm', label: '雷阵雨', icon: 'storm' },
    { key: 'snow', label: '小雪', icon: 'snow' },
    { key: 'wind', label: '大风', icon: 'wind' }
  ];

  var QUOTES = [
    { text: '路漫漫其修远兮，吾将上下而求索。', author: '屈原《离骚》' },
    { text: '长风破浪会有时，直挂云帆济沧海。', author: '李白' },
    { text: '会当凌绝顶，一览众山小。', author: '杜甫' },
    { text: '千磨万击还坚劲，任尔东西南北风。', author: '郑燮' },
    { text: '不经一番寒彻骨，怎得梅花扑鼻香。', author: '黄蘖禅师' },
    { text: '莫愁前路无知己，天下谁人不识君。', author: '高适' },
    { text: '海内存知己，天涯若比邻。', author: '王勃' },
    { text: '天行健，君子以自强不息。', author: '《周易》' },
    { text: '地势坤，君子以厚德载物。', author: '《周易》' },
    { text: '学而不思则罔，思而不学则殆。', author: '《论语》' },
    { text: '三人行，必有我师焉。', author: '《论语》' },
    { text: '知之者不如好之者，好之者不如乐之者。', author: '《论语》' },
    { text: '不积跬步，无以至千里；不积小流，无以成江海。', author: '荀子《劝学》' },
    { text: '锲而不舍，金石可镂。', author: '荀子《劝学》' },
    { text: '塞翁失马，焉知非福。', author: '《淮南子》' },
    { text: '落霞与孤鹜齐飞，秋水共长天一色。', author: '王勃' },
    { text: '山重水复疑无路，柳暗花明又一村。', author: '陆游' },
    { text: '纸上得来终觉浅，绝知此事要躬行。', author: '陆游' },
    { text: '问渠那得清如许？为有源头活水来。', author: '朱熹' },
    { text: '横看成岭侧成峰，远近高低各不同。', author: '苏轼' },
    { text: '竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。', author: '苏轼' },
    { text: '人生如逆旅，我亦是行人。', author: '苏轼' },
    { text: '沉舟侧畔千帆过，病树前头万木春。', author: '刘禹锡' },
    { text: '天生我材必有用，千金散尽还复来。', author: '李白' },
    { text: '行到水穷处，坐看云起时。', author: '王维' },
    { text: '采菊东篱下，悠然见南山。', author: '陶渊明' },
    { text: '非淡泊无以明志，非宁静无以致远。', author: '诸葛亮《诫子书》' },
    { text: '博观而约取，厚积而薄发。', author: '苏轼' }
  ];

  var HOT_SOURCES = [
    {
      id: 'weibo', name: '微博', color: '#ff8200',
      items: [
        '国产大模型发布多模态新版本，端侧推理提速',
        '多地开启秋日银杏观赏季，周末出行热度上升',
        '新款折叠屏手机公布续航实测数据',
        '国产动画电影票房突破新纪录',
        '年轻人开始流行“办公室微运动”',
        '城市夜跑路线图走红，安全提示受关注',
        '高校开设人工智能通识课引讨论',
        '冷空气来袭，北方多地气温创新低',
        '开源项目一周新增万星，作者发文致谢',
        '长假后第一周，打工人分享调休攻略'
      ]
    },
    {
      id: 'zhihu', name: '知乎', color: '#0084ff',
      items: [
        '如何评价今年新发布的开源推理框架？',
        '有哪些让工作效率翻倍的小习惯？',
        '为什么秋天更容易犯困？',
        '程序员如何系统性地提升英语阅读能力？',
        '有哪些不起眼却很赚钱的行业？',
        '长期熬夜的人后来都怎么样了？',
        '如何在一个月内读完十本书？',
        '为什么现在的年轻人更愿意独处？',
        '有哪些相见恨晚的学习方法？',
        '怎样判断一份工作值不值得长期做？'
      ]
    },
    {
      id: 'baidu', name: '百度', color: '#3f63f5',
      items: [
        '新一轮冷空气影响我国大部地区',
        '国产芯片产业链最新进展汇总',
        '多地推出育儿补贴新政策',
        '秋冬季流感疫苗接种指南发布',
        '新能源汽车下乡活动启动',
        '城市地铁新线路开通试运营',
        '大学生就业服务专项行动开展',
        '居家适老化改造补贴标准明确',
        '跨境电商出口增长数据公布',
        '全民健身场地设施建设提速'
      ]
    }
  ];

  var DEFAULT_SHORTCUTS = [
    { id: 'sc-bilibili', name: '哔哩哔哩', url: 'https://www.bilibili.com', emoji: '🎬', color: '#fb7299' },
    { id: 'sc-zhihu', name: '知乎', url: 'https://www.zhihu.com', emoji: '💡', color: '#0084ff' },
    { id: 'sc-weibo', name: '微博', url: 'https://weibo.com', emoji: '🔥', color: '#ff8200' },
    { id: 'sc-github', name: 'GitHub', url: 'https://github.com', emoji: '🐙', color: '#8b949e' },
    { id: 'sc-juejin', name: '掘金', url: 'https://juejin.cn', emoji: '⛏️', color: '#1e80ff' },
    { id: 'sc-douban', name: '豆瓣', url: 'https://www.douban.com', emoji: '🎭', color: '#2e963f' },
    { id: 'sc-taobao', name: '淘宝', url: 'https://www.taobao.com', emoji: '🛍️', color: '#ff5000' },
    { id: 'sc-xhs', name: '小红书', url: 'https://www.xiaohongshu.com', emoji: '📔', color: '#ff2442' }
  ];

  var DEFAULT_LAYOUT = [
    { type: 'year-progress', size: 's' },
    { type: 'weather', size: 'm' },
    { type: 'quote', size: 's' },
    { type: 'todo', size: 'm' },
    { type: 'calendar', size: 'm' },
    { type: 'note', size: 'm' },
    { type: 'countdown', size: 's' },
    { type: 'habits', size: 'm' },
    { type: 'hotlist', size: 'm' },
    { type: 'pomodoro', size: 's' }
  ];

  /* ---------- 分类页（侧边栏）默认数据 ---------- */
  var CATEGORY_EMOJIS = ['🏠', '💼', '🎬', '🧰', '🤖', '📚', '🎨', '🎮', '🛒', '📰', '🎵', '✈️', '💡', '🔬', '🏃', '🍜'];
  var SITE_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b'];

  function makeSite(id, name, url, emoji, color) {
    return { id: id, kind: 'site', name: name, url: url, emoji: emoji, color: color };
  }

  var DEFAULT_CATEGORY_SITES = {
    work: [
      makeSite('site-github', 'GitHub', 'https://github.com', '🐙', '#6366f1'),
      makeSite('site-yuque', '语雀', 'https://www.yuque.com', '📚', '#10b981'),
      makeSite('site-notion', 'Notion', 'https://www.notion.so', '📝', '#64748b'),
      makeSite('site-figma', 'Figma', 'https://www.figma.com', '🎨', '#f97316'),
      makeSite('site-feishu', '飞书', 'https://www.feishu.cn', '🚀', '#3b82f6'),
      makeSite('site-tencent-doc', '腾讯文档', 'https://docs.qq.com', '📄', '#06b6d4'),
      makeSite('site-stackoverflow', 'Stack Overflow', 'https://stackoverflow.com', '🧠', '#f59e0b'),
      makeSite('site-juejin', '掘金', 'https://juejin.cn', '⛏️', '#3b82f6')
    ],
    play: [
      makeSite('site-bilibili', '哔哩哔哩', 'https://www.bilibili.com', '📺', '#ec4899'),
      makeSite('site-weibo', '微博', 'https://weibo.com', '🔥', '#ef4444'),
      makeSite('site-zhihu', '知乎', 'https://www.zhihu.com', '💬', '#3b82f6'),
      makeSite('site-douban', '豆瓣', 'https://www.douban.com', '🎬', '#22c55e'),
      makeSite('site-youtube', 'YouTube', 'https://www.youtube.com', '▶️', '#ef4444'),
      makeSite('site-music163', '网易云音乐', 'https://music.163.com', '🎵', '#ef4444'),
      makeSite('site-xhs', '小红书', 'https://www.xiaohongshu.com', '📕', '#f43f5e'),
      makeSite('site-twitch', 'Twitch', 'https://www.twitch.tv', '🎮', '#a855f7')
    ],
    tools: [
      makeSite('site-fanyi', '百度翻译', 'https://fanyi.baidu.com', '🌐', '#3b82f6'),
      makeSite('site-amap', '高德地图', 'https://www.amap.com', '🗺️', '#22c55e'),
      makeSite('site-alipan', '阿里云盘', 'https://www.alipan.com', '☁️', '#06b6d4'),
      makeSite('site-tinypng', 'TinyPNG', 'https://tinypng.com', '🐼', '#10b981'),
      makeSite('site-json', 'JSON 格式化', 'https://json.cn', '🧾', '#f59e0b'),
      makeSite('site-cliim', '草料二维码', 'https://cli.im', '🔳', '#6366f1'),
      makeSite('site-photopea', '在线 PS', 'https://www.photopea.com', '🖌️', '#a855f7'),
      makeSite('site-earth', '地球在线', 'https://www.earthol.com', '🌍', '#14b8a6')
    ],
    ai: [
      makeSite('site-chatgpt', 'ChatGPT', 'https://chatgpt.com', '🤖', '#10b981'),
      makeSite('site-claude', 'Claude', 'https://claude.ai', '🧡', '#f97316'),
      makeSite('site-kimi', 'Kimi', 'https://kimi.moonshot.cn', '🌙', '#6366f1'),
      makeSite('site-doubao', '豆包', 'https://www.doubao.com', '🫘', '#3b82f6'),
      makeSite('site-deepseek', 'DeepSeek', 'https://chat.deepseek.com', '🐋', '#6366f1'),
      makeSite('site-tongyi', '通义千问', 'https://tongyi.aliyun.com', '☁️', '#a855f7'),
      makeSite('site-metaso', '秘塔搜索', 'https://metaso.cn', '🔍', '#14b8a6'),
      makeSite('site-jimeng', '即梦', 'https://jimeng.jianying.com', '🎨', '#ec4899')
    ]
  };

  function defaultCategories() {
    var home = DEFAULT_LAYOUT.map(function (w) {
      return { id: 'it-' + w.type, kind: 'widget', type: w.type, size: w.size };
    });
    return [
      { id: 'cat-home', name: '主页', emoji: '🏠', items: home },
      { id: 'cat-work', name: '工作', emoji: '💼', items: clone(DEFAULT_CATEGORY_SITES.work) },
      { id: 'cat-play', name: '娱乐', emoji: '🎬', items: clone(DEFAULT_CATEGORY_SITES.play) },
      { id: 'cat-tools', name: '工具', emoji: '🧰', items: clone(DEFAULT_CATEGORY_SITES.tools) },
      { id: 'cat-ai', name: 'AI', emoji: '🤖', items: clone(DEFAULT_CATEGORY_SITES.ai) }
    ];
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function defaultState(now) {
    var d = now ? new Date(now) : new Date();
    var nowMs = d.getTime();
    var today = U.todayKey(d);
    var week = U.lastNDays(7, d);

    function habitDates(pattern) {
      return week.filter(function (key, i) { return pattern[i] === 1; });
    }

    return {
      version: STATE_VERSION,
      settings: {
        theme: 'dark',
        accent: 'cyan',
        wallpaper: { preset: 'aurora', image: null, blur: 0, dim: 32, daily: false },
        searchEngine: 'bing',
        weatherSource: 'live',
        openInNewTab: true,
        showSeconds: true,
        name: '',
        density: 'cozy',
        railCollapsed: false,
        ai: {
          mode: 'local',
          baseUrl: '',
          model: '',
          apiKey: '',
          instructions: '',
          temperature: 0.7,
          maxTokens: 800
        }
      },
      categories: defaultCategories(),
      activeCategory: 'cat-home',
      shortcuts: clone(DEFAULT_SHORTCUTS),
      weatherCity: 'beijing',
      todos: [
        { id: 'todo-seed-1', text: '整理本周工作重点', done: false, createdAt: nowMs - 3600000 * 5 },
        { id: 'todo-seed-2', text: '阅读 30 分钟', done: true, createdAt: nowMs - 3600000 * 8 },
        { id: 'todo-seed-3', text: '给自己留一段放松时间', done: false, createdAt: nowMs - 60000 * 40 }
      ],
      notes: [
        {
          id: 'note-seed-1',
          title: '灵感收集',
          body: '今天想做的事：\n1. 把新标签页的配色再调一版\n2. 试试用「年度进度」提醒自己别拖延\n3. 睡前不刷手机',
          updatedAt: nowMs
        }
      ],
      countdowns: [
        { id: 'cd-1', title: '元旦', date: '2027-01-01', kind: 'countdown' },
        { id: 'cd-2', title: '春节', date: '2027-02-06', kind: 'countdown' },
        { id: 'cd-3', title: '相识纪念日', date: '2025-05-20', kind: 'anniversary' }
      ],
      habits: [
        { id: 'hb-1', name: '早起', dates: habitDates([1, 1, 0, 1, 0, 1, 0]), createdAt: week[0] },
        { id: 'hb-2', name: '阅读 30 分钟', dates: habitDates([1, 0, 1, 1, 0, 1, 0]), createdAt: week[0] },
        { id: 'hb-3', name: '运动', dates: habitDates([0, 1, 0, 1, 1, 0, 0]), createdAt: week[0] }
      ],
      pomodoro: { focus: 25, rest: 5, mode: 'focus', running: false, endsAt: null, remaining: 1500 },
      water: { date: today, cups: 2 },
      calendarCursor: today.slice(0, 7),
      hotSource: 'weibo',
      quoteFav: [],
      quoteOffset: 0,
      searchHistory: [],
      aiMessages: [
        {
          role: 'ai',
          text: '你好，我是 Lumen 助手 👋\n一个跑在你浏览器里的本地规则引擎：可以帮你看看今天的待办、生成今日计划、读一下天气和习惯数据。\n不联网，说的话只留在本机。',
          ts: nowMs
        }
      ]
    };
  }

  var Data = {
    STATE_VERSION: STATE_VERSION,
    ENGINES: ENGINES,
    ACCENTS: ACCENTS,
    WALLPAPERS: WALLPAPERS,
    CITIES: CITIES,
    CONDITIONS: CONDITIONS,
    QUOTES: QUOTES,
    HOT_SOURCES: HOT_SOURCES,
    DEFAULT_SHORTCUTS: DEFAULT_SHORTCUTS,
    DEFAULT_LAYOUT: DEFAULT_LAYOUT,
    DEFAULT_CATEGORY_SITES: DEFAULT_CATEGORY_SITES,
    CATEGORY_EMOJIS: CATEGORY_EMOJIS,
    SITE_COLORS: SITE_COLORS,
    defaultCategories: defaultCategories,
    defaultState: defaultState,
    clone: clone
  };
  root.LumenData = Data;
  if (typeof module === 'object' && module.exports) module.exports = Data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
