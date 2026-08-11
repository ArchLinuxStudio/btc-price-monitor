# Crypto Top

一个轻量、始终置顶的 BTC / ETH 美元实时价格监视器。支持 Windows、macOS 和 Linux。

## 功能

- **真实 USD 行情**：显示 `BTC-USD` 和 `ETH-USD`，不会把 USDT 静默当成美元。
- **WebSocket 实时推送**：成交发生后立即更新，不使用慢速轮询。
- **双免费数据源**：Coinbase Advanced Trade 为主，Kraken v2 自动备用；都不需要 API Key。
- **自动恢复**：心跳监测、超时切源、带抖动的指数退避重连；若 WebSocket 被网络拦截，会启用免费的 HTTPS 最新价兜底。
- **始终置顶**：启动、窗口重新获得焦点、系统唤醒和运行期间都会重新确认置顶状态。
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

## macOS / Linux

源代码完全共用，但安装包必须在目标系统上构建。仓库内的 `.github/workflows/build-desktop.yml` 可以生成：

- Windows x64：NSIS `.exe`
- macOS：Apple Silicon 和 Intel `.dmg`
- Linux x64：`.AppImage` 和 `.deb`

也可以在对应平台安装 [Tauri 官方前置依赖](https://v2.tauri.app/start/prerequisites/) 后运行 `npm run build`。

## 行情来源

- [Coinbase Advanced Trade WebSocket](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview)：`wss://advanced-trade-ws.coinbase.com`
- [Kraken WebSocket v2](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker)：`wss://ws.kraken.com/v2`

两条连接会同时保持健康状态。Coinbase 在 5 秒内有新价格时优先显示；否则自动使用更新的 Kraken 行情。12 秒没有任何 WebSocket 有效价格时，会每 5 秒从 Coinbase HTTPS 接口取得最新价，同时继续重连实时源；若所有渠道都失败，界面会把末次价格标为延迟。

## 平台边界

“始终置顶”适用于正常桌面会话。操作系统安全桌面（例如 Windows UAC）、锁屏、独占全屏应用，以及部分 Linux Wayland 合成器可以覆盖或限制普通应用窗口；应用无法绕过这些系统安全边界。未签名的测试安装包也可能触发 Windows SmartScreen 或 macOS Gatekeeper 提示，正式分发时应配置代码签名。
