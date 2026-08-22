# Crypto Top 项目交接上下文

> 作用：供完全没有读过历史 thread 的新 Codex 实例接手本项目。先读本文件，再按文中路径核对代码。
>
> 最近核对：2026-08-22（Asia/Shanghai）。本文件记录的是这一时点的已验证状态；网络、GitHub Release 和工具版本等易变化信息在执行发布前仍应重新确认。

## 1. 项目目标

Crypto Top 是一个极小型桌面行情监视器，默认显示 BTC 和 ETH，并允许添加最多 6 个自选币种，持续显示真实美元成交价及 UTC 自然日涨跌，目标平台为 Windows、macOS 和 Linux。

核心产品目标：

- 使用免费、无需 API Key 的公开行情源。
- 用 WebSocket 尽可能快地刷新当前全部自选 `*-USD` 成交价。
- 严格显示真实 USD；不得把 USDT 静默标成 USD。
- 涨跌幅以 UTC+0 当天 `00:00` 后的首笔同交易所成交价为基准，不得使用滚动 24 小时涨跌冒充。
- 窗口始终置顶、极度紧凑、低干扰，并可常驻系统托盘。
- Windows/Linux 不占任务栏，macOS 不占 Dock；从托盘恢复或彻底退出。
- 一套源码支持三平台，并在 GitHub Release 提供各平台可安装二进制。

产品当前名称为 **Crypto Top**，仓库为 [ArchLinuxStudio/btc-price-monitor](https://github.com/ArchLinuxStudio/btc-price-monitor)，Tauri identifier 为 `com.cryptotop.monitor`。

## 2. 用户已经明确的需求、偏好与已接受约束

本节既包含用户的明确原话，也包含用户看过、接受并已发布的产品行为；不要在后续 thread 中重复询问或无故回退，除非用户主动改变要求。具体可访问性细节属于当前实现约束，列在架构章节，不冒充用户逐项提出的原话。

### 2.1 行情语义

- 默认固定显示 BTC、ETH；用户可通过 `+` 搜索并添加最多 6 个 Coinbase 在线 `*-USD` 自选币种，总数最多 8 个。自选币可删除，BTC/ETH 保持固定，列表在本机持久化。
- 优先速度和实时性，应使用公开 WebSocket 推送；REST 只能做当前价兜底或低频取得 UTC 日开盘。
- API 必须免费且不需要用户提供密钥。
- USD 必须是真实 USD。禁止把 `BTCUSDT` / `ETHUSDT` 无提示地显示为美元。
- 涨跌幅基准被用户明确规定为 **UTC+0 自然日**，即当天 `00:00 UTC` 后的首笔同源成交价；禁止恢复成 `24H` 滚动涨跌。
- 当前显示价和日开盘必须来自同一家交易所，禁止用 Coinbase 当前价与 Kraken 开盘价交叉计算。

### 2.2 界面与交互

- 用户反复强调“紧凑”，不接受为极端价格留下大块空白。
- 用户的原意是 BTC 只需覆盖“几十万”、ETH 只需覆盖“几万”，不必为不现实的极端价格留宽；当前窗口宽度必须固定为 `208px`，默认两行时高度 `92px`。
- 当前实现进一步实测可完整显示 BTC `999,999.99`、ETH `99,999.99` 和涨跌 `−99.99%`；这些是已验证实现边界，不是用户逐字规定的三个精确数值。
- 风格应现代、紧凑、有高级感、不老土，并尽量消除无意义留白。
- 保留 BTC/ETH、数据源/连接状态、`Δ UTC+0` 和窗口控制；增加币种不能牺牲正常行情行的价格列来常驻删除按钮。
- 添加/搜索/删除界面只在点击 `+` 时临时替换行情区，不与行情区叠加。普通行情最多同时显示 4 行，更多币种在内部滚动；窗口正常模式最高 `158px`、管理模式最高 `170px`，不得随币种数量无限增高。
- 若以后先给 UI 方案或原型，用户希望直接看到真实图片/效果图，不要只给文本线框或口头描述。
- 不要用 HTML `title`、动态 title 或托盘 tooltip 在鼠标悬停时弹出冗余信息；无障碍说明应使用不会产生 hover 弹窗的 `aria-label`。

### 2.3 窗口与托盘

- 程序启动后不应占 Windows/Linux 任务栏区域，也不应占 macOS Dock。
- 必须有托盘图标；右键菜单至少提供“显示窗口”“隐藏窗口”“退出 Crypto Top”。
- 当前产品默认仍显示浮动监视窗口，同时只在系统托盘保留图标、不产生任务栏/Dock 项；不要把“只在小图标区域显示”误改成默认静默隐藏主窗口。
- 顶部第一个按钮现为自选管理 `+`，第二个关闭按钮及系统关闭请求（如 Alt+F4）只隐藏窗口，不退出进程；旧的重复最小化按钮不应恢复。
- 完全退出走托盘菜单；不要把关闭按钮改回直接结束程序，除非用户明确要求。
- Windows 是否把新托盘图标直接显示还是收入任务栏右侧 `^` 隐藏区由系统/用户设置决定，应用无法强制固定。
- 窗口必须持续尝试保持最上层，但不能声称能覆盖 UAC 安全桌面、锁屏、独占全屏或所有 Wayland 合成器。

### 2.4 发布与仓库

- 源码和编译好的 Release 都放在 `ArchLinuxStudio/btc-price-monitor`。
- Release 文案中的中文必须是正确 UTF-8，不能再次出现一串问号乱码。
- 后续正式版本必须同时提供 Windows、macOS Apple Silicon、macOS Intel、Linux AppImage 和 Linux deb；不能只上传本机 Windows 安装包。
- 用户说“发布/推送”时，应先验证三平台构建与 Release 资产完整性，再报告完成。

## 3. 当前状态快照

### 3.1 Git 与版本

- 当前分支：`main`
- 本轮功能开发前的基线是 `3fb55a5cb785149161eabbc278541fdb62ba9bb6`（`docs: add project handoff context`）。2026-08-22 用户已要求把本轮完整功能提交并推送到 `origin/main`；接手时以 `git status --short --branch` 和 `git log -3 --oneline` 核对实际最新提交。
- 本轮提交包含自选币种、四路免费行情热备、hover 文本清理、动态紧凑窗口，以及对应测试和文档。主要修改/新增文件为 `README.md`、`package.json`、`src/`、`tests/`、Tauri 窗口 command/config 和本文件。**代码进入 main 不等于 GitHub Release 已包含这些功能**；未创建新标签或 Release。
- 应用当前版本：`1.2.1`
- 当前版本必须同步出现在：
  - `package.json`
  - `package-lock.json` 根 package 与本包记录
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock` 的 `crypto-top-monitor` 包记录
  - `src-tauri/tauri.conf.json`
- 现有标签及主提交：
  - `v1.0.0` → `d72bec6`：首个三平台版本
  - `v1.1.0` → `6cd460f`：超紧凑 UTC 自然日版本
  - `v1.2.0` → `1acd7e2`：系统托盘模式
  - `v1.2.1` → `0a272cd`：宽度压缩到 208 px
- `0a9017b` 是 `v1.2.1` 之后的 CI/README 提交；不要移动或重打 `v1.2.1` 标签。下次业务发布应正常升级新版本并创建新标签。

### 3.2 已验证质量状态

2026-08-22 在当前 Windows 环境重新执行并通过：

- `npm.cmd run check`：语法检查及 Node 测试 **58/58 通过**（36 项行情/容错、16 项 watchlist、3 项价格格式和 3 项 UI/CSP 静态回归）。
- 动态高度实现后 `cargo fmt --all -- --check`、`cargo test --locked`（2/2）、`cargo check --locked`、`cargo clippy --locked --all-targets -- -D warnings` 均通过。
- 本地浏览器实际使用 Coinbase 免费目录搜索 SOL，完成添加、实时价格/UTC 涨跌显示和删除闭环，控制台无 warning/error。浏览器最小 viewport 被限制为 240×160，所以精确 208px 视觉另用原生 Tauri 窗口完成复核。
- 原生 Tauri debug 窗口已截图复核：外框含 Windows shadow 为 224×101，实际内容为 208×92；默认两行无空白/裁切。打开含 BTC/ETH 两项的管理页后外框为 224×123（内容 208×114），高度计算和紧凑面板正确。新增四路热备后再次 smoke，实时 Coinbase/UTC 涨跌正常且尺寸仍为 224×101。截图在 ignored 的 `artifacts/ui-*.png`，不是源码交付物。
- `npm.cmd run build:windows` 成功生成本轮 NSIS（见 9.3）。唯一构建提示是 MSVC linker 输出导入库路径被 Rust 报为 `linker_messages` warning，不是代码/clippy warning。

### 3.3 GitHub Release 状态

2026-08-21 通过 GitHub API 重新核对：

- [v1.0.0](https://github.com/ArchLinuxStudio/btc-price-monitor/releases/tag/v1.0.0)：6 个资产（含 Windows 安装版和便携版，以及四个 Linux/macOS 包）。
- [v1.1.0](https://github.com/ArchLinuxStudio/btc-price-monitor/releases/tag/v1.1.0)：5 个资产。
- [v1.2.0](https://github.com/ArchLinuxStudio/btc-price-monitor/releases/tag/v1.2.0)：5 个资产。
- [v1.2.1](https://github.com/ArchLinuxStudio/btc-price-monitor/releases/tag/v1.2.1)：5 个资产。

`v1.1.0`、`v1.2.0`、`v1.2.1` 最初只有 Windows 文件，后来已从各自成功的 Actions 构建中取回 Linux/macOS 产物并补齐；远端大小和 GitHub 提供的 SHA-256 digest 已逐项与本地核对。历史 run id 分别为 `31489527643`、`31492765116`、`31495674502`，但 Actions artifact 会过期，不应再依赖它们作为永久存档。

## 4. 整体架构

项目没有前端打包器，也没有服务器。它由 Tauri 原生壳和静态 HTML/CSS/JavaScript 组成。

```text
Coinbase Products/Currencies ─ watchlist 搜索 ─ localStorage
Bitstamp Markets ─ 精确 USD 现货映射 ───────────┤
                                                │
Coinbase Advanced Trade WS ─┐                    ▼
Kraken WebSocket v2 ────────┼─ PriceFeed 动态订阅/选源/过期/重连 ─┐
Bitstamp live trades ───────┤                                      │
Bitfinex trades + 1D candles┘                                      ├─ main.js 30 FPS 合并渲染 ─ UI
Coinbase Exchange REST（缺失币种最新价兜底）────────────────────────┤
Coinbase/Kraken/Bitstamp（按当前选中来源取 UTC 日开盘）──────────────┘

Tauri/Rust ─ 窗口、置顶、右上角定位、托盘、隐藏/退出、权限与打包
```

### 4.1 Tauri/Rust 原生层

关键文件：

- `src-tauri/src/lib.rs`：应用入口逻辑、托盘菜单、窗口显示/隐藏、置顶、任务栏/Dock 策略、恢复事件与初始定位。
- `src-tauri/src/main.rs`：桌面二进制入口，release 下关闭 Windows 控制台窗口。
- `src-tauri/tauri.conf.json`：窗口固定尺寸、安全策略、CSP、图标与 bundle 元数据。
- `src-tauri/tauri.{windows,macos,linux}.conf.json`：各平台 bundle 类型。
- `src-tauri/capabilities/main.json` 与 `src-tauri/permissions/window-controls.toml`：最小窗口命令权限。
- `src-tauri/Cargo.toml`：Tauri 2，启用 `tray-icon`；release profile 优先小体积。

当前行为：

- 主窗口宽度固定 `208px`、初始/最小高度 `92px`、最大高度 `170px`，无系统装饰、不可手动缩放、默认置顶，初次放在主屏幕工作区右上方并留 16 逻辑像素级边距。
- 自定义 `set_monitor_layout(row_count, management_open, item_count)` 在 Rust 内计算并钳制高度：行情 2/3/4+ 行为 `92/125/158px`，管理面板 1/2/3/4+ 项为 `92/114/142/170px`；始终维持宽度 208，不开放通用 set-size 权限，调整时保持用户当前左上角位置。
- Windows/Linux 使用 `skipTaskbar`；macOS 使用 `ActivationPolicy::Accessory` 隐藏 Dock 图标。
- 聚焦、系统恢复及前端每 10 秒都会重新确认 always-on-top；macOS/Linux还会重申全工作区可见。
- `CloseRequested` 被拦截并改为隐藏；托盘 `quit` 使用 `app.exit(0)`，不会被窗口关闭拦截逻辑阻止。
- Windows/macOS 左键托盘图标可恢复；所有平台菜单可显示/隐藏/退出。Tauri 在 Linux 不发送 `TrayIconEvent`，所以 Linux 不得依赖左键恢复，菜单才是可靠入口。

### 4.2 静态前端/UI

关键文件：

- `src/index.html`：动态行情 template、状态/拖动区、`+` 管理按钮、隐藏按钮和临时搜索管理面板。
- `src/styles.css`：固定 208px 宽、33px 行高、最多 4 行滚动、紧凑管理面板、键盘焦点态与 reduced-motion。
- `src/main.js`：加载/保存 watchlist、管理目录搜索/添加/删除、订阅 PriceFeed、约 30 FPS 合并渲染、动态窗口高度和 Tauri 命令调用。
- `src/watchlist.js`：BTC/ETH 固定模型、最多 8 币约束、版本化 localStorage、严格 Coinbase 在线 USD 目录解析、本地搜索，以及 Bitstamp/Bitfinex 精确交易对映射解析。运行时只后台读取具备 WebView CORS 的 Bitstamp 目录；Bitfinex 自选映射不会靠字符串猜测。
- `src/price-format.js`：按价格数量级自适应小数位；廉价币不能错误显示为 `0.00`。

当前宽度预算（修改 UI 时必须一起考虑）：

- 标题栏：内容区 + `+` 与隐藏两个 `24px` 控件，总控件宽 `48px`。
- 每个行情行：`40px minmax(0,1fr) 40px`，列间距 `4px`，左右 padding 各 `6px`；总固定列宽与旧版相同。
- 208px 窗口扣除边框后，价格列约 `106px`；这正是当前目标价格范围的紧凑安全下限附近。
- 5 个以上币种出现 3px 滚动条时右 padding 自动减到 3px，抵消滚动条占宽；报价区此时可聚焦并支持上下方向键按 33px 滚动。
- `data-tauri-drag-region="deep"` 用于确保标题栏子元素区域也可拖动；不要退回只标父容器的旧写法。
- 当前视觉实现有意去掉厚重渐变、大面积紫色光晕、价格文字强光和肥厚胶囊；这些是已接受的设计方向，不是用户逐项口述的禁令。
- 高频 prices 区域不使用 `aria-live`，只有连接状态是 live region；动画尊重 `prefers-reduced-motion`，涨跌使用 `+` / `−` 且不只依靠颜色。除非有明确理由，不要回退这些可访问性处理。

### 4.3 行情与容错

全部逻辑位于 `src/price-feed.js`，单元测试位于 `tests/price-feed.test.js`。

实时源会同时连接：

1. Coinbase Advanced Trade：`wss://advanced-trade-ws.coinbase.com`
   - `ticker` 订阅由当前全部自选 Coinbase product IDs 动态生成，另订阅 `heartbeats`。
   - 公共频道，无 API Key。
2. Kraken WebSocket v2：`wss://ws.kraken.com/v2`
   - 只订阅具有**已验证精确** `krakenSymbol` 的产品；当前 watchlist 仅固定 BTC/ETH 映射为 `BTC/USD`、`ETH/USD`，绝不根据 Coinbase symbol 猜 Kraken pair。
   - 公共频道，无 API Key；watchdog 还会发送应用层 ping。
3. Bitstamp WebSocket v2：`wss://ws.bitstamp.net`
   - 每个具有精确 `bitstampSymbol` 的产品订阅 `live_trades_{market_symbol}`；交易解析同时兼容 `price_str`/`price`，优先使用微秒交易所时间戳。
   - BTC/ETH 使用内置验证映射；自选币在后台通过 `GET /api/v2/markets/` 严格筛选 `counter_currency=USD`、`market_type=SPOT`、`trading=Enabled` 后才启用。目录失败时保留上次验证映射，不影响 Coinbase 搜索/行情。
4. Bitfinex Public WebSocket v2：`wss://api-pub.bitfinex.com/ws/2`
   - 同一连接为每个映射产品订阅 `trades` 和 `trade:1D:*` candles；最多 8 币即 16 channels，低于官方每连接 25 channels 限制。
   - 解析 `chanId`、trade snapshot、`te`/`tu`、heartbeat 和 candle snapshot/update；旧 snapshot 按最大 MTS 取最新，不能被旧成交覆盖。
   - 每个 trades/candles 订阅都必须收到唯一 ACK；任一订阅被拒绝或 10 秒内未全部确认时关闭该 socket，并沿用 jitter 指数退避重连。控制事件不能进入报价或更新 ticker freshness。
   - 当前只内置已验证的 BTC/ETH USD pair。Bitfinex REST 缺少 WebView 所需 CORS，故运行时不读取其 REST 目录，也绝不拼接自选 pair。

`PriceFeed({ products })` 和 `setProducts(products)` 使用 Coinbase product ID 作为统一主键。添加/删除会安全重建共享 socket，保留仍存在产品的有效 quote/open/retry 状态，并通过 revision + AbortController 阻止删除前的旧 REST/UTC 请求回写。

选源规则：

- Coinbase 报价在 5 秒内时优先。
- 否则先从 Kraken、Bitstamp、Bitfinex 及较旧的 Coinbase WebSocket 中选择 12 秒内最新的实时源；只有所有 WebSocket 都不新鲜时才允许 Coinbase REST 兜底。
- 都过期时保留最新末次价格，但打上 stale 状态。
- 连接有 12 秒握手超时；Coinbase/Kraken 使用 10 秒消息空闲和 20 秒 ticker sentinel，Bitstamp/Bitfinex 按协议 heartbeat 使用 30 秒阈值。所有连接独立带 jitter 指数退避重连（约 0.5 秒起，最多 30 秒）。ticker 健康哨兵只使用活跃的固定 BTC/ETH；低流动性自选币长时间无成交只会自身 stale/REST 兜底，绝不能让承载全部币种的共享 socket 永久重连。Bitfinex 的日 K 事件不会被误算成 ticker freshness。

HTTPS 当前价兜底：

- 端点按需生成 Coinbase Exchange `/products/{productId}/ticker`。
- 每 5 秒只请求四家 WebSocket 都没有新鲜行情的产品；最多 8 个币种且单批并发上限为 3，控制故障期免费 REST 请求突发量。
- 单轮总超时 8 秒；各产品分别捕获错误，一个失败不能丢掉其他成功结果。
- REST ticker 的 freshness 使用 payload 自带的最后成交 `time`，不能用 HTTP 收包时刻把安静币种的旧成交伪装成新鲜价格。
- REST 报价标记为 `Coinbase REST`，UTC 日开盘仍归到 Coinbase 源，不能凭空使用 24h 字段。

### 4.4 UTC+0 自然日涨跌

这是业务语义核心，修改前应先读相关测试。

- 公式：`(current / dayOpen - 1) * 100`。
- 日界线用交易所消息的 `exchangeAt` 判断，避免本地时区影响；显示时还用当前 UTC 日期门控，确保跨入新日但尚无新 ticker 时立刻隐藏昨日涨跌。
- Coinbase：每个缺失产品调用 Exchange candles，`granularity=3600`，查询 UTC 零点到当前时刻（一天最多约 24 桶），按时间过滤排序后取最早有成交小时的 `open`。无成交小时不会返回 candle，因此该值就是当天首笔成交价。
- Kraken：将当前有精确 Kraken 映射且缺 open 的产品合并到一次 `/0/public/Ticker?...&assetVersion=1`，用精确结果 key 读取官方 UTC 当日开盘 `o`。
- Bitstamp：只在 Bitstamp 成为某产品当前显示来源时，调用精确 market symbol 的 `/api/v2/ohlc/{market}/?step=3600&limit=24&start=...&end=...`，过滤当前 UTC day 后取最早且 `volume > 0` 的 candle.open，避免把无成交填充桶当成日开盘。
- Bitfinex：不发 REST；同一公共 WS 的 `trade:1D:{symbol}` candle snapshot/update 提供 MTS、open 与 volume，只接受 MTS 精确对齐当前 UTC 零点且 `volume > 0` 的数据。
- 日开盘按 `coinbase`、`kraken`、`bitstamp`、`bitfinex` 和 product ID 分别缓存；REST 开盘只为当前实际选中的报价源按需读取，避免四路热备在启动时造成最多几十个历史请求。一个低流动性产品缺数据不能让已完成产品重复请求，同源缺失时显示 `—`，不得跨源拼接。
- UTC 换日会失效旧缓存；失败使用约 2/4/8/16/32/60 秒逐币退避，单次请求 8 秒超时。失败项会重新进入 pending，并由每源轻量 retry timer 在没有后续 quote 的情况下继续尝试；stop、换日和 setProducts 会清 timer/旧请求。

### 4.5 安全边界

- 前端通过 Tauri capability 只能调用四个自定义窗口命令（隐藏、关闭、重申置顶、紧凑布局），不开放通用窗口尺寸权限。
- CSP 仅开放自身资源、Tauri IPC，以及 Coinbase/Kraken/Bitstamp/Bitfinex 实际使用的明确 HTTPS/WSS origin；没有通配域名。Bitfinex 只开放 WSS，不开放其无浏览器 CORS 的 REST origin。
- `freezePrototype` 已开启。
- 不在仓库保存 API Key、GitHub token、证书或私钥；`.gitignore` 已排除 `.env*`（保留示例）、`*.key`、`*.p12`、`*.pfx`。

## 5. 本 thread 已完成的工作

### 5.1 v1.0.0：首版跨平台监视器

- 从空仓库建立 Tauri 2 + 原生静态前端项目。
- 实现 Coinbase/Kraken 公共 WebSocket、REST 兜底、重连与 stale 状态。
- 实现三平台始终置顶、无边框窗口、图标、最小权限和 GitHub Actions 构建矩阵。
- 首版 UI 为 `372 × 188`；用户认为占屏过大，后续设计不得恢复到这一量级。
- 生成并发布 Windows、macOS、Linux 二进制。
- GitHub Release 中文文案曾出现问号乱码，随后已修复为正确 UTF-8。

### 5.2 v1.1.0：紧凑 UI 与 UTC 日涨跌

- 将大界面重构为当时的 `264 × 92` 两行紧凑布局，移除 footer、副标题、厚重视觉效果和高频 quotes live region。
- 将滚动 24h 指标彻底替换为 UTC+0 自然日涨跌，并保证当前价/开盘同源。
- 加入 Coinbase candle 渐进扩窗、Kraken UTC open、跨日失效、请求超时和重试。
- 修复 WebView `fetch` 未绑定、午夜无新报价仍显示昨日涨跌、单资产 REST 失败拖垮另一资产等边界问题。
- 增加到 18 项单元测试。

### 5.3 v1.2.0：系统托盘模式

- 增加原生托盘图标与显示/隐藏/退出菜单。
- Windows/Linux 从任务栏移除，macOS 改为 Accessory app、不占 Dock。
- 关闭、最小化、Alt+F4 均改为隐藏到托盘。
- 修正 README 对 Linux 托盘事件的跨平台表述。

### 5.4 v1.2.1：压缩到 208px

- 用户明确表示只需覆盖 BTC 几十万、ETH 几万，不必考虑更极端的价格后，将窗口从 264px 压到 208px，仍保持 92px 高。
- 重分配 asset/price/change 列，缩减 padding、gap 和标题栏空白。
- 在 Windows 实机边界画面中验证 `999,999.99`、`99,999.99`、`−99.99%` 无裁切或碰撞。

### 5.5 GitHub Release 自动发布与旧版补档

- 根因：早期 workflow 只有 `uploadWorkflowArtifacts: true`，产物只进入 Actions Artifacts，不会自动附到 GitHub Release；后续手动发布又只上传了本地 Windows 包。
- 已在 `.github/workflows/build-desktop.yml` 增加 `release` job：四个平台成功后下载五个 artifact、规范化文件名、创建/更新对应 Release，并使用 `--clobber` 上传。
- 自动 Release 仅在 `push` 且 ref 为新 `vX.Y.Z` 标签时执行；`workflow_dispatch` 只构建 Artifacts，不发布。
- 发布前校验标签必须是严格 `vMAJOR.MINOR.PATCH`，且与 `package.json` 版本一致。
- 已人工补齐 v1.1.0、v1.2.0、v1.2.1 的 Linux/macOS 资产，并验证 digest。

Actions Artifact 目录名固定为：

- `crypto-top-windows-x64-nsis`
- `crypto-top-linux-amd64-appimage`
- `crypto-top-linux-amd64-deb`
- `crypto-top-darwin-aarch64-dmg`
- `crypto-top-darwin-x64-dmg`

最终 Release 文件名固定为：

- `Crypto.Top_<version>_x64-setup.exe`
- `Crypto-Top_<version>_linux-amd64.AppImage`
- `Crypto-Top_<version>_linux-amd64.deb`
- `Crypto-Top_<version>_macos-aarch64.dmg`
- `Crypto-Top_<version>_macos-x64.dmg`

若 Release 已存在，workflow 保留原有标题和正文，只用 `--clobber` 更新同名二进制；只有 Release 不存在时才用 `--generate-notes` 创建。

### 5.6 已完成：移除所有 hover 文本

- 按用户要求删除 HTML `title`、`main.js` 动态 `.title` 和 Rust tray `.tooltip()`；保留按钮纯颜色/背景 hover 反馈。
- 有用的无障碍描述迁移到 `aria-label`，不会产生鼠标悬停文字框。
- 新增 `tests/ui.test.js` 静态回归，禁止上述三类 tooltip 回归。
- 曾基于这组改动生成本机 NSIS：`src-tauri/target/release/bundle/nsis/Crypto Top_1.2.1_x64-setup.exe`，SHA-256 为 `5E6308232551740BADD86C115C79BD82A171BAEDC5C33B9001C5711F69D1E946`。它未发布、未签名，并且在自选功能修改后已经过时，不能再上传。

### 5.7 已完成：紧凑自选币种

- 以标题栏 `+` 替换功能重复的最小化按钮；管理面板临时替换行情区，可按代码/名称搜索 Coinbase 在线真实 USD 产品、添加自选、删除非固定币种。
- BTC/ETH 固定前两项，最多再加 6 项；版本化 localStorage key 为 `crypto-top.watchlist.v1`，损坏/旧 schema/重复/超限/存储异常均安全回退。
- 搜索全集只访问 Coinbase Exchange `/products` 和 `/currencies` 两个免费无密钥端点，首次打开管理页加载一次并缓存；Bitstamp 精确备用映射目录在启动后独立后台加载，失败不会拖住搜索。两类请求均有 8 秒超时；远端文本仅通过 `textContent`/文本节点/属性写入。
- 行情层改为 product-id 动态模型、动态 WS 订阅、缺币 REST、逐币 1h UTC candles、revision 防旧回写和低流动性安全 watchdog；详见 4.3/4.4 与测试。
- 宽度保持 208；普通行情 2/3/4+ 可见行为 92/125/158px，最多显示 4 行后滚动；管理面板最高 170px。搜索/删除不在正常行情行常驻占列宽。
- 价格按数量级自适应 2～8 位小数/极小值科学计数法，解决廉价币固定两位变成 `0.00` 的问题。
- 本地浏览器已实际从免费目录搜索并添加 SOL，看到 `SOL-USD` 实时价及 UTC+0 涨跌，再成功删除；功能已纳入本轮 main 提交，但尚未 tag/release。

### 5.8 已完成：增加 Bitstamp / Bitfinex 免费热备

- 在 Coinbase + Kraken 之外增加 Bitstamp 与 Bitfinex 两条独立、免费、免 API Key 的真实 USD 现货 WebSocket；Coinbase 仍保留 5 秒首选窗口，失效后取最新健康备用成交。
- Bitstamp：内置 BTC/ETH 映射，并通过官方 markets 目录给精确交集内的自选币增加覆盖；目录成功刷新确认下架时才清除旧映射，目录失败保留本地上次验证结果。
- Bitfinex：BTC/ETH 同一连接订阅 trades + `1D` candles，当前价和 UTC+0 开盘都走 WS。REST 缺 CORS，所以不在前端调用，也不为自选币猜 pair。
- Bitfinex 的每个 trades/candles 订阅增加 ACK 完整性检查；错误或 10 秒超时自动重连。免费 REST 批处理统一限制为每来源最多 3 并发，且 REST 不得压过健康的实时 WebSocket 报价。
- `quote` 新增 `marketSource`/`transport` 语义；Coinbase REST 仍归属 Coinbase，所有涨跌只用当前价格自己的 `marketSource` 开盘。
- 标题来源有 3 家以上时压缩为 `CB+N` 类形式，完整来源仍通过 aria-label 提供；没有恢复任何 hover tooltip，窗口宽高不变。
- 2026-08-22 提交前验证：`npm.cmd run check` 58/58、Rust test 2/2、fmt/check/clippy 均通过；原生 debug smoke 内容区仍为 208×92 且实时 Coinbase/UTC 涨跌正常。最终 NSIS 的大小与 SHA-256 见 9.3。代码已按用户要求进入 main，但仍未 tag/release。

## 6. 已确定的重要技术决策及原因

### 6.1 选择 Tauri 2，不使用 Electron/Qt 作为当前实现

- Electron + TypeScript 曾是最初在没有 Rust 工具链时的低门槛候选，但用户允许安装 Rust/Qt 等依赖后，最终选择 Tauri。
- Tauri 原生支持置顶、托盘、任务栏/Dock 策略，使用系统 WebView，安装体积和常驻资源显著小于 Electron，符合“小监视器”定位。
- Qt/PySide 也可跨平台，但会引入更大的运行时/原生打包负担，现有需求没有足够收益支撑迁移。
- 不要无明确收益地重写框架；若未来考虑迁移，应先给出体积、内存、签名/发布和三平台维护成本的实证比较。

### 6.2 Coinbase 短时首选 + Kraken / Bitstamp / Bitfinex 热备

- 四家都有无需密钥的真实 BTC/USD、ETH/USD 公共行情，彼此独立；热连接让切源不需要等故障后再握手。
- Coinbase 活跃且覆盖所有自选，保留 5 秒短时优先；否则从 Kraken、Bitstamp、Bitfinex 取最新健康成交。不是跨所平均价，也不做低流动市场的武断偏差剔除。
- 自选目录仍以 Coinbase 在线 `*-USD` 为全集，确保每个可添加产品至少有 Coinbase WS/REST/candles；Bitstamp 只为官方目录精确交集增加备用，Kraken/Bitfinex 当前仅内置验证过的 BTC/ETH。
- 每个产品分别保存 source symbol；不得根据 Coinbase symbol 拼接其他交易所 pair。目录临时失败时保留已验证缓存，成功且确认不存在时才删除。

### 6.3 不采用的行情替代

以下是 2026-08-11 前后调研和连通性测试的历史快照，API 政策、交易对、流动性和地区限制都可能变化；若重新考虑，必须先查官方当前文档并实测。

- Binance 主流高频对是 BTCUSDT/ETHUSDT，USDT 不等于真实 USD；不得为了刷新速度静默替换。Binance 的严格 BTCUSD/ETHUSD 对流动性明显低、且地区可用性更复杂，因此未作为默认源。
- DIA REST 在这台电脑的直连测试中可达且是真实 USD，但官方刷新约分钟级/约 120 秒，只适合最后兜底，无法满足快速刷新；当前未加入。
- Pyth Hermes SSE 曾可达且较快，但官方无密钥公共端点计划在 2026-08-18 起要求 API Key，不符合长期免费无密钥约束，未加入。
- Crypto.com API 中名为 USD 的 quote 实际是官方从 `USD_Stable_Coin` 改名的 USD Bundle，不符合“真实法币 USD”，未加入。
- Gemini 新公共 WS 可一条连接批量订阅真实 USD，且本机 Tauri Origin 握手成功；但 2026-07 才上线，官方文档与实服 candle timeframe 已出现 `1d`/`1day` 差异，当前先不把这一新协议放入生产热备。
- Coin Metrics Community 无 Key、覆盖广，但属于聚合 USD reference，方法可能用 USDT/USDC 折算，且免费许可限定非商业；不能静默伪装成真实 USD 成交源，本轮未加入。
- CoinGecko/CoinPaprika 免费层刷新约分钟级且有许可/限额，CoinCap v3/Pyth 已要求 Key，DIA 约 120 秒且 symbol 可能歧义；不为凑数量接入。
- 重新采用这些选项前，除核对最新事实外，还需让用户明确接受相应的 `USDT proxy`/聚合价标识、许可、API Key 或慢速兜底取舍。

### 6.4 仅把具备严格 CORS 的交易所 REST 留在 WebView 前端

- Coinbase、Kraken、Bitstamp 的当前使用端点具备 WebView 所需 CORS，继续用前端 `fetch`；曾研究移到 Rust/reqwest，但当前没有必要增加原生网络依赖。
- Bitfinex REST 在 Tauri Origin 实测没有 ACAO，不能假定“公开 API”就能被 WebView fetch。其 UTC open 已改为同一 WSS 的 `1D` candles，运行时目录也不请求 Bitfinex REST。
- `fetch` 构造时必须绑定 `globalThis`，否则 Windows WebView 中会因非法 receiver 失败；该回归已有测试。
- 若以后出现某平台 CORS 或 TLS 差异，优先把 REST 收敛到 Rust command，而不是放宽 CSP 到任意域名。

### 6.5 关闭即隐藏是产品行为

- 托盘模式的核心是后台常驻，故窗口关闭事件必须 `prevent_close()` 后隐藏。
- 真正退出由托盘菜单 `app.exit(0)` 完成；这一调用路径不会触发并卡在 `CloseRequested`。
- 隐藏 WebView 可能被某些系统节流，因此产品承诺应表述为“程序保持运行，恢复后自动继续刷新”，不要保证隐藏期间每一笔行情都持续处理。

### 6.6 自选数量和紧凑高度上限

- 总数 8（BTC/ETH + 6 自选）同时控制 UI 密度、WebSocket subscription 规模和 WebSocket 故障期的免费 REST 请求量。
- 正常视图只显示最多 4 行后内部滚动；管理视图只显示最多 4 个条目后滚动。删除集中到管理面板，避免每个行情行永久增加控件列。
- 前端只传行数/模式/条目数，Rust command 计算高度；这是有意的最小权限边界。不要改成前端可传任意宽高，也不要在 resize 后重新定位窗口。

## 7. 已踩过的坑、失败方案与防回归说明

### 7.1 UI 原型与尺寸方案

- 第一次原型交付没有直接在对话中展示可见图片，用户明确不满；以后效果图必须直接渲染为图片。
- 随后的紧凑效果方案仍被认为太宽，`372 × 188` 和 `264 × 92` 都已被否决；不要把旧截图或旧尺寸当作当前设计目标。

### 7.2 Windows 环境与网络判断

- Windows PowerShell 执行策略会拦截 `npm.ps1`；统一使用 `npm.cmd`。
- 最初 Node HTTPS 报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，使用 Node 的系统 CA 后普通站点正常；不要把 TLS 中间代理问题误判为 API 故障。
- 直接 Node/CLI 连接 Coinbase/Kraken 曾超时，但 Windows Internet Settings 开启了 `127.0.0.1:7890` 系统代理，WebView2 会使用该代理。通过同一代理已真实验证 Coinbase Advanced Trade 和 Kraken v2 WebSocket 握手及行情消息成功。
- 2026-08-21 系统代理仍是启用状态；这属于本机易变配置，不能写死进应用。
- `wss://ws.postman-echo.com/raw` 曾可连而交易所直连不可连，证明当时不是 WebSocket 全局禁用，而是网络路径/代理问题。

### 7.3 已修复的数据与连接 Bug（不要回归）

- Tauri `on_window_event` 给出的是 `Window`，早期辅助函数只接收 `WebviewWindow`，导致 Rust `E0308`；现通过 label 取回 `WebviewWindow` 后调用。
- REST timer 曾是每 5 秒检查、但成功结果要到 12 秒 stale 才再次请求，实际兜底刷新约 15 秒；现逻辑在 WebSocket 不可用时持续每 5 秒轮询。
- BTC/ETH REST 曾用会整体失败的 `Promise.all`；现按当前缺失 product 逐项捕获并保留单项成功，同时统一 abort deadline，避免悬挂/重叠请求。
- transport watchdog 曾只看 heartbeat，可能让无 ticker 的坏订阅永久保持“健康”；随后逐资产 timeout 在引入低流动性自选后又会拖垮整条共享连接。现只让固定 BTC/ETH 做 ticker sentinel，自选币单独 stale。
- UTC open 请求曾无超时，永久 pending 会阻止重试；现使用 AbortController 8 秒超时。
- 跨 UTC 午夜但没有新 quote 时曾继续显示昨日涨跌；现 `getState()` 还以当前 UTC day 门控。
- Coinbase 只查午夜后前 5 分钟、后来扩到约 5 小时，仍不适合任意低流动性币；现改为从 UTC 零点到当前时刻的一小时 candles，最多约 24 桶。
- 动态 UTC open 初版在失败/null 后只写 retryAt，却从 pending 删除且没有 timer，导致没有下一笔 quote 就永不重试；现失败项重新入队并由按源 timer 自动 drain，已有专项测试。
- 不得把 Coinbase catalog 的 symbol 机械拼成 Kraken `${symbol}/USD`；不存在/别名不同的 pair 会造成坏订阅。非固定自选的 `krakenSymbol` 必须为 null，除非未来通过 Kraken 官方目录取得精确映射。
- 同样不得拼 Bitstamp/Bitfinex pair。Bitstamp 只能接受官方 market 目录中 base 精确相等、quote 为 USD、SPOT 且 Enabled 的映射；Bitfinex 存在 `DSH/DASH`、`IOT/IOTA` 和 `tAAVE:USD` 等别名/长格式，当前无浏览器安全目录时只使用内置 BTC/ETH。
- Bitfinex trade/candle 都通过动态 `chanId` 标识；snapshot 可能 newest-first。解析器必须先处理 subscribed 映射、忽略 `[chanId,"hb"]`、按最大 MTS 选最新。`1D` candle 事件不能更新 ticker watchdog 的 lastQuoteAt；ACK/错误是内部控制事件，必须全部确认且不能写入 PriceFeed 报价。
- Bitstamp live trade 当前可能给 `price_str`；只读 `price` 会漏掉真实成交。应继续兼容两者并优先 microtimestamp。
- 公共 REST 可由 curl 打开不代表 WebView 有 CORS。Bitfinex REST 就是反例；不要重新把其 candles/config 加到前端 CSP/fetch，除非先以 Tauri Origin 实测 ACAO 或实现严格白名单的 Rust command。
- macOS 10.15 的旧 WKWebView 不支持较新的 `Object.hasOwn`；现使用 `Object.prototype.hasOwnProperty.call`。在仍声明最低 macOS 10.15 时，不要随意引入未转译的新 JavaScript 语法/API；若必须使用，应加转译或提高最低系统版本。
- Tauri 拖动属性只放父元素时，子文本区域不一定可拖动；当前使用 Tauri 2.11 的 `data-tauri-drag-region="deep"`。

### 7.4 Release 与 GitHub 操作坑

- `uploadWorkflowArtifacts` 不等于上传 GitHub Release；必须有显式 download + `gh release upload` job。
- 新 workflow 不会倒灌到旧标签的历史 run；旧版缺资产只能从旧 run artifact 取回后显式上传，或另写带目标 tag 的维护 workflow。历史缺档已处理完。
- 手动 dispatch 可以选择 tag；release job 必须同时检查 `github.event_name == 'push'`，否则会违背“手动只产 Artifacts”的文档语义。
- `v1.1.0` 起的 Windows Release 文件名是 `Crypto.Top_..._x64-setup.exe`（`Crypto` 后是点），而跨平台文件用 `Crypto-Top_...`（连字符）；`v1.0.0` 的 Windows 文件也是连字符，是历史例外。当前 workflow 故意沿用 v1.1.0 之后的点号形式，以便 `--clobber` 覆盖同名 Windows 资产而不制造重复；不要随手统一名称，除非同时迁移历史 Release。
- 发布失败后应 **重新运行整个 workflow**。只重跑 release job 可能看不到前一 attempt 的全部 artifacts。
- `gh release upload --clobber` 是删除同名资产再上传，不是原子替换；中途失败时应完整重跑恢复。
- GitHub Release 中文曾因 Windows shell/请求编码路径变成问号。后续编辑 Release 应使用 UTF-8 的 notes file 或明确发送 UTF-8 bytes/`charset=utf-8`，上传后再通过 API/页面检查正文。
- 当时直接从 `github.com` 下载某些 GitHub Release helper/Actions artifact 受网络路径阻塞，而带凭证的 GitHub API asset 下载可用。不要输出 `git credential fill` 得到的 token；只在进程内使用。
- 仓库的 HTTPS remote 与 Git Credential Manager 已可用。优先复用现有认证，不要要求用户重新粘贴 token，也不要从其他目录把凭证复制进项目。

## 8. 关键文件索引

| 文件 | 职责 | 修改时注意 |
| --- | --- | --- |
| `README.md` | 用户文档、平台说明、数据源与构建入口 | 需同步 UI 尺寸、托盘语义、发布流程 |
| `package.json` | JS 工具、脚本、应用版本 | Windows 用 `npm.cmd`；发版同步所有版本文件 |
| `src/price-feed.js` | 行情解析、连接、选源、UTC open、REST 兜底 | 数据语义核心，改动必须补测试 |
| `tests/price-feed.test.js` | 36 项行情/容错回归测试 | 覆盖四源解析/订阅、ACK/拒绝/超时、REST 并发上限、跨日、退避、旧请求、安静币和同源计算 |
| `src/watchlist.js` / `tests/watchlist.test.js` | 免费 USD 目录、搜索、持久化、精确备用映射与 16 项测试 | BTC/ETH 固定；任何交易所 custom 映射不得猜测 |
| `src/price-format.js` / `tests/price-format.test.js` | 自适应 USD 数字格式与 3 项测试 | 廉价币不能固定显示 0.00 |
| `tests/ui.test.js` | 3 项紧凑布局/无 hover/CSP 静态回归 | 允许按钮纯视觉 hover，但禁止 title/tooltip 文本弹窗；数据 origin 必须精确 |
| `src/main.js` | UI 状态映射、约 30 FPS 合并渲染、窗口命令 | 保持 reduced-motion 和可访问性行为 |
| `src/index.html` | 208px 动态高度 DOM/template/管理面板 | 标题栏拖动区用 `deep`；quotes 不设高频 aria-live |
| `src/styles.css` | 紧凑布局和视觉 | 208px 已接近当前字体/目标数值的安全下限 |
| `src-tauri/src/lib.rs` | 原生窗口、托盘、退出和置顶 | 处理平台 cfg 与 Linux tray 边界 |
| `src-tauri/build.rs` | 向 Tauri 构建清单声明四个自定义命令 | 新增/删除 command 时与 invoke handler、permission 同步 |
| `src-tauri/tauri.conf.json` | 尺寸、版本、CSP、bundle | 宽度/高度的 width/min/max 必须同步修改 |
| `src-tauri/tauri.*.conf.json` | 平台 bundle 配置 | macOS 当前最低 10.15；Windows NSIS currentUser |
| `src-tauri/capabilities/main.json` | Tauri capability | 维持最小权限 |
| `.github/workflows/build-desktop.yml` | 四平台构建、Artifacts、tag 自动 Release | 资产目录/命名和发布条件不可随意改 |
| `assets/app-icon.svg` / `src-tauri/icons/` | 源图标与生成图标 | 改 SVG 后用 `npm.cmd run icon` 重生并检查各平台 |

`artifacts/` 与 `src-tauri/target/` 都被 `.gitignore` 忽略，里面可能留有本机截图、旧构建和下载缓存；它们不是可信源码或长期发布存档。

## 9. 环境、命令与测试方法

### 9.1 当前 Windows 开发环境（2026-08-21 实测）

- 用户已明确授权助手自行安装 Rust、Qt 或其他完成开发所需的环境；当前 Tauri 工具链已经可用。正常的缺失依赖应先自行排查/安装，不要把常规环境配置步骤直接甩回给用户。
- Node.js `v24.14.1`：`F:\nodejs\node.exe`
- npm `11.11.0`：使用 `npm.cmd`
- Rust/Cargo `1.97.1`：`%USERPROFILE%\.cargo\bin`
- Git `2.55.0.windows.2`
- Visual Studio Build Tools：`C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools`
- 本机没有全局 `gh` CLI；GitHub-hosted runner 自带 `gh`。本机临时维护 Release 时曾通过 GitHub REST API 和 Git Credential Manager 完成，凭证不得落盘或输出。
- 锁文件当前解析到 Tauri `2.11.5`、tauri-build `2.6.3`；CLI devDependency 固定 `2.11.4`。
- `cl.exe` 不一定在普通 PowerShell PATH 中；不要仅凭 `where cl` 失败判断 MSVC 未安装。Tauri/Rust 构建可通过已安装的 Build Tools 环境发现工具链。
- 系统代理当前为 `127.0.0.1:7890`；这是开发机背景，不是项目配置。

### 9.2 安装、开发与检查

在项目根目录：

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run dev
```

Rust 单独检查：

```powershell
Set-Location src-tauri
cargo fmt --all -- --check
cargo test --locked
cargo check --locked
cargo clippy --locked --all-targets -- -D warnings
```

提交前至少执行：

```powershell
npm.cmd run check
Set-Location src-tauri
cargo fmt --all -- --check
cargo test --locked
cargo check --locked
cargo clippy --locked --all-targets -- -D warnings
Set-Location ..
git diff --check
git status --short
```

### 9.3 Windows 构建

```powershell
npm.cmd run build:windows
```

NSIS 输出：`src-tauri/target/release/bundle/nsis/`。2026-08-22 当前自选 + 四路行情热备源码成功构建 `Crypto Top_1.2.1_x64-setup.exe`，大小 `1,140,641` bytes，SHA-256 `8B612C14996026B6A8DED7DCD80D319BFA941DDEDFFFA3BBB6ABE76F3377F040`，未签名。它只是本地开发验证包，虽然代码已进入 main，但安装包未发布；正式发布必须先决定并同步新版本号后重新构建，不能上传这个临时同版本包覆盖线上 1.2.1。

macOS/Linux bundle 应由目标系统或 GitHub Actions 构建，不要在 Windows 上伪造。

### 9.4 新版本发布流程

1. 完成业务修改并通过测试/平台相关审查。
2. 同步修改 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 本包版本和 `src-tauri/tauri.conf.json`。
3. 生成并验证 Windows 本地包（若环境允许），提交代码并推送 `main`。
4. 创建严格 semver 标签，例如 `v1.2.2`，并推送标签。
5. `.github/workflows/build-desktop.yml` 会构建：
   - Windows x64 NSIS
   - Linux x64 AppImage
   - Linux x64 deb
   - macOS Apple Silicon dmg
   - macOS Intel dmg
6. build matrix 全部成功后，release job 自动创建/更新同标签 Release 并上传五个文件。
7. 检查 Release 页面：五个资产、中文文案、文件大小/digest、下载链接均正确。必要时在真实 macOS/Linux 上做运行 smoke test。

手动 `workflow_dispatch` 只生成 Actions Artifacts，不会创建 Release。若自动发布失败，完整重跑全部 jobs。

## 10. 当前未解决事项与下一步优先级

### P0 / P1

- **P0：当前线上 `v1.2.1` Release 仍不含自选币种与四路免费行情热备。** 功能代码已按用户要求提交到 main，全套检查、原生紧凑窗口 smoke test 和临时 NSIS 构建均已通过；正式发布时必须升级版本并重新构建五个平台资产，不要移动或覆盖旧 `v1.2.1` 标签。
- **无已知阻塞性业务 Bug。** 本地实现 58 项 Node 测试、2 项 Rust 测试和 release build 通过。
- **P1：新的自动 Release job 尚未被一个新标签端到端实跑。** `0a9017b` 晚于 `v1.2.1`，现有 tag runs 都使用旧 workflow；下个版本是首次生产验证，必须确认五个 artifact 均被下载、Release 正常创建、没有重名/漏传且 digest 正确。

### P2（发布质量/跨平台验证）

- **代码签名尚未配置。** Windows 可能触发 SmartScreen，macOS 可能触发 Gatekeeper。正式广泛分发前需要 Windows 代码签名和 Apple Developer ID/notarization，并安全配置 CI secrets。
- **macOS/Linux 目前主要由 CI 证明可构建，不等于完整运行验收。** 大改托盘、窗口策略、字体或行情网络后，应在真实 macOS（Intel/Apple Silicon）和至少一个主流 Linux 桌面/Wayland 环境做 smoke test。
- **发布版本校验只自动比对 tag 与 `package.json`。** 可加固 workflow，让它同时读取 `src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json`，防止安装包内部版本与标签不一致。

### P3（文档/体验改进，未经用户要求不要擅自扩张范围）

- v1.1.0～v1.2.1 的 Release 正文仍以 Windows 下载说明为主，虽然资产已补齐三平台；v1.2.0/v1.2.1 正文还写了带空格的 Windows 文件名，而真实资产使用点号。可在下次整理 Release 文案时补充完整下载表并纠正名称。
- 新 workflow 默认用 GitHub `--generate-notes`，不会自动生成中文下载表或把 SHA-256 写进正文（哈希目前只打印在 job log）。若用户要求统一中文 Release 模板，需要另行增强并做 UTF-8 页面复核。
- 自选币现在可在 Bitstamp 官方目录精确交集内获得第二来源；Kraken/Bitfinex 自选覆盖仍未扩展。若未来增加，必须使用具备 WebView CORS 的官方 instrument/catalog，或严格白名单的 Rust 后端映射并补测试，不能重新启用字符串猜测。
- Linux tray 是否可见以及左/右键行为依赖桌面环境的 StatusNotifier/AppIndicator 支持；不能仅靠代码彻底消除这一平台差异。
- 没有自动更新器、开机自启或价格告警；用户没有提出这些需求，不应自行加入。

## 11. 接手时的建议顺序

1. 运行 `git status --short --branch`，确认用户是否已有未提交改动；不要覆盖用户工作。
2. 读 `README.md`、`src/price-feed.js`、`src-tauri/src/lib.rs` 和本文件相关章节。
3. 根据任务只打开必要的测试/配置；不要从历史 `artifacts/` 反推当前源码。
4. 修改行情语义时先补/改 `tests/price-feed.test.js`；修改窗口尺寸时同时改 `tauri.conf.json` 的 width/min/max、CSS 宽度预算和 README。
5. UI 方向变化先给用户真实图片原型；实现后用最终 Tauri 窗口截图验证，而不是只依赖浏览器最小 viewport。
6. 发布前重新核对当前 GitHub/工具链状态，不要把本文件中的日期快照当成永久事实。
