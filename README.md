# Crypto Top

一个轻量、始终置顶的加密货币美元实时价格监视器。默认显示 BTC / ETH，并支持添加自选币种；可运行于 Windows、macOS 和 Linux。

## 功能

- **自选币种**：默认固定 BTC / ETH，可搜索并添加最多 6 个 Coinbase 在线 `*-USD` 现货币种；自选顺序会保存在本机，随时可以删除后重新添加。
- **真实 USD 行情**：搜索结果和价格都严格使用美元交易对，不会把 USDT 或 USDC 静默当成美元。
- **UTC 自然日涨跌**：涨跌幅严格以当天 `00:00 UTC` 后的首笔同交易所成交价为基准，不使用滚动 24 小时数据。
- **WebSocket 实时推送**：成交发生后立即更新，不使用慢速轮询。
- **四路免费热备**：Coinbase、Kraken、Bitstamp、Bitfinex 的公共行情都不需要 API Key；四条实时连接彼此独立，单家交易所故障不会中断其他来源。
- **超紧凑界面**：宽度始终为 `208px`，默认两行时仅 `208 × 92`；最多同时展示四行并在内部滚动，窗口最高 `170px`。添加/删除面板只在点击 `+` 时临时替换行情区。
- **自动恢复**：心跳监测、超时切源、带抖动的指数退避重连；若 WebSocket 被网络拦截，会启用免费的 HTTPS 最新价兜底。
- **始终置顶**：启动、窗口重新获得焦点、系统唤醒和运行期间都会重新确认置顶状态。
- **系统托盘运行**：Windows、Linux 不占任务栏；macOS 不占 Dock。Windows、macOS 可左键托盘图标恢复窗口；所有平台都可通过托盘菜单显示、隐藏或彻底退出。
- **三平台打包**：Tauri 2 使用系统 WebView，常驻内存和安装体积明显小于 Electron。

## 在 Windows 上运行

需要 Node.js 20+、Rust stable MSVC 工具链、Microsoft C++ Build Tools 和 WebView2。Windows 10 1803 及以上通常已经自带 WebView2。

```powershell
npm.cmd install
npm.cmd test
npm.cmd run dev
```

构建当前 Windows 用户可安装的 `.exe`：

```powershell
npm.cmd run build:windows
```

输出位于 `src-tauri/target/release/bundle/nsis/`。

窗口标题栏的 `+` 用于搜索、添加或删除自选币种；右侧关闭按钮只把监视器隐藏到系统托盘，程序仍保持运行，恢复窗口后会自动继续刷新行情。需要完全退出时，右键单击托盘图标并选择“退出 Crypto Top”。Windows 可能会根据系统设置把新托盘图标放进 `^` 隐藏图标区域。

## macOS / Linux

源代码完全共用，但安装包必须在目标系统上构建。仓库内的 `.github/workflows/build-desktop.yml` 可以生成：

- Windows x64：NSIS `.exe`
- macOS：Apple Silicon 和 Intel `.dmg`
- Linux x64：`.AppImage` 和 `.deb`

推送与 `package.json` 版本一致的 `vMAJOR.MINOR.PATCH` 标签后，工作流会在四个平台构建完成后自动创建或更新对应的 GitHub Release，并把上述安装包全部附加到 Release。手动运行工作流时只保留 Actions Artifacts，不会创建 Release；若自动发布步骤失败，应重新运行全部工作，而不是只重跑发布任务。

也可以在对应平台安装 [Tauri 官方前置依赖](https://v2.tauri.app/start/prerequisites/) 后运行 `npm run build`。

## 行情来源

- [Coinbase Advanced Trade WebSocket](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview)：`wss://advanced-trade-ws.coinbase.com`
- [Coinbase Exchange Products](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-all-known-trading-pairs)：提供无需密钥的在线美元币种目录；程序只在首次打开管理面板时加载并在本次运行中缓存。
- [Kraken WebSocket v2](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker)：`wss://ws.kraken.com/v2`
- [Bitstamp WebSocket v2](https://www.bitstamp.net/websocket/v2/)：`wss://ws.bitstamp.net`，订阅真实 USD 现货成交。
- [Bitstamp Markets / OHLC](https://www.bitstamp.net/api/)：后台读取官方启用中的 USD 现货目录，为自选币建立精确映射；从 UTC 零点后的最早小时 K 线取得同源开盘价。
- [Bitfinex Public Trades](https://docs.bitfinex.com/reference/ws-public-trades)：`wss://api-pub.bitfinex.com/ws/2`，为 BTC / ETH 提供真实 USD 成交热备。
- [Bitfinex Public Candles](https://docs.bitfinex.com/reference/ws-public-candles)：在同一条 WebSocket 上订阅 `1D` UTC 日 K，不依赖其缺少浏览器 CORS 的 REST 接口。
- [Coinbase Exchange Candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)：从当天 UTC 零点到当前时间查询一小时 K 线，并取当日最早成交的开盘价。
- [Kraken Ticker](https://docs.kraken.com/api-reference/market-data/get-ticker-information)：字段 `o` 是 Kraken 官方定义的 UTC 当日开盘价。

Coinbase WebSocket 会按当前自选列表订阅全部币种；Kraken 与 Bitfinex 为内置且已验证的 BTC / ETH 交易对提供备用，Bitstamp 还会通过官方市场目录为能够精确匹配的自选币增加覆盖。程序不会通过拼接币种代码猜交易对，也不会将 USDT / USDC 当成 USD。Bitfinex 的公开 REST 目录缺少 WebView 所需的 CORS，因此不会用它猜测或扩展自选币映射。

Coinbase 在 5 秒内有新价格时优先显示；主源不够新鲜时，先从其余实时 WebSocket 选择最新的健康成交，仅在所有实时源均失效时使用 Coinbase HTTPS 兜底。某个低流动币缺少新成交只会让该币种变为延迟或启用兜底，不会拖累承载其他币种的共享连接；Bitfinex 的成交与 UTC 日线订阅必须全部确认，拒绝或超时会自动退避重连。UTC 开盘价只为当前实际显示的来源按需加载，单一免费 REST 来源每批最多并发 3 个请求，避免启动或故障时突发打满接口。

涨跌幅始终和当前显示价格使用同一交易所的日开盘价，避免跨交易所混算。程序根据交易所消息时间识别 UTC 换日；跨日后昨日基准立即失效，新基准加载完成前显示 `—`。

以上来源均按其公开接口与当前使用条款接入；如果将行情用于商业化产品或再分发，应另外复核各数据提供方届时的许可要求。

## 平台边界

“始终置顶”适用于正常桌面会话。操作系统安全桌面（例如 Windows UAC）、锁屏、独占全屏应用，以及部分 Linux Wayland 合成器可以覆盖或限制普通应用窗口；应用无法绕过这些系统安全边界。Linux 托盘图标依赖桌面环境提供 StatusNotifier/AppIndicator 支持，部分精简 Wayland 环境可能需要对应扩展。未签名的测试安装包也可能触发 Windows SmartScreen 或 macOS Gatekeeper 提示，正式分发时应配置代码签名。

## 开发文档

新的开发 Thread 请从 [`AGENTS.md`](AGENTS.md) 和 [`docs/INDEX.md`](docs/INDEX.md) 开始；当前状态与下一步见 [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md)。这些文件是持久化开发上下文，README 继续只承担用户使用说明。
