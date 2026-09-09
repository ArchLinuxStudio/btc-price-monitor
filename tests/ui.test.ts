import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface TauriConfig {
  version: string;
  bundle: {
    licenseFile: string;
  };
  app: {
    windows: Array<{
      label: string;
      title: string;
      url?: string;
      width: number;
      minWidth: number;
      maxWidth?: number;
      height: number;
      minHeight: number;
      maxHeight?: number;
      dragDropEnabled?: boolean;
      resizable: boolean;
      maximizable: boolean;
      maximized?: boolean;
      fullscreen: boolean;
      decorations: boolean;
      alwaysOnTop: boolean;
      skipTaskbar: boolean;
      visibleOnAllWorkspaces?: boolean;
      shadow?: boolean;
      center?: boolean;
      visible?: boolean;
      focus?: boolean;
    }>;
    security: {
      capabilities: string[];
      csp: {
        "connect-src": string[];
      };
    };
  };
}

interface TypeScriptConfig {
  compilerOptions: {
    target: string;
    module: string;
    lib: string[];
  };
}

interface MacOSTauriConfig {
  bundle: {
    macOS: {
      minimumSystemVersion: string;
    };
  };
}

function readProjectFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

test("uses the ES2025 language baseline and requires macOS 12 or later", () => {
  const typescriptConfig = JSON.parse(readProjectFile("tsconfig.json")) as TypeScriptConfig;
  const macOSConfig = JSON.parse(
    readProjectFile("src-tauri/tauri.macos.conf.json"),
  ) as MacOSTauriConfig;

  assert.equal(typescriptConfig.compilerOptions.target, "ES2025");
  assert.equal(typescriptConfig.compilerOptions.module, "ES2022");
  assert.deepEqual(typescriptConfig.compilerOptions.lib, ["ES2025", "DOM", "DOM.Iterable"]);
  assert.equal(macOSConfig.bundle.macOS.minimumSystemVersion, "12.0");
});

test("blocks a release when either macOS bundle misses the 12.0 deployment floor", () => {
  const workflow = readProjectFile(".github/workflows/build-desktop.yml");

  assert.match(workflow, /name: Verify macOS 12 deployment floor/);
  assert.match(workflow, /if: startsWith\(matrix\.platform, 'macos-'\)/);
  assert.match(workflow, /dmg_files=\("\$\{dmg_root\}"\/\*\.dmg\)/);
  assert.match(workflow, /printf 'Y\\n' \|[\s\S]*?PAGER=cat hdiutil attach -readonly -nobrowse/);
  assert.match(workflow, /trap cleanup EXIT/);
  assert.match(workflow, /status=\$\?/);
  assert.match(workflow, /hdiutil detach -force/);
  assert.match(workflow, /exit "\$\{status\}"/);
  assert.match(workflow, /Print :LSMinimumSystemVersion/);
  assert.match(workflow, /Print :CFBundleExecutable/);
  assert.match(workflow, /sort -u/);
  assert.match(workflow, /minimum_system_version[\s\S]*?!= "12\.0"/);
  assert.match(workflow, /otool -l/);
  assert.match(workflow, /LC_BUILD_VERSION/);
  assert.match(workflow, /LC_VERSION_MIN_MACOSX/);
  assert.match(workflow, /deployment_target[\s\S]*?!= "12\.0"/);
});

test("does not expose mouse-hover text tooltips", () => {
  const html = readProjectFile("src/index.html");
  const aboutHtml = readProjectFile("src/about.html");
  const chartHtml = readProjectFile("src/chart.html");
  const typescript = readProjectFile("src/main.ts");
  const chartTypescript = readProjectFile("src/chart.ts");
  const rust = readProjectFile("src-tauri/src/lib.rs");

  assert.doesNotMatch(html, /\btitle\s*=/i);
  assert.doesNotMatch(aboutHtml, /\btitle\s*=/i);
  assert.doesNotMatch(chartHtml, /\btitle\s*=/i);
  assert.doesNotMatch(typescript, /(?:\.title\s*=|(?:set|remove)Attribute\(\s*["']title["'])/);
  assert.doesNotMatch(chartTypescript, /(?:\.title\s*=|(?:set|remove)Attribute\(\s*["']title["'])/);
  assert.doesNotMatch(rust, /\.tooltip\s*\(/);
});

test("keeps the compact manager and exposes screen-bounded vertical quote resizing", () => {
  const html = readProjectFile("src/index.html");
  const css = readProjectFile("src/styles.css");
  const typescript = readProjectFile("src/main.ts");
  const watchlist = readProjectFile("src/watchlist.ts");
  const rust = readProjectFile("src-tauri/src/lib.rs");
  const windowPermission = readProjectFile("src-tauri/permissions/window-controls.toml");
  const mainCapability = readProjectFile("src-tauri/capabilities/main.json");
  const tauriConfig = JSON.parse(readProjectFile("src-tauri/tauri.conf.json")) as TauriConfig;
  const windowConfig = tauriConfig.app.windows.find(({ label }) => label === "main");

  assert.ok(windowConfig);

  assert.match(html, /id="watchlist-button"/);
  assert.match(html, /id="watchlist-manager"/);
  assert.match(html, /id="coin-search"[\s\S]*?type="search"/);
  assert.match(html, /placeholder="搜索币种 \/ 美股"/);
  assert.match(html, /id="quote-row-template"/);
  assert.match(html, /id="quotes"[\s\S]*?role="list"/);
  assert.match(html, /id="reorder-instructions"/);
  assert.match(html, /单击或按回车查看 K 线/);
  assert.match(html, /id="reorder-status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/);
  assert.match(html, /class="quote-row" role="listitem"/);
  assert.match(
    html,
    /id="resize-handle"[\s\S]*?aria-label="拖动或使用方向键调整行情窗口高度"/,
  );
  assert.doesNotMatch(html, /id="minimize-button"/);
  assert.doesNotMatch(typescript, /\.innerHTML\s*=/);
  assert.match(typescript, /feed\.setProducts\(selectedProducts\)/);
  assert.match(
    typescript,
    /const selectedIndex = selectedProducts\.findIndex[\s\S]*?renderSelectedProduct\(selectedProducts\[selectedIndex\], selectedIndex\);/,
  );
  assert.doesNotMatch(`${typescript}\n${watchlist}`, /MAX_PRODUCTS|自选已满|最多可显示/);
  assert.doesNotMatch(watchlist, /normalized\.length\s*>=/);
  assert.match(
    typescript,
    /rowCount: selectedProducts\.length/,
  );
  assert.doesNotMatch(typescript, /nativeQuoteRowLimit|Math\.min\(selectedProducts\.length/);
  assert.match(
    typescript,
    /remove\.addEventListener\("click", \(\) => removeProduct\(product\.id, index\)\)/,
  );
  assert.match(typescript, /previousRemovableIndex[\s\S]*?filter\(\(entry\) => !entry\.fixed\)[\s\S]*?Math\.min\(previousRemovableIndex, buttons\.length - 1\)/);
  assert.match(typescript, /product\.symbol\.length > 6/);
  assert.doesNotMatch(typescript, /product\.symbol\.length > 5/);
  assert.match(typescript, /row\.draggable = true/);
  assert.match(typescript, /aria-keyshortcuts", "Enter Space Alt\+ArrowUp Alt\+ArrowDown"/);
  assert.match(typescript, /aria-describedby", "reorder-instructions"/);
  for (const eventName of ["dragstart", "dragover", "dragleave", "drop", "dragend"]) {
    assert.match(typescript, new RegExp(`addEventListener\\("${eventName}"`));
  }
  assert.match(typescript, /dataTransfer\.setData\("text\/plain", productId\)/);
  assert.match(typescript, /event\.dataTransfer\.effectAllowed = "move"/);
  assert.match(typescript, /event\.dataTransfer\.dropEffect = "move"/);
  assert.match(typescript, /event\.altKey[\s\S]*?event\.key === "ArrowDown"[\s\S]*?event\.key === "ArrowUp"/);
  assert.match(
    typescript,
    /function openProductChart[\s\S]*?quote\?\.marketSource \|\| null[\s\S]*?serializeChartSelection[\s\S]*?tauriInvoke\("show_chart_window"/,
  );
  assert.match(typescript, /elements\.quotes\.addEventListener\("click"[\s\S]*?openProductChart\(productId\)/);
  assert.match(typescript, /event\.key === "Enter"[\s\S]*?event\.key === " "[\s\S]*?openProductChart\(productId\)/);
  assert.match(typescript, /suppressQuoteActivation = true/);
  assert.match(
    typescript,
    /function clearQuoteDrag[\s\S]*?requestAnimationFrame[\s\S]*?suppressQuoteActivation = false/,
  );
  assert.match(typescript, /requestAnimationFrame\(\(\) => quoteViews\.get\(movingProductId\)\?\.row\.focus\(\)\)/);
  assert.match(typescript, /document\.addEventListener\("drop"[\s\S]*?event\.preventDefault\(\)/);
  const reorderFunctionPattern =
    /function reorderSelectedProduct[\s\S]*?\r?\n}\r?\n\r?\nfunction moveSelectedProductBy/;
  const reorderFunction = typescript.match(reorderFunctionPattern)?.[0];
  const crlfReorderFunction = typescript
    .replace(/\r?\n/g, "\r\n")
    .match(reorderFunctionPattern)?.[0];
  assert.ok(reorderFunction);
  assert.ok(crlfReorderFunction);
  assert.match(reorderFunction, /selectedProducts = saveWatchlist\(reordered\)/);
  assert.doesNotMatch(reorderFunction, /feed\.setProducts/);
  assert.match(typescript, /USD\/USDT/);
  assert.match(typescript, /scrollHeight > elements\.quotes\.clientHeight/);
  assert.match(typescript, /tauriInvoke\("resize_monitor_height"/);
  assert.match(css, /grid-template-columns:\s*40px minmax\(0, 1fr\) 40px/);
  assert.match(css, /\.resize-handle\s*\{[\s\S]*?cursor:\s*ns-resize/);
  assert.match(css, /\.quote-row\[draggable="true"\][\s\S]*?cursor:\s*grab[\s\S]*?-webkit-app-region:\s*no-drag/);
  assert.match(css, /\.quotes\.is-reordering \.quote-row[\s\S]*?cursor:\s*grabbing/);
  assert.match(css, /\.quote-row\.is-drop-before[\s\S]*?inset 0 2px/);
  assert.match(css, /\.quote-row\.is-drop-after[\s\S]*?inset 0 -2px/);
  assert.match(css, /\.quote-row:focus-visible/);
  assert.match(
    rust,
    /quote_content_height\(row_count\)[\s\S]*?\.min\(available_height\)[\s\S]*?requested_height\.clamp\(minimum_height, maximum_height\)/,
  );
  assert.match(rust, /current_monitor\(\)[\s\S]*?work_area\(\)[\s\S]*?scale_factor\(\)/);
  assert.match(windowPermission, /"resize_monitor_height"/);
  assert.doesNotMatch(
    `${mainCapability}\n${windowPermission}`,
    /allow-(?:set-size|set-min-size|set-max-size|start-resize-dragging)|commands\.allow\s*=\s*\[\s*"\*"/,
  );
  assert.equal(windowConfig.width, 208);
  assert.equal(windowConfig.minWidth, 208);
  assert.equal(windowConfig.maxWidth, 208);
  assert.equal(windowConfig.height, 92);
  assert.equal(windowConfig.minHeight, 92);
  assert.equal(windowConfig.maxHeight, undefined);
  assert.equal(windowConfig.dragDropEnabled, false);
  assert.equal(windowConfig.resizable, false);
  assert.equal(windowConfig.maximizable, false);
});

test("provides one maximized candlestick window without hiding the compact monitor", () => {
  const chartHtml = readProjectFile("src/chart.html");
  const chartCss = readProjectFile("src/chart.css");
  const chartTypescript = readProjectFile("src/chart.ts");
  const chartViewport = readProjectFile("src/chart-viewport.ts");
  const candleHistory = readProjectFile("src/candle-history.ts");
  const frontendBuild = readProjectFile("scripts/frontend.ts");
  const rust = readProjectFile("src-tauri/src/lib.rs");
  const tauriBuild = readProjectFile("src-tauri/build.rs");
  const mainCapability = JSON.parse(
    readProjectFile("src-tauri/capabilities/main.json"),
  ) as { windows: string[]; permissions: string[] };
  const chartCapability = JSON.parse(
    readProjectFile("src-tauri/capabilities/chart.json"),
  ) as { windows: string[]; permissions: string[] };
  const tauriConfig = JSON.parse(readProjectFile("src-tauri/tauri.conf.json")) as TauriConfig;
  const chartWindows = tauriConfig.app.windows.filter(({ label }) => label === "chart");
  const chartWindow = chartWindows[0];

  assert.equal(chartWindows.length, 1);
  assert.ok(chartWindow);
  assert.equal(chartWindow.url, "chart.html");
  assert.equal(chartWindow.minWidth, 640);
  assert.equal(chartWindow.minHeight, 400);
  assert.equal(chartWindow.resizable, true);
  assert.equal(chartWindow.maximizable, true);
  assert.equal(chartWindow.maximized, false);
  assert.equal(chartWindow.fullscreen, false);
  assert.equal(chartWindow.decorations, false);
  assert.equal(chartWindow.alwaysOnTop, false);
  assert.equal(chartWindow.skipTaskbar, true);
  assert.equal(chartWindow.visibleOnAllWorkspaces, false);
  assert.equal(chartWindow.visible, false);
  assert.equal(chartWindow.focus, false);

  assert.match(chartHtml, /<canvas[\s\S]*?id="candle-canvas"[\s\S]*?role="application"/);
  assert.match(chartHtml, /id="candle-canvas"[\s\S]*?aria-roledescription="交互式 K 线图"[\s\S]*?tabindex="0"[\s\S]*?aria-describedby="chart-summary chart-navigation-help"/);
  assert.match(chartHtml, /id="interval-toolbar"[\s\S]*?role="toolbar"/);
  for (const interval of ["1m", "5m", "15m", "1h", "1d"]) {
    assert.match(chartHtml, new RegExp(`data-interval="${interval}"`));
  }
  assert.match(chartHtml, /id="close-chart"[\s\S]*?aria-label="关闭 K 线图并返回行情窗口"/);
  assert.match(chartHtml, /id="state-message"[\s\S]*?aria-live="polite"/);
  assert.match(chartHtml, /id="retry-button"/);
  assert.match(chartHtml, /class="view-toolbar"[\s\S]*?id="zoom-out"[\s\S]*?id="reset-view"[\s\S]*?id="zoom-in"/);
  assert.match(chartHtml, /id="view-caption"/);
  assert.match(chartHtml, /滚轮缩放 · 拖拽平移 · 双击重置/);
  assert.match(chartHtml, /按 Home 查看最早已加载数据，按 End 查看最新数据，按 0 或双击重置视图/);
  assert.match(chartHtml, /<script type="module" src="\.\/chart\.js"><\/script>/);
  assert.match(chartCss, /\.chart-shell\s*\{[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100vh;/);
  assert.match(chartCss, /#candle-canvas\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/);
  assert.match(chartCss, /#candle-canvas\s*\{[\s\S]*?overscroll-behavior:\s*none;[\s\S]*?touch-action:\s*none;/);
  assert.match(chartCss, /#candle-canvas\s*\{[\s\S]*?cursor:\s*crosshair/);
  assert.doesNotMatch(chartCss, /cursor:\s*grabb?ing|cursor:\s*grab\b/);
  assert.match(chartHtml, /<canvas id="crosshair-canvas" aria-hidden="true"><\/canvas>/);
  assert.match(chartHtml, /id="history-start-marker" role="img" aria-label="已确认的历史起点" hidden/);
  assert.match(chartHtml, /id="current-price-canvas" aria-hidden="true"/);
  assert.match(chartHtml, /id="current-price-marker" role="img" aria-label="当前价格" hidden/);
  assert.match(chartCss, /#current-price-marker\s*\{[\s\S]*?pointer-events:\s*none;/);
  assert.match(chartHtml, /确认已到达历史起点后，日期轴才会显示起点旗标/);
  assert.match(chartCss, /#history-start-marker\s*\{[\s\S]*?pointer-events:\s*none;/);
  assert.match(chartTypescript, /layoutChartTimeAxis\(viewport, candles\.length/);
  assert.doesNotMatch(chartTypescript, /isCandleViewportFull/);
  assert.match(chartCss, /#crosshair-canvas\s*\{[\s\S]*?pointer-events:\s*none;/);
  assert.match(chartCss, /#candle-canvas:focus-visible/);
  assert.match(chartCss, /@media \(min-width: 960px\)[\s\S]*?padding-right: max\(248px, env\(safe-area-inset-right\)\)/);

  assert.match(chartTypescript, /createCandleHistoryLoader\(\{/);
  assert.match(chartTypescript, /devicePixelRatio/);
  assert.match(chartTypescript, /new ResizeObserver\(scheduleDraw\)/);
  assert.match(chartTypescript, /listen<string>\("chart-selection-changed"/);
  assert.match(chartTypescript, /invokeTauri<unknown>\("get_chart_selection"\)/);
  assert.match(chartTypescript, /invokeTauri<void>\("close_chart_window"\)/);
  assert.match(chartTypescript, /event\.key !== "Escape"/);
  assert.match(chartTypescript, /document\.visibilityState === "hidden"[\s\S]*?abortHistoryRequest\(\)/);
  assert.match(chartTypescript, /document\.addEventListener\("drop"[\s\S]*?event\.preventDefault\(\)/);
  assert.match(chartTypescript, /from "\.\/chart-viewport\.js"/);
  assert.match(chartTypescript, /viewport = createCandleViewport\(candles\.length\)/);
  assert.match(chartTypescript, /navigation\?\.zoom\(scale, anchor\)/);
  assert.match(chartTypescript, /candleViewportBounds\(viewport, candles\.length\)/);
  assert.match(chartTypescript, /candleBarGeometry\(plot\.width, viewport\.count\)/);
  assert.match(chartHtml, /id="history-message"[\s\S]*?aria-live="polite"/);
  assert.match(chartHtml, /id="load-older"[\s\S]*?aria-label="继续加载更早的同源 K 线"/);
  assert.match(chartTypescript, /index \+ 0\.5 - viewport\.start/);
  assert.match(chartTypescript, /context\.rect\(plot\.left, plot\.top, plot\.width, plot\.height\)[\s\S]*?context\.clip\(\)/);
  assert.match(chartTypescript, /addEventListener\("wheel", handleCanvasWheel, \{ passive: false \}\)/);
  assert.match(chartTypescript, /event\.preventDefault\(\)[\s\S]*?zoomViewport\(Math\.exp/);
  for (const pointerEvent of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture"]) {
    assert.match(chartTypescript, new RegExp(`addEventListener\\("${pointerEvent}"`));
  }
  assert.match(chartTypescript, /setPointerCapture\(event\.pointerId\)/);
  assert.match(chartTypescript, /releasePointerCapture\(activePan\.pointerId\)/);
  assert.match(chartTypescript, /addEventListener\("dblclick"[\s\S]*?resetViewport\(\)/);
  assert.match(chartTypescript, /case "ArrowLeft"[\s\S]*?case "ArrowRight"[\s\S]*?case "Home"[\s\S]*?case "End"[\s\S]*?case "0"/);
  assert.match(chartTypescript, /当前显示第 \$\{bounds\.startIndex \+ 1\} 至 \$\{bounds\.endIndex\} 根/);
  assert.doesNotMatch(chartTypescript, /\.innerHTML\s*=|location\.(?:assign|replace)|window\.open/);
  assert.match(chartViewport, /export const MIN_VISIBLE_CANDLES = 12/);
  assert.match(chartViewport, /scale > 1/);
  assert.match(chartViewport, /Positive values[\s\S]*?newer candles/);
  assert.match(candleHistory, /marketSource !== "coinbase" && marketSource !== "bybit" && marketSource !== "gate"/);
  assert.doesNotMatch(candleHistory, /marketSource\s*=\s*"coinbase"|fallback/i);
  assert.match(frontendBuild, /"chart\.html"/);
  assert.match(frontendBuild, /"chart\.css"/);

  assert.deepEqual(mainCapability.windows, ["main"]);
  assert.equal(mainCapability.permissions.includes("allow-show-chart-window"), true);
  assert.deepEqual(chartCapability.windows, ["chart"]);
  assert.deepEqual(chartCapability.permissions, [
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "allow-get-chart-selection",
    "allow-close-chart-window",
  ]);
  assert.doesNotMatch(
    JSON.stringify(chartCapability),
    /(?:allow-create|allow-set-size|allow-set-fullscreen|core:window:default|\*)/,
  );
  assert.match(tauriBuild, /"show_chart_window"/);
  assert.match(tauriBuild, /"get_chart_selection"/);
  assert.match(tauriBuild, /"close_chart_window"/);
  assert.match(rust, /const CHART_SELECTION_EVENT: &str = "chart-selection-changed"/);
  assert.match(rust, /fn show_chart_window[\s\S]*?chart\.show\(\)[\s\S]*?chart\.maximize\(\)/);
  assert.match(rust, /fn close_chart_window[\s\S]*?window\.hide\(\)[\s\S]*?show_main_window\(&app\)/);
  assert.match(rust, /hides_on_close[\s\S]*?label == CHART_WINDOW_LABEL/);
  assert.doesNotMatch(rust, /WebviewWindowBuilder|WebviewWindow::new/);
  const showChartFunction = rust.match(
    /fn show_chart_window[\s\S]*?\r?\n}\r?\n\r?\n#\[tauri::command\]\r?\nfn get_chart_selection/,
  )?.[0];
  assert.ok(showChartFunction);
  assert.doesNotMatch(showChartFunction, /main\.(?:hide|close)\(|hide_main_window/);
});

test("provides a compact single-instance About window with a scoped repository link", () => {
  const aboutHtml = readProjectFile("src/about.html");
  const aboutCss = readProjectFile("src/about.css");
  const aboutTypescript = readProjectFile("src/about.ts");
  const frontendBuild = readProjectFile("scripts/frontend.ts");
  const license = readProjectFile("LICENSE");
  const cargoManifest = readProjectFile("src-tauri/Cargo.toml");
  const rust = readProjectFile("src-tauri/src/lib.rs");
  const packageMetadata = JSON.parse(readProjectFile("package.json")) as {
    version: string;
    license: string;
  };
  const packageLock = JSON.parse(readProjectFile("package-lock.json")) as {
    packages: Record<string, { license?: string }>;
  };
  const mainCapability = JSON.parse(readProjectFile("src-tauri/capabilities/main.json")) as {
    windows: string[];
  };
  const aboutCapability = JSON.parse(readProjectFile("src-tauri/capabilities/about.json")) as {
    windows: string[];
    permissions: Array<{
      identifier: string;
      allow: Array<{ url: string }>;
    }>;
  };
  const tauriConfig = JSON.parse(readProjectFile("src-tauri/tauri.conf.json")) as TauriConfig;
  const aboutWindow = tauriConfig.app.windows.find(({ label }) => label === "about");

  assert.ok(aboutWindow);
  assert.equal(aboutWindow.title, "关于 Crypto Top");
  assert.equal(aboutWindow.url, "about.html");
  assert.equal(aboutWindow.width, 320);
  assert.equal(aboutWindow.height, 280);
  assert.equal(aboutWindow.minWidth, 320);
  assert.equal(aboutWindow.maxWidth, 320);
  assert.equal(aboutWindow.minHeight, 280);
  assert.equal(aboutWindow.maxHeight, 280);
  assert.equal(aboutWindow.resizable, false);
  assert.equal(aboutWindow.maximizable, false);
  assert.equal(aboutWindow.decorations, true);
  assert.equal(aboutWindow.alwaysOnTop, true);
  assert.equal(aboutWindow.skipTaskbar, true);
  assert.equal(aboutWindow.center, true);
  assert.equal(aboutWindow.visible, false);
  assert.equal(aboutWindow.focus, false);
  assert.equal(tauriConfig.version, packageMetadata.version);

  assert.match(aboutHtml, /src="app-icon\.svg"/);
  assert.match(aboutHtml, /id="app-version">\{\{APP_VERSION\}\}/);
  assert.match(aboutHtml, /<script type="module" src="\.\/about\.js"><\/script>/);
  assert.match(
    aboutHtml,
    /<button[\s\S]*?id="repository-link"[\s\S]*?aria-label="在 GitHub 上打开 Crypto Top 仓库"/,
  );
  assert.match(aboutHtml, /<svg[\s\S]*?aria-hidden="true"/);
  assert.doesNotMatch(aboutHtml, /https:\/\/github\.com\/ArchLinuxStudio\/btc-price-monitor/);
  assert.match(aboutHtml, /GNU GPL v3\.0/);
  assert.match(aboutHtml, /GPL-3\.0-only/);
  assert.doesNotMatch(aboutHtml, /<details\b|\{\{GPL_LICENSE_TEXT\}\}|class="license-text"/);
  assert.match(
    aboutCss,
    /\.identity-card\s*\{[\s\S]*?grid-template-columns:\s*62px minmax\(0, 1fr\) 38px/,
  );
  assert.match(aboutCss, /\.github-link:focus-visible/);

  assert.match(
    aboutTypescript,
    /const repositoryUrl = "https:\/\/github\.com\/ArchLinuxStudio\/btc-price-monitor"/,
  );
  assert.match(aboutTypescript, /\.openUrl\(repositoryUrl\)/);
  assert.doesNotMatch(aboutTypescript, /location\.(?:assign|replace)|window\.open/);

  assert.match(frontendBuild, /"about\.html"/);
  assert.match(frontendBuild, /"about\.css"/);
  assert.match(frontendBuild, /"assets", "app-icon\.svg"/);
  assert.match(frontendBuild, /"LICENSE\.txt"/);
  assert.match(frontendBuild, /"src-tauri", "tauri\.conf\.json"/);
  assert.match(frontendBuild, /\{\{APP_VERSION\}\}/);
  assert.doesNotMatch(frontendBuild, /\{\{GPL_LICENSE_TEXT\}\}/);
  assert.match(rust, /MenuItem::with_id\(app, "about", "关于 Crypto Top"/);
  assert.match(rust, /"about"\s*=>\s*Some\(TrayAction::ShowAbout\)/);
  assert.match(rust, /Some\(TrayAction::ShowAbout\)\s*=>\s*\{[\s\S]*?show_about_window\(app\)/);
  assert.match(rust, /WindowEvent::CloseRequested[\s\S]*?hides_on_close\(window\.label\(\)\)/);
  assert.match(rust, /\.plugin\(tauri_plugin_opener::init\(\)\)/);
  assert.match(cargoManifest, /^tauri-plugin-opener = "2"$/m);
  assert.deepEqual(mainCapability.windows, ["main"]);
  assert.deepEqual(aboutCapability.windows, ["about"]);
  assert.deepEqual(aboutCapability.permissions, [
    {
      identifier: "opener:allow-open-url",
      allow: [{ url: "https://github.com/ArchLinuxStudio/btc-price-monitor" }],
    },
  ]);
  assert.deepEqual(tauriConfig.app.security.capabilities, [
    "main-capability",
    "about-capability",
    "chart-capability",
  ]);
  assert.doesNotMatch(JSON.stringify(aboutCapability), /opener:default|\*/);
  assert.equal(packageMetadata.license, "GPL-3.0-only");
  assert.equal(packageLock.packages[""].license, packageMetadata.license);
  assert.match(cargoManifest, /^license = "GPL-3\.0-only"$/m);
  assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
  assert.equal(tauriConfig.bundle.licenseFile, "../LICENSE");
});

test("keeps market-data CSP origins explicit and aligned with browser-safe transports", () => {
  const tauriConfig = JSON.parse(readProjectFile("src-tauri/tauri.conf.json")) as TauriConfig;
  const connectSources = tauriConfig.app.security.csp["connect-src"];

  for (const origin of [
    "https://api.exchange.coinbase.com",
    "https://api.kraken.com",
    "https://www.bitstamp.net",
    "https://api.bybit.com",
    "https://api.gateio.ws",
    "wss://advanced-trade-ws.coinbase.com",
    "wss://ws.kraken.com",
    "wss://ws.bitstamp.net",
    "wss://api-pub.bitfinex.com",
    "wss://stream.bybit.com",
    "wss://fx-ws.gateio.ws",
  ]) {
    assert.equal(connectSources.includes(origin), true, `missing CSP origin ${origin}`);
  }
  assert.equal(connectSources.includes("https://api-pub.bitfinex.com"), false);
  assert.equal(connectSources.some((origin) => origin.includes("*")), false);
});
