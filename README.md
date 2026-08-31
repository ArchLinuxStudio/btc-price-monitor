# Crypto Top

一个轻量、始终置顶的跨市场实时行情监视器。默认显示 BTC / ETH 真实美元现货，并支持添加加密货币 USD 现货或清楚标注的股票相关 USDT 永续合约；可运行于 Windows、macOS 和 Linux。

## 功能

- **动态自选目录**：默认固定 BTC / ETH，可搜索并添加最多 6 个 Coinbase 在线 `*-USD` 现货，或 Bybit / Gate 官方目录中的股票相关 USDT 永续；自选顺序与精确交易所代码保存在本机。
- **品类清楚隔离**：加密现货仍严格使用真实 USD，不会把 USDT / USDC 静默当成美元；股票相关合约显示为 `.P` 与 `USDT永续`，不是直接持有美股。
- **UTC 自然日涨跌**：涨跌幅严格以当天 `00:00 UTC` 后的首笔同交易所成交价为基准，不使用滚动 24 小时数据。
- **WebSocket 实时推送**：成交发生后立即更新，不使用慢速轮询。
- **六路免费分品类行情**：Coinbase、Kraken、Bitstamp、Bitfinex 服务 USD 现货，Bybit、Gate 服务股票相关 USDT 永续；全部使用无需用户 API Key 的公共行情，并只订阅官方目录验证过的精确代码。
- **超紧凑界面**：宽度始终为 `208px`，默认两行时仅 `208 × 92`；四行以上默认在内部滚动，也可拖动底部把行情区增高到最多完整显示 8 行（`290px`）。添加/删除面板只在点击 `+` 时临时替换行情区，并继续封顶 `170px`。
- **自动恢复**：心跳监测、超时切源、带抖动的指数退避重连；若 WebSocket 被网络拦截，会启用免费的 HTTPS 最新价兜底。
- **始终置顶**：启动、窗口重新获得焦点、系统唤醒和运行期间都会重新确认置顶状态。
- **系统托盘运行**：Windows、Linux 不占任务栏；macOS 不占 Dock。Windows、macOS 可左键托盘图标恢复窗口；所有平台都可通过托盘菜单显示、隐藏、查看“关于”信息或彻底退出。
- **三平台打包**：Tauri 2 使用系统 WebView，常驻内存和安装体积明显小于 Electron。

## 在 Windows 上运行

需要 Node.js 20+、Rust stable MSVC 工具链、Microsoft C++ Build Tools 和 WebView2。Windows 10 1803 及以上通常已经自带 WebView2。

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run dev
```

前端源码使用严格 TypeScript，开发命令会自动编译为浏览器原生 ES 模块；项目不使用前端框架或打包器，生成的 `dist/` 不提交到 Git。

构建当前 Windows 用户可安装的 `.exe`：

```powershell
npm.cmd run build:windows
```

输出位于 `src-tauri/target/release/bundle/nsis/`。

窗口标题栏的 `+` 用于搜索、添加或删除自选品种；例如搜索 `MU` 可在交易所当前上架时添加 `MU.P`。右侧关闭按钮只把监视器隐藏到系统托盘，程序仍保持运行，恢复窗口后会自动继续刷新行情。右键单击托盘图标并选择“关于 Crypto Top”可查看当前版本、应用图标和简要 GPL 许可信息；点击 GitHub 图标会使用系统默认浏览器打开项目仓库。选择“退出 Crypto Top”才会完全退出。Windows 可能会根据系统设置把新托盘图标放进 `^` 隐藏图标区域。

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
- [Bybit V5 Instruments](https://bybit-exchange.github.io/docs/v5/market/instrument)：动态读取 `stock + US + LinearPerpetual + Trading + USDT` 合约，使用官方 `underlyingTicker`、名称和精确交易代码。
- [Bybit Public Ticker WebSocket](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker)：`wss://stream.bybit.com/v5/public/linear`；HTTPS ticker 与 `D` 日 K 在 WebSocket 失效和 UTC 开盘加载时按需使用。
- [Gate Futures API](https://www.gate.com/docs/developers/apiv4/en/#futures)：动态读取启用且未进入下架流程的 `stocks` 类 USDT 合约，并使用精确合约名订阅行情和查询 `1d` UTC 日 K。
- [Gate Futures WebSocket](https://www.gate.com/docs/developers/futures/ws/en/)：`wss://fx-ws.gateio.ws/v4/ws/usdt`，频道 `futures.tickers`。

Coinbase WebSocket 会按当前 USD 现货自选列表订阅；Kraken 与 Bitfinex 为内置且已验证的 BTC / ETH 提供备用，Bitstamp 通过官方市场目录扩展能够精确匹配的 USD 现货。Bybit 与 Gate 的官方目录各自贡献股票相关 USDT 永续；代码完全相同的合约可合并为双源覆盖，`AAPL` 与 `AAPLX` 之类的别名不会被猜成同一产品。

USD 现货优先显示 5 秒内的 Coinbase 行情；有 Bybit 精确映射的股票相关合约同样短暂优先 Bybit。主源不够新鲜时，程序从该产品支持的实时 WebSocket 中选择最新健康成交，仅在实时源均失效时使用对应的 Coinbase / Bybit / Gate HTTPS 兜底。某个低流动品种缺少新成交只会让该品种变为延迟或启用兜底，不会拖累共享连接；需要确认订阅的来源若拒绝或超时会自动退避重连。UTC 开盘价只为当前实际显示的来源按需加载，免费 REST 工作每批最多并发 3 个请求，避免启动或故障时突发打满接口。

涨跌幅始终和当前显示价格使用同一交易所、同一现货或永续产品的 UTC 日开盘价，避免跨交易所或借用标的股票开盘价。程序根据交易所消息时间识别 UTC 换日；跨日后昨日基准立即失效，新基准加载完成前显示 `—`。

以上来源均按其公开接口与当前使用条款接入；如果将行情用于商业化产品或再分发，应另外复核各数据提供方届时的许可要求。

## 平台边界

“始终置顶”适用于正常桌面会话。操作系统安全桌面（例如 Windows UAC）、锁屏、独占全屏应用，以及部分 Linux Wayland 合成器可以覆盖或限制普通应用窗口；应用无法绕过这些系统安全边界。Linux 托盘图标依赖桌面环境提供 StatusNotifier/AppIndicator 支持，部分精简 Wayland 环境可能需要对应扩展。未签名的测试安装包也可能触发 Windows SmartScreen 或 macOS Gatekeeper 提示，正式分发时应配置代码签名。

## 开发文档

新的开发 Thread 请从 [`AGENTS.md`](AGENTS.md) 和 [`docs/INDEX.md`](docs/INDEX.md) 开始；当前状态与下一步见 [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md)。这些文件是持久化开发上下文，README 继续只承担用户使用说明。

## 许可证

本项目仅按 [GNU General Public License v3.0](LICENSE)（SPDX：`GPL-3.0-only`）授权，不包含“或任何后续版本”选项。
