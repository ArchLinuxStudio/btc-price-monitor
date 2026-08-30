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
      maxHeight: number;
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
      csp: {
        "connect-src": string[];
      };
    };
  };
}

function readProjectFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

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

test("uses a compact watchlist manager instead of permanent row controls", () => {
  const html = readProjectFile("src/index.html");
  const css = readProjectFile("src/styles.css");
  const typescript = readProjectFile("src/main.ts");
  const tauriConfig = JSON.parse(readProjectFile("src-tauri/tauri.conf.json")) as TauriConfig;
  const windowConfig = tauriConfig.app.windows.find(({ label }) => label === "main");

  assert.ok(windowConfig);

  assert.match(html, /id="watchlist-button"/);
  assert.match(html, /id="watchlist-manager"/);
  assert.match(html, /id="coin-search"[\s\S]*?type="search"/);
  assert.match(html, /placeholder="搜索币种 \/ 美股"/);
  assert.match(html, /id="quote-row-template"/);
  assert.doesNotMatch(html, /id="minimize-button"/);
  assert.doesNotMatch(typescript, /\.innerHTML\s*=/);
  assert.match(typescript, /feed\.setProducts\(selectedProducts\)/);
  assert.match(typescript, /USD\/USDT/);
  assert.match(css, /grid-template-columns:\s*40px minmax\(0, 1fr\) 40px/);
  assert.equal(windowConfig.width, 208);
  assert.equal(windowConfig.minWidth, 208);
  assert.equal(windowConfig.maxWidth, 208);
  assert.equal(windowConfig.height, 92);
  assert.equal(windowConfig.maxHeight, 170);
  assert.equal(windowConfig.resizable, false);
});

test("provides a local single-instance About window from the tray", () => {
  const aboutHtml = readProjectFile("src/about.html");
  const aboutCss = readProjectFile("src/about.css");
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
  const capability = JSON.parse(readProjectFile("src-tauri/capabilities/main.json")) as {
    windows: string[];
  };
  const tauriConfig = JSON.parse(readProjectFile("src-tauri/tauri.conf.json")) as TauriConfig;
  const aboutWindow = tauriConfig.app.windows.find(({ label }) => label === "about");

  assert.ok(aboutWindow);
  assert.equal(aboutWindow.title, "关于 Crypto Top");
  assert.equal(aboutWindow.url, "about.html");
  assert.equal(aboutWindow.width, 380);
  assert.equal(aboutWindow.height, 450);
  assert.equal(aboutWindow.minWidth, 380);
  assert.equal(aboutWindow.maxWidth, 380);
  assert.equal(aboutWindow.minHeight, 450);
  assert.equal(aboutWindow.maxHeight, 450);
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
  assert.match(aboutHtml, /https:\/\/github\.com\/ArchLinuxStudio\/btc-price-monitor/);
  assert.match(aboutHtml, /GNU General Public License v3\.0/);
  assert.match(aboutHtml, /GPL-3\.0-only/);
  assert.match(aboutHtml, /<details class="license-details">/);
  assert.match(aboutHtml, /\{\{GPL_LICENSE_TEXT\}\}/);
  assert.doesNotMatch(aboutHtml, /<script\b/i);
  assert.match(aboutCss, /user-select:\s*all/);
  assert.match(aboutCss, /\.license-text\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(
    aboutCss,
    /\.license-details\[open\]\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*16px;[\s\S]*?right:\s*16px;[\s\S]*?bottom:\s*16px;[\s\S]*?left:\s*16px/,
  );
  assert.doesNotMatch(aboutCss, /\binset\s*:/);
  assert.match(aboutCss, /\.license-details\[open\] \.license-text\s*\{[\s\S]*?flex:\s*1 1 0/);

  assert.match(frontendBuild, /"about\.html"/);
  assert.match(frontendBuild, /"about\.css"/);
  assert.match(frontendBuild, /"assets", "app-icon\.svg"/);
  assert.match(frontendBuild, /"LICENSE\.txt"/);
  assert.match(frontendBuild, /"src-tauri", "tauri\.conf\.json"/);
  assert.match(frontendBuild, /\{\{APP_VERSION\}\}/);
  assert.match(frontendBuild, /\{\{GPL_LICENSE_TEXT\}\}/);
  assert.match(rust, /MenuItem::with_id\(app, "about", "关于 Crypto Top"/);
  assert.match(rust, /"about"\s*=>\s*Some\(TrayAction::ShowAbout\)/);
  assert.match(rust, /Some\(TrayAction::ShowAbout\)\s*=>\s*\{[\s\S]*?show_about_window\(app\)/);
  assert.match(rust, /WindowEvent::CloseRequested[\s\S]*?hides_on_close\(window\.label\(\)\)/);
  assert.deepEqual(capability.windows, ["main"]);
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
