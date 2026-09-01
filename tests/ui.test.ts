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
      maxWidth: number;
      height: number;
      minHeight: number;
      maxHeight?: number;
      dragDropEnabled?: boolean;
      resizable: boolean;
      maximizable: boolean;
      decorations: boolean;
      alwaysOnTop: boolean;
      skipTaskbar: boolean;
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
  assert.match(workflow, /hdiutil attach -readonly -nobrowse/);
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
  const typescript = readProjectFile("src/main.ts");
  const rust = readProjectFile("src-tauri/src/lib.rs");

  assert.doesNotMatch(html, /\btitle\s*=/i);
  assert.doesNotMatch(aboutHtml, /\btitle\s*=/i);
  assert.doesNotMatch(typescript, /(?:\.title\s*=|(?:set|remove)Attribute\(\s*["']title["'])/);
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
  assert.match(typescript, /aria-keyshortcuts", "Alt\+ArrowUp Alt\+ArrowDown"/);
  assert.match(typescript, /aria-describedby", "reorder-instructions"/);
  for (const eventName of ["dragstart", "dragover", "dragleave", "drop", "dragend"]) {
    assert.match(typescript, new RegExp(`addEventListener\\("${eventName}"`));
  }
  assert.match(typescript, /dataTransfer\.setData\("text\/plain", productId\)/);
  assert.match(typescript, /event\.dataTransfer\.effectAllowed = "move"/);
  assert.match(typescript, /event\.dataTransfer\.dropEffect = "move"/);
  assert.match(typescript, /event\.altKey[\s\S]*?event\.key === "ArrowDown"[\s\S]*?event\.key === "ArrowUp"/);
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
  assert.deepEqual(tauriConfig.app.security.capabilities, ["main-capability", "about-capability"]);
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
