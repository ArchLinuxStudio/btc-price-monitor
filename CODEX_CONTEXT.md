# Crypto Top 项目交接上下文

> 作用：供完全没有读过历史 thread 的新 Codex 实例接手本项目。先读本文件，再按文中路径核对代码。
>
> 最近核对：2026-08-21（Asia/Shanghai）。本文件记录的是这一时点的已验证状态；网络、GitHub Release 和工具版本等易变化信息在执行发布前仍应重新确认。

## 1. 项目目标

Crypto Top 是一个极小型桌面行情监视器，持续显示 BTC 和 ETH 的真实美元成交价及 UTC 自然日涨跌，目标平台为 Windows、macOS 和 Linux。

核心产品目标：

- 使用免费、无需 API Key 的公开行情源。
- 用 WebSocket 尽可能快地刷新 BTC-USD、ETH-USD 成交价。
- 严格显示真实 USD；不得把 USDT 静默标成 USD。
- 涨跌幅以 UTC+0 当天 `00:00` 后的首笔同交易所成交价为基准，不得使用滚动 24 小时涨跌冒充。
- 窗口始终置顶、极度紧凑、低干扰，并可常驻系统托盘。
- Windows/Linux 不占任务栏，macOS 不占 Dock；从托盘恢复或彻底退出。
- 一套源码支持三平台，并在 GitHub Release 提供各平台可安装二进制。

产品当前名称为 **Crypto Top**，仓库为 [ArchLinuxStudio/btc-price-monitor](https://github.com/ArchLinuxStudio/btc-price-monitor)，Tauri identifier 为 `com.cryptotop.monitor`。

## 2. 用户已经明确的需求、偏好与已接受约束

本节既包含用户的明确原话，也包含用户看过、接受并已发布的产品行为；不要在后续 thread 中重复询问或无故回退，除非用户主动改变要求。具体可访问性细节属于当前实现约束，列在架构章节，不冒充用户逐项提出的原话。

### 2.1 行情语义

- 只显示 BTC、ETH 的美元计价价格。
- 优先速度和实时性，应使用公开 WebSocket 推送；REST 只能做当前价兜底或低频取得 UTC 日开盘。
- API 必须免费且不需要用户提供密钥。
- USD 必须是真实 USD。禁止把 `BTCUSDT` / `ETHUSDT` 无提示地显示为美元。
- 涨跌幅基准被用户明确规定为 **UTC+0 自然日**，即当天 `00:00 UTC` 后的首笔同源成交价；禁止恢复成 `24H` 滚动涨跌。
- 当前显示价和日开盘必须来自同一家交易所，禁止用 Coinbase 当前价与 Kraken 开盘价交叉计算。

### 2.2 界面与交互

- 用户反复强调“紧凑”，不接受为极端价格留下大块空白。
- 用户的原意是 BTC 只需覆盖“几十万”、ETH 只需覆盖“几万”，不必为不现实的极端价格留宽；当前认可的窗口是固定 `208 × 92` 逻辑像素。
- 当前实现进一步实测可完整显示 BTC `999,999.99`、ETH `99,999.99` 和涨跌 `−99.99%`；这些是已验证实现边界，不是用户逐字规定的三个精确数值。
- 风格应现代、紧凑、有高级感、不老土，并尽量消除无意义留白。
- 保留 BTC/ETH 两行、数据源/连接状态、`Δ UTC+0` 和窗口控制。
- 若以后先给 UI 方案或原型，用户希望直接看到真实图片/效果图，不要只给文本线框或口头描述。

### 2.3 窗口与托盘

- 程序启动后不应占 Windows/Linux 任务栏区域，也不应占 macOS Dock。
- 必须有托盘图标；右键菜单至少提供“显示窗口”“隐藏窗口”“退出 Crypto Top”。
- 当前产品默认仍显示浮动监视窗口，同时只在系统托盘保留图标、不产生任务栏/Dock 项；不要把“只在小图标区域显示”误改成默认静默隐藏主窗口。
- 顶部最小化、关闭按钮和系统关闭请求（如 Alt+F4）都只隐藏窗口，不退出进程。
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
- 当前 HEAD：`0a9017b9dfd5056a085b7d91a7e83760129f9334`，提交信息 `ci: publish all desktop bundles to releases`
- 2026-08-21 核对时 `main` 与 `origin/main` 一致，工作区在创建本文件前是干净的。
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

2026-08-21 在当前 Windows 环境重新执行并通过：

- `npm.cmd run check`：语法检查及 Node 测试 **18/18 通过**。
- `cargo check --locked`：通过。
- `cargo clippy --locked -- -D warnings`：通过，无 warning。
- 远端 `main` commit 与本地一致。

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
Coinbase Advanced Trade WS ─┐
                            ├─ PriceFeed 选源/过期/重连 ─┐
Kraken WebSocket v2 ────────┘                            │
                                                         ├─ main.js 30 FPS 合并渲染 ─ UI
Coinbase Exchange REST（最新价兜底）──────────────────────┤
Coinbase/Kraken REST（UTC 日开盘，按源缓存）──────────────┘

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

- 主窗口固定 `208 × 92`、无系统装饰、不可缩放、默认置顶、初次放在主屏幕工作区右上方并留 16 逻辑像素级边距。
- Windows/Linux 使用 `skipTaskbar`；macOS 使用 `ActivationPolicy::Accessory` 隐藏 Dock 图标。
- 聚焦、系统恢复及前端每 10 秒都会重新确认 always-on-top；macOS/Linux还会重申全工作区可见。
- `CloseRequested` 被拦截并改为隐藏；托盘 `quit` 使用 `app.exit(0)`，不会被窗口关闭拦截逻辑阻止。
- Windows/macOS 左键托盘图标可恢复；所有平台菜单可显示/隐藏/退出。Tauri 在 Linux 不发送 `TrayIconEvent`，所以 Linux 不得依赖左键恢复，菜单才是可靠入口。

### 4.2 静态前端/UI

关键文件：

- `src/index.html`：两行行情 DOM、状态区、拖动区和两个隐藏到托盘按钮。
- `src/styles.css`：208×92 布局预算、颜色、字体、焦点态与 reduced-motion。
- `src/main.js`：订阅 PriceFeed、将高频更新合并到约 30 FPS、价格格式化、涨跌/过期状态和 Tauri 命令调用。

当前宽度预算（修改 UI 时必须一起考虑）：

- 标题栏：内容区 + 两个 `24px` 控件，总控件宽 `48px`。
- 每个行情行：`32px minmax(0,1fr) 48px`，列间距 `4px`，左右 padding 各 `6px`。
- 208px 窗口扣除边框后，价格列约 `106px`；这正是当前目标价格范围的紧凑安全下限附近。
- `data-tauri-drag-region="deep"` 用于确保标题栏子元素区域也可拖动；不要退回只标父容器的旧写法。
- 当前视觉实现有意去掉厚重渐变、大面积紫色光晕、价格文字强光和肥厚胶囊；这些是已接受的设计方向，不是用户逐项口述的禁令。
- 高频 prices 区域不使用 `aria-live`，只有连接状态是 live region；动画尊重 `prefers-reduced-motion`，涨跌使用 `+` / `−` 且不只依靠颜色。除非有明确理由，不要回退这些可访问性处理。

### 4.3 行情与容错

全部逻辑位于 `src/price-feed.js`，单元测试位于 `tests/price-feed.test.js`。

实时源会同时连接：

1. Coinbase Advanced Trade：`wss://advanced-trade-ws.coinbase.com`
   - 订阅 `ticker` 的 `BTC-USD`、`ETH-USD`，另订阅 `heartbeats`。
   - 公共频道，无 API Key。
2. Kraken WebSocket v2：`wss://ws.kraken.com/v2`
   - 订阅 `ticker`，symbol 为 `BTC/USD`、`ETH/USD`，`event_trigger: "trades"`，请求 snapshot。
   - 公共频道，无 API Key；watchdog 还会发送应用层 ping。

选源规则：

- Coinbase 报价在 5 秒内时优先。
- 否则选择 12 秒内最新的可用源。
- 都过期时保留最新末次价格，但打上 stale 状态。
- 连接有 12 秒握手超时、10 秒消息空闲检查、20 秒逐资产 ticker 超时，并用带 jitter 的指数退避重连（约 0.5 秒起，最多 30 秒）。心跳消息只能证明传输连接存活；代码另行跟踪有效 ticker，避免订阅丢失后被心跳永久掩盖。

HTTPS 当前价兜底：

- 端点为 Coinbase Exchange 的 `/products/BTC-USD/ticker` 和 `/products/ETH-USD/ticker`。
- 只要 BTC/ETH 中任一资产没有可用的新鲜 WebSocket 行情，就立即同时请求两项，之后每 5 秒检查。
- 单轮总超时 8 秒；BTC/ETH 分别捕获错误，一个失败不能丢掉另一个成功结果。
- REST 报价标记为 `Coinbase REST`，UTC 日开盘仍归到 Coinbase 源，不能凭空使用 24h 字段。

### 4.4 UTC+0 自然日涨跌

这是业务语义核心，修改前应先读相关测试。

- 公式：`(current / dayOpen - 1) * 100`。
- 日界线用交易所消息的 `exchangeAt` 判断，避免本地时区影响；显示时还用当前 UTC 日期门控，确保跨入新日但尚无新 ticker 时立刻隐藏昨日涨跌。
- Coinbase：调用 Exchange candles，`granularity=60`；从 UTC 零点开始先查 5 分钟，无成交时扩到 30 分钟，再扩到约 300 分钟，并取最早有效 candle 的 `open`。Coinbase 官方可能不返回无成交区间，也可能返回 start 之前的 candle，所以必须按时间过滤、排序，不能盲取数组第一项。
- Kraken：调用 `/0/public/Ticker?pair=xbtusd,ethusd&assetVersion=1`，使用官方定义为 UTC 当日开盘的 `o`；解析同时兼容 `BTC/USD` 和旧式 `XXBTZUSD` / `XETHZUSD` 结果 key。
- 日开盘按 `coinbase`、`kraken` 分开缓存；同源数据缺失时显示 `—`，不得跨源拼接。
- UTC 换日会失效旧缓存；若新日报价发生在 `00:00:02 UTC` 前，则等到约第 2 秒再请求，此后收到的新日报价会立即请求。失败使用约 2/4/8/16/32/60 秒退避，单次请求 8 秒超时。

### 4.5 安全边界

- 前端通过 Tauri capability 只能调用三个自定义窗口命令。
- CSP 仅开放自身资源、Tauri IPC、Coinbase/Kraken 的明确 HTTPS 与 WSS 域名；新增数据源时必须同步评估并更新 `connect-src`。
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

## 6. 已确定的重要技术决策及原因

### 6.1 选择 Tauri 2，不使用 Electron/Qt 作为当前实现

- Electron + TypeScript 曾是最初在没有 Rust 工具链时的低门槛候选，但用户允许安装 Rust/Qt 等依赖后，最终选择 Tauri。
- Tauri 原生支持置顶、托盘、任务栏/Dock 策略，使用系统 WebView，安装体积和常驻资源显著小于 Electron，符合“小监视器”定位。
- Qt/PySide 也可跨平台，但会引入更大的运行时/原生打包负担，现有需求没有足够收益支撑迁移。
- 不要无明确收益地重写框架；若未来考虑迁移，应先给出体积、内存、签名/发布和三平台维护成本的实证比较。

### 6.2 Coinbase 主源 + Kraken 备用

- 两者都有无需密钥的真实 BTC/USD、ETH/USD 公共行情。
- Coinbase 活跃、ticker 实时，作为短时间优先源；Kraken 提供独立真实 USD 备用和官方明确的 UTC 当日开盘字段。
- 两条连接同时维护，切源不需要等待故障后才建立连接。

### 6.3 不采用的行情替代

以下是 2026-08-11 前后调研和连通性测试的历史快照，API 政策、交易对、流动性和地区限制都可能变化；若重新考虑，必须先查官方当前文档并实测。

- Binance 主流高频对是 BTCUSDT/ETHUSDT，USDT 不等于真实 USD；不得为了刷新速度静默替换。Binance 的严格 BTCUSD/ETHUSD 对流动性明显低、且地区可用性更复杂，因此未作为默认源。
- DIA REST 在这台电脑的直连测试中可达且是真实 USD，但官方刷新约分钟级/约 120 秒，只适合最后兜底，无法满足快速刷新；当前未加入。
- Pyth Hermes SSE 曾可达且较快，但官方无密钥公共端点计划在 2026-08-18 起要求 API Key，不符合长期免费无密钥约束，未加入。
- 重新采用这些选项前，除核对最新事实外，还需让用户明确接受相应的 `USDT proxy` 标识、API Key 或慢速兜底取舍。

### 6.4 交易所 REST 留在 WebView 前端

- 曾研究把 UTC-open REST 移到 Rust/reqwest 以完全规避 CORS；当前实际实现仍使用前端 `fetch`，并已在 Tauri WebView 实测成功。
- `fetch` 构造时必须绑定 `globalThis`，否则 Windows WebView 中会因非法 receiver 失败；该回归已有测试。
- 若以后出现某平台 CORS 或 TLS 差异，优先把 REST 收敛到 Rust command，而不是放宽 CSP 到任意域名。

### 6.5 关闭即隐藏是产品行为

- 托盘模式的核心是后台常驻，故窗口关闭事件必须 `prevent_close()` 后隐藏。
- 真正退出由托盘菜单 `app.exit(0)` 完成；这一调用路径不会触发并卡在 `CloseRequested`。
- 隐藏 WebView 可能被某些系统节流，因此产品承诺应表述为“程序保持运行，恢复后自动继续刷新”，不要保证隐藏期间每一笔行情都持续处理。

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
- BTC/ETH REST 曾用会整体失败的 `Promise.all`；现逐资产捕获并保留单项成功，同时统一 abort deadline，避免悬挂/重叠请求。
- transport watchdog 曾只看 heartbeat，可能让无 ticker 的坏订阅永久保持“健康”；现同时跟踪逐资产有效 quote timeout。
- UTC open 请求曾无超时，永久 pending 会阻止重试；现使用 AbortController 8 秒超时。
- 跨 UTC 午夜但没有新 quote 时曾继续显示昨日涨跌；现 `getState()` 还以当前 UTC day 门控。
- Coinbase 只查午夜后前 5 分钟时，若该段无 candle 会全天显示 `—`；现渐进扩窗到 30/约 300 分钟。
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
| `tests/price-feed.test.js` | 18 项行情/容错回归测试 | 优先覆盖跨日、超时、单资产失败和同源计算 |
| `src/main.js` | UI 状态映射、约 30 FPS 合并渲染、窗口命令 | 保持 reduced-motion 和可访问性行为 |
| `src/index.html` | 208×92 DOM | 标题栏拖动区用 `deep`；quotes 不设高频 aria-live |
| `src/styles.css` | 紧凑布局和视觉 | 208px 已接近当前字体/目标数值的安全下限 |
| `src-tauri/src/lib.rs` | 原生窗口、托盘、退出和置顶 | 处理平台 cfg 与 Linux tray 边界 |
| `src-tauri/build.rs` | 向 Tauri 构建清单声明三个自定义命令 | 新增/删除 command 时与 invoke handler、permission 同步 |
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
cargo check --locked
cargo clippy --locked -- -D warnings
```

提交前至少执行：

```powershell
npm.cmd run check
Set-Location src-tauri
cargo check --locked
cargo clippy --locked -- -D warnings
Set-Location ..
git diff --check
git status --short
```

### 9.3 Windows 构建

```powershell
npm.cmd run build:windows
```

NSIS 输出：`src-tauri/target/release/bundle/nsis/`。当前本机仍有历史 `Crypto Top_1.2.1_x64-setup.exe`，其 Release SHA-256 为 `3440C2D8B3F132E06CC8C1EB6E910A248E952726C87255BD4684D9ED7B8130A1`；任何业务代码/版本变化后都必须重新构建，不能继续上传旧文件。

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

- **无已知阻塞性业务 Bug。** 当前 `1.2.1` 已发布，测试与静态检查通过。
- **P1：新的自动 Release job 尚未被一个新标签端到端实跑。** `0a9017b` 晚于 `v1.2.1`，现有 tag runs 都使用旧 workflow；下个版本是首次生产验证，必须确认五个 artifact 均被下载、Release 正常创建、没有重名/漏传且 digest 正确。

### P2（发布质量/跨平台验证）

- **代码签名尚未配置。** Windows 可能触发 SmartScreen，macOS 可能触发 Gatekeeper。正式广泛分发前需要 Windows 代码签名和 Apple Developer ID/notarization，并安全配置 CI secrets。
- **macOS/Linux 目前主要由 CI 证明可构建，不等于完整运行验收。** 大改托盘、窗口策略、字体或行情网络后，应在真实 macOS（Intel/Apple Silicon）和至少一个主流 Linux 桌面/Wayland 环境做 smoke test。
- **发布版本校验只自动比对 tag 与 `package.json`。** 可加固 workflow，让它同时读取 `src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json`，防止安装包内部版本与标签不一致。

### P3（文档/体验改进，未经用户要求不要擅自扩张范围）

- v1.1.0～v1.2.1 的 Release 正文仍以 Windows 下载说明为主，虽然资产已补齐三平台；v1.2.0/v1.2.1 正文还写了带空格的 Windows 文件名，而真实资产使用点号。可在下次整理 Release 文案时补充完整下载表并纠正名称。
- 新 workflow 默认用 GitHub `--generate-notes`，不会自动生成中文下载表或把 SHA-256 写进正文（哈希目前只打印在 job log）。若用户要求统一中文 Release 模板，需要另行增强并做 UTF-8 页面复核。
- 标题栏最小化与关闭按钮当前都执行“隐藏到托盘”，功能重复；这是用户已接受版本的一部分。若进一步压宽可提议删除一个，但要先给实际效果图并获得用户认可。
- Linux tray 是否可见以及左/右键行为依赖桌面环境的 StatusNotifier/AppIndicator 支持；不能仅靠代码彻底消除这一平台差异。
- 没有自动更新器、开机自启或价格告警；用户没有提出这些需求，不应自行加入。

## 11. 接手时的建议顺序

1. 运行 `git status --short --branch`，确认用户是否已有未提交改动；不要覆盖用户工作。
2. 读 `README.md`、`src/price-feed.js`、`src-tauri/src/lib.rs` 和本文件相关章节。
3. 根据任务只打开必要的测试/配置；不要从历史 `artifacts/` 反推当前源码。
4. 修改行情语义时先补/改 `tests/price-feed.test.js`；修改窗口尺寸时同时改 `tauri.conf.json` 的 width/min/max、CSS 宽度预算和 README。
5. UI 方向变化先给用户真实图片原型；实现后用最终 Tauri 窗口截图验证，而不是只依赖浏览器最小 viewport。
6. 发布前重新核对当前 GitHub/工具链状态，不要把本文件中的日期快照当成永久事实。
