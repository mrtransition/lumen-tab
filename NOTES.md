# Lumen Tab · 流光新标签页 — 项目笔记

对标产品：WeTab（https://www.wetab.link/）。目标：功能骨架相似的新标签页产品。

## 1. 运行环境与仓库

- 仓库：<https://github.com/mrtransition/lumen-tab>（公开，默认分支 `main`）
- 首次发布：2026-10-26，初始版本 `1.4.0`（初始提交 `d774a73`）；当前发布 `1.5.0`（WeTab 备份导入）
- 目标浏览器：Chrome / Edge，扩展使用 Manifest V3；页面在 `file://` 下可直接打开。
- Node.js 22+（`node:test` + 内置 WebSocket）；无构建步骤、无 npm 依赖。
- QA 默认查找 Windows Edge / Chrome，可用 `EDGE_PATH` 指定其它路径；`QA_REAL_WEATHER=1` 可跳过天气 mock。

## 2. 交付形态与关键决策

1. **双形态同一套代码**：`product/index.html` 双击即可打开（file:// 可用），同时 `product/` 目录可作为「加载已解压的扩展程序」安装（MV3，`chrome_url_overrides.newtab`）。
2. **本地优先 + 两个联网入口**：不加载 CDN / 字体 / 在线壁纸 / 在线图标，图标为内联 SVG，壁纸为 CSS 渐变。实时天气请求 Open-Meteo（无需 Key），用户可在设置中切回演示；AI 仅在主动开启 API 模式后请求配置的模型接口。其余功能零外部请求。
3. **数据只存本地**：localStorage（主状态 key `lumenTab.v1`，天气缓存 key `lumenTab.weather.v1`）；存储不可用时降级为内存态并提示。
4. **模拟数据可复现**：热榜 / 每日一句 / 习惯初始数据用「日期字符串哈希 + mulberry32」生成，同一天刷新结果稳定；天气默认实时，失败或切到演示时使用同一套种子算法。
5. **AI 双模式**：默认本地规则引擎（不联网，可执行待办 / 番茄钟动作）；设置 → AI 可切换到 OpenAI 兼容 API，使用用户填写的地址、模型、Key，支持流式回复、停止生成，以及 `reasoning_content` / 内联 `think` 思考过程折叠展示。API Key 不进导出备份。
6. 不使用经典脚本 module（file:// 下 ES module 会被 CORS 拦），全部用 IIFE 挂到 `globalThis`。
7. **WeTab 备份只做本地迁移**：`webtab-import.js` 识别 WeTab 导出的 `.data`（JSON）。只读分类 / 网站 / Dock / 少量设置，不下载远程图标或壁纸；图片图标退化为文字色块，组件与云端数据不迁移。

## 3. 目录结构

```
lumen-tab/
├─ GUIDE.md                  # 完整使用指南
├─ NOTES.md                  # 项目笔记（本文件）
├─ README.md                 # 用户视角：打开方式、功能点、扩展安装
├─ docs/                     # README 预览图
├─ product/
│  ├─ index.html
│  ├─ manifest.json          # MV3 扩展清单
│  ├─ assets/                # 扩展图标（Pillow 生成）
│  ├─ css/base.css           # 布局、时钟、搜索、Dock、响应式
│  ├─ css/widgets.css        # 小组件卡片样式
│  ├─ css/pages.css          # 分类侧栏、网站/文件夹磁贴、分类页响应式
│  ├─ css/panels.css         # 设置 / 组件库 / AI / 弹窗 / toast
│  └─ js/
│     ├─ icons.js            # 内联 SVG 图标库
│     ├─ util.js             # 日期、种子随机、DOM、URL、文件工具
│     ├─ data.js             # 引擎、壁纸、城市（含经纬度）、名句、热榜、默认分类与网站
│     ├─ weather.js          # Open-Meteo 客户端、WMO 映射、10 分钟缓存与离线回退
│     ├─ webtab-import.js    # WeTab `.data` 识别、分类/网站/Dock 映射与清洗
│     ├─ store.js            # 状态 + localStorage + 分类动作 + 导入迁移
│     ├─ widgets-core.js     # 年度进度/天气/日历/名句/热榜
│     ├─ widgets-prod.js     # 待办/便签/倒计时/习惯/番茄钟
│     ├─ search.js           # 搜索框 + Dock 快捷方式
│     ├─ ui.js               # 面板（设置/组件库）、分类管理、对话框、右键菜单、Toast
│     ├─ pages.js            # 侧栏 + 分类页网格 + 文件夹 + 拖拽
│     ├─ ai.js               # 本地规则引擎 + 对话面板 + API 模式流式接线
│     ├─ ai-api.js           # OpenAI 兼容客户端（SSE / 超时 / 错误）
│     ├─ markdown.js         # 轻量 Markdown 渲染（转义优先、代码/表格/链接白名单）
│     └─ app.js              # 启动、主题壁纸、时钟、全局快捷键
├─ tests/unit.test.mjs       # node:test 纯逻辑断言
└─ qa/qa.mjs                 # CDP 统一 QA（smoke / targeted / full / extension / shots）
```

## 4. 数据字典（state）

```
version: 2
settings: {
  theme: 'dark'|'light'|'auto',
  accent: 'cyan'|'violet'|'pink'|'amber'|'emerald',
  wallpaper: { preset:'aurora', image:null, blur:0, dim:32, daily:false },
  searchEngine: 'bing',
  weatherSource: 'live'|'demo', // live=Open-Meteo；demo=完全离线
  openInNewTab: true,
  showSeconds: true,
  name: '',                 // 称呼，用于问候语
  density: 'cozy'|'compact',
  railCollapsed: false,     // 侧边栏是否收起
  ai: {
    mode: 'local'|'api',
    baseUrl: '',            // OpenAI 兼容地址，仅 http(s)
    model: '',
    apiKey: '',             // 仅本机，导出备份会剔除
    instructions: '',       // 可选系统提示词，≤2000 字，仅 API 模式
    temperature: 0.7,
    maxTokens: 800
  }
}
categories: [{
  id, name, emoji,
  items: [
    { id, kind:'widget', type, size:'s'|'m'|'l' },
    { id, kind:'site', name, url, emoji, color },
    { id, kind:'folder', name, sites:[{ id, kind:'site', name, url, emoji, color }] }
  ]
}]
activeCategory: 'cat-home'
shortcuts: [{ id, name, url, emoji, color }]
todos:     [{ id, text, done, createdAt }]
notes:     [{ id, title, body, updatedAt }]
countdowns:[{ id, title, date:'YYYY-MM-DD', kind:'countdown'|'anniversary' }]
habits:    [{ id, name, dates:['YYYY-MM-DD'], createdAt }]
pomodoro:  { focus:25, rest:5, running:false, mode:'focus', endsAt:null, remaining:1500 }
calendarCursor: 'YYYY-MM'
hotSource: 'weibo'|'zhihu'|'baidu'
quoteFav:  [index...]
quoteOffset: 0
searchHistory: ['...']  // 最多 8 条
aiMessages: [{ role, text, reasoning, ts }]
```

迁移：v1 备份里的 `layout` 会转成 `cat-home.items` 的组件，再补齐默认分类，删除 `layout`，`version` 置 2。
分类动作：`addCategory/updateCategory/removeCategory/moveCategory/setActiveCategory`；
内容动作：`addSite/updateSite/removeItem/reorderItems/moveItem/moveItemToCategory/setItemSize/addWidgetItem`；
文件夹：`addFolder/renameFolder/addSiteToFolder/updateFolderSite/removeSiteFromFolder`。
兼容层 `hasWidget/addWidget/removeWidget/setWidgetSize/moveWidget` 都作用于当前分类。

WeTab 导入：识别 `data.store-icon.icons`；每个分类 → Lumen 分类，`type:'site'` → 网站，`type:'widget'` 统一跳过并计数。网站只接受 `normalizeWebUrl` 通过的 `http(s)` 链接；`bgColor` 转 `#rrggbb`，图片图标按名称首字生成 emoji，远程 `bgImage` 不落盘。Dock 按 `dockIdList` 与原网站 id 映射，备份里缺失的引用只能跳过；`store-setting.followSystem` → `theme:'auto'`，`leftBarDisplayStatus:'hide'` → 折叠，`iconOpenMethod` → 新标签页开关；天气按 `addedCity` 经纬度就近映射到内置城市。导入使用 `Store.validateImport` 再清洗一次，且不带入 Lumen 的示例待办 / 便签。

## 5. 页面清单 / 验收点

- 新标签页主界面：左侧分类栏 + 页头 + 右侧分类网格（网站 / 文件夹 / 组件 / 添加磁贴）、时钟、问候、搜索、Dock、底部提示
- 分类：默认 5 类（主页/工作/娱乐/工具/AI），点击切换，新建/重命名/换图标/删除/拖拽排序/折叠并持久化
- 网站：添加、编辑、打开、删除、拖拽排序、拖到侧栏跨分类、右键菜单
- 文件夹：新建/重命名/删除、2×2 预览、弹窗内增删改网站、拖网站进文件夹、Esc 关闭
- 小组件：年度进度、天气、每日一句、待办、日历、便签、倒计时、习惯打卡、热榜、番茄钟；尺寸/前移后移/隐藏/移动分类/加回
- 面板：AI 助手侧栏、设置（外观/分类/组件/数据/关于）、组件库、快捷方式编辑弹窗、确认弹窗、右键菜单、Toast
- 交互：拖拽排序、主题/壁纸切换、自定义壁纸、导入导出、重置、v1 备份迁移
- 快捷键：`/` 聚焦搜索、`Esc` 关闭浮层/文件夹、`Ctrl/⌘+K` 打开 AI、`?` 快捷键说明
- 响应式：390 / 768 / 1440 无横向溢出；≤900 侧栏变横向分类条，≤640 组件占满三列、网站三列、文件夹整行

## 6. 常用命令

```bash
node --test tests/unit.test.mjs
node qa/qa.mjs --mode smoke
node qa/qa.mjs --mode targeted
node qa/qa.mjs --mode full --widths 390,768,1440
node qa/qa.mjs --mode extension
node qa/qa.mjs --mode full --shots          # 生成 docs/preview-*.png
```

需要真实天气联网时：`QA_REAL_WEATHER=1 node qa/qa.mjs --mode smoke`。

## 7. 完成情况（2026-10-26）

- [x] 环境与权限
- [x] 图标、工具、数据、状态层 + 单测
- [x] 页面骨架与基础样式
- [x] 搜索 + Dock
- [x] 10 个小组件
- [x] 面板 / 弹窗 / AI
- [x] 分类侧边栏 + 网站 + 文件夹 + 跨分类拖拽
- [x] 组件与网站混排、分类管理、折叠侧栏
- [x] 扩展清单 + 图标
- [x] CDP QA（三层）+ 响应式
- [x] README / 交付
- [x] WeTab `.data` 备份导入（分类 / 网站 / Dock / 设置映射）
- [x] GitHub 发布（`main`：1.4.0 初始，1.5.0 当前）

## 8. 验证记录（2026-10-26）

- `node --test tests/unit.test.mjs` → **33/33**（日期/种子/URL/静态数据不变量/默认分类与网站/分类动作/v1 迁移/导入校验/危险协议/设置与壁纸白名单/异常集合清洗/AI 配置与助手设定清洗/密钥导出/OpenAI SSE 客户端/思考内容拆分/Markdown 渲染与转义/实时天气解析与 WMO 映射/10 分钟缓存与离线回退/新标签页打开失败不回退当前页/WeTab 备份识别、映射与清洗/manifest/外部请求边界）
- `node qa/qa.mjs --mode full --widths 390,768,1440` → **194/194**（交互回归单独跑为 158/158）
  - 冒烟 16 项、交互 120+ 项、持久化 5 项、响应式 30+ 项（组件与网站/文件夹/侧栏分别验证）
  - 新增覆盖：侧栏切换分类、页头统计、点击打开网站、添加/右键编辑网站、文件夹新建与内部增删、弹窗层级与 Esc 顺序、拖到侧栏跨分类、侧栏分类拖拽排序、新建/重命名/删除分类、折叠与展开、组件库加到网站分类、刷新后分类/网站/文件夹/组件保留、v1 备份迁移
  - AI API 覆盖：设置入口、配置说明可见、配置保存、本机 Key 持久化、测试连接、API 请求使用配置模型/Key、助手设定注入系统提示词、请求携带本机上下文、SSE 流式回复入栈、思考内容单独保存并折叠渲染、Markdown 粗体/列表/代码块渲染、生成结束恢复按钮、导出不含 Key、本地模式零网络
  - 天气覆盖：QA 注入固定 Open-Meteo 响应，验证实时温度/风力/来源标记；设置切换「演示/实时」不额外发起请求；切城市后继续使用缓存
  - WeTab 导入覆盖：合成 `.data` 备份识别、确认摘要、分类/网站/Dock 映射、仅含组件分类保留为空、`followSystem` → 自动主题、侧栏折叠、不混入 Lumen 示例待办；导入后恢复 Lumen 备份
  - 实际 WeTab 备份转换校验：12 个分类、124 个网站、1 个 Dock，跳过 1 个非 http(s) 本地链接、30 个组件和远程壁纸；空分类 2 个
  - 交互审计新增：侧栏提示浮层不被裁剪、菜单边缘不出界与内部滚动、菜单键盘导航/Shift+F10 定位、弹窗-组件库-设置面板的 Tab 循环与回焦、遮罩关闭文件夹、浮层打开时 `/` 与 `?` 不抢焦点、Esc 关搜索引擎菜单、满文件夹拖入不丢网站、拖动把手单击后释放、危险协议在表单层被拒、导入前二次确认、输入法组合中 Enter 不误选联想、便签切换前自动保存、紧凑布局开关、网站右键上移
- `node qa/qa.mjs --mode extension` → **4/4**（新标签页接管 `chrome-extension://…/index.html`，10 卡片渲染，清单可读）
- `QA_REAL_WEATHER=1 node qa/qa.mjs --mode smoke` → **16/16**：跳过天气 mock，用真实 Open-Meteo 验证联网；默认 QA 仍注入固定响应，避免依赖第三方网络。
- `node qa/qa.mjs --mode full --shots` → 生成 `docs/preview-desktop.png`（1440×1000）与 `docs/preview-mobile.png`（390×844），截图前清空本地状态并回到首屏。
- 390 / 768 / 1440 三档：`scrollWidth == innerWidth`，磁贴与卡片全在视口内，固定内容组件无裁切；窄屏侧栏为横向分类条且分类名常显
- 全量日志：390px 3 列（组件占满）、768px 2 列、1440px 4 列；桌面侧栏 84px 纵向

### 历次 UI / 交互审计修正

- 桌面侧栏分类名改为挂在 `body` 的浮层提示，避免被 `.rail__list` 的滚动容器裁剪
- 网站拖入已满文件夹：先确认 `addSiteToFolder` 成功再删除原网站，失败给出提示
- 组件拖动把手在 pointerup / pointercancel / blur 后恢复 `draggable=false`，单击不会让整卡持续可拖
- 网站、Dock、导入备份统一只接受 `http(s)`；设置 / 壁纸 / 数值做白名单与范围校验
- 弹窗、文件夹、组件库、设置面板加入 Tab 焦点循环与关闭回焦；菜单支持方向键、Home/End、Esc 回焦
- 菜单限制最大宽高并允许内部滚动，内部滚动不再触发关闭；刚打开的聚焦滚动有 260ms 保护
- 打开面板 / 组件库时先关文件夹；文件夹支持点击遮罩关闭；`/` 在任意浮层打开时不抢焦点
- 文件夹内空状态聚焦「添加网站」；新建分类自动切换并用 `scrollIntoView` 保证在侧栏可见
- 表单 emoji 支持组合 emoji（Intl.Segmenter），颜色快捷点有选中态；复制链接在非安全上下文回退到 textarea
- 导入备份前二次确认；搜索输入法组合中 Enter 不再误选联想；浮层打开时 `?` 不越过当前浮层
- 便签防抖保存改为切换/新建/删除/组件销毁前强制落盘，避免 450ms 内切页丢内容
- 待办/便签/倒计时/习惯/番茄钟/AI 消息/搜索历史/饮水/热榜源在读取与导入时统一清洗，坏备份不再让组件崩溃
- 图片上传改为画布缩放 + JPEG 压缩后再入库；网站与文件夹右键菜单补充「上移 / 下移」键盘排序入口
- 搜索引擎下拉：`.searchbar` 提升到独立层叠上下文（z-index 20），菜单改用近实色 `--menu-surface`，避免被 Dock 图标盖住/点穿
- 设置里的「默认搜索引擎」下拉启动时填充 5 个引擎并回显当前值；搜索栏切换引擎后下拉同步，设置切换后搜索栏也即时同步
- 原生 `<select>` 的弹出列表单独设置 `color-scheme` 与 `option` 背景/文字色：暗色主题用 `#0d1321`、浅色主题用白色，避免系统弹层纯白
- 搜索与网址直跳固定用 `_blank + noopener` 打开；不再把 `window.open` 在 noopener 下的 `null` 返回值误判为拦截并回退 `location.href`，当前页始终保留
- 状态标记：版本 `1.5.0`；单元 33/33、交互 158/158、全量 194/194、扩展 4/4
- 新增 `webtab-import.js`：识别 WeTab `.data` 的 `data.store-icon.icons`，导入分类、网站、Dock、主题 / 侧栏 / 打开方式 / 天气城市；图片图标转文字色块，组件与远程壁纸不导入；所有 URL 与名称仍走 `Store.validateImport` 清洗
- 修复主题白名单未包含 `auto` 的问题：跟随系统主题现在能在刷新和导入后保留
- 新增 AI API 配置：设置 → AI 可切换本地/API、填写地址/模型/Key/温度/上限，支持常用服务快捷填充、测试连接、保存状态与错误提示
- AI 配置页新增固定「AI 助手配置说明」（本地/API 选择、地址与 Key 填法、测试→保存、CORS 与安全提示），并新增可选「助手设定」系统提示词（≤2000 字，仅 API 模式生效，随对话注入 system 消息）
- 新增 `ai-api.js`：OpenAI 兼容 `POST /chat/completions`、Bearer Key、SSE 增量解析、超时与中止、HTTP 错误详情；`host_permissions` 支持扩展直连
- AI 面板 API 模式显示模型徽标、流式生成、停止按钮；请求带待办/习惯/倒计时/天气摘要，API 失败给出可读提示；导出备份剔除 Key，导入时保留本机 Key
- AI 聊天新增思考内容处理：解析 `reasoning_content` / `reasoning` 字段与内联 `think` / `thinking` / `thought` / `reasoning` 标签，流式时实时展开「思考中…」，完成后收纳为「思考过程」折叠块；思考不进入后续请求上下文
- 新增 `markdown.js`：先转义再生成白名单标签，支持标题/粗体/斜体/删除线/链接/行内代码/围栏代码块（复制按钮）/列表（含嵌套）/引用/分隔线/表格；AI 气泡流式重渲染，链接只允许 http(s)，原始 HTML 与远程图片不执行
- 新增 `weather.js`：Open-Meteo 实时天气（无需 Key，城市经纬度），WMO 天气码映射、风力/风向、五日预报、10 分钟 localStorage 缓存；失败/断网回退演示数据；设置 → 外观可切换「实时 / 演示」，组件右上角可刷新；AI 上下文优先使用实时缓存
- 天气接口只发送所选城市经纬度；切到演示模式后不发天气请求；QA 通过注入固定响应避免依赖第三方网络

## 9. 已知边界与后续

- 天气默认 Open-Meteo 实时（缓存 10 分钟），断网/失败回退演示；热榜 / 名句为演示数据。接口替换点：`weather.js` 的 `endpointFor/parsePayload`、`data.js` 的 `CITIES` 坐标。
- AI 默认本地规则（可做真实状态查询与少量写操作）；可选接入 OpenAI 兼容 API，API 模式只对话、不执行本机写操作。
- WeTab 的云端能力未包含：AI PPT / AI 写作 / 思维导图 / 图片编辑 / PPT 模板 / PDF 工具箱 / 小红书模板、账号登录与多端同步、Pro 订阅。
- 网站图标为 emoji / 首字，不抓 favicon；除实时天气与 AI API 外不发起外部请求。
- 扩展未上架商店；Safari / 移动端无 newtab 覆盖能力。
- 自定义壁纸 base64 存 localStorage，建议 < 3.5MB。
- 后续可做：天气自动定时刷新 / 预警、账号与多设备同步、壁纸库、小组件市场、触屏长按拖拽。

## 10. 工程约定

- 浏览器端全部 IIFE + `globalThis` 命名空间，兼容 `file://` 直接打开（不用 ES module）。
- 数据只经 `LumenStore` 修改，组件不直接写 state。
- 所有动态文本走 `textContent` 或 `escapeHtml`，避免注入。
- 临时脚本（图标生成、截图）用完即删，不留交付目录。

