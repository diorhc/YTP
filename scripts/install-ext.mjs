/**
 * Install Violentmonkey into running CloakBrowser via CDP.
 *
 * Usage: node scripts/install-ext.mjs
 */
import { chromium } from "playwright";

const CDP_WS = process.env.CDP_URL || "ws://localhost:9222/devtools/browser/";

// Try to discover the actual WS URL
async function getBrowserWsUrl() {
  const res = await fetch("http://localhost:9222/json/version");
  const data = await res.json();
  return data.webSocketDebuggerUrl;
}

async function main() {
  const wsUrl = await getBrowserWsUrl();
  console.log(`Connecting to ${wsUrl}`);

  const browser = await chromium.connectOverCDP(wsUrl);
  const defaultCtx = browser.contexts()[0];
  const page = defaultCtx.pages()[0] || (await defaultCtx.newPage());

  console.log("Opening Chrome Web Store: Violentmonkey...");
  await page.goto(
    "https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag",
    { waitUntil: "networkidle", timeout: 30000 },
  );

  const addBtn = page.locator(
    '[aria-label*="Add to Chrome"], [aria-label*="Установить"], button:has-text("Add to Chrome"), button:has-text("Установить")',
  );
  if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log("Found install button, clicking...");
    await addBtn.click();
    console.log(
      "Clicked! Check the browser window to confirm the installation dialog.",
    );
  } else {
    console.log(
      "Install button not found. The page may need manual interaction.",
    );
    console.log(`Current URL: ${page.url()}`);
  }

  console.log(
    "\nViolentmonkey page is open in the browser. Complete installation manually if needed.",
  );
  await browser.close();
}

main().catch(console.error);
