import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface TauriConfig {
  app: {
    windows: Array<{
      width: number;
      minWidth: number;
      maxWidth: number;
      height: number;
      maxHeight: number;
      resizable: boolean;
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
  const typescript = readProjectFile("src/main.ts");
  const rust = readProjectFile("src-tauri/src/lib.rs");

  assert.doesNotMatch(html, /\btitle\s*=/i);
  assert.doesNotMatch(typescript, /(?:\.title\s*=|(?:set|remove)Attribute\(\s*["']title["'])/);
  assert.doesNotMatch(rust, /\.tooltip\s*\(/);
});

test("uses a compact watchlist manager instead of permanent row controls", () => {
  const html = readProjectFile("src/index.html");
  const css = readProjectFile("src/styles.css");
  const typescript = readProjectFile("src/main.ts");
  const tauriConfig = JSON.parse(readProjectFile("src-tauri/tauri.conf.json")) as TauriConfig;
  const windowConfig = tauriConfig.app.windows[0];

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
