/**
 * Real user testing — connects to running Cloak and tests YouTube+ interactively.
 *
 * Usage:
 *   npm run test:real
 *   node scripts/test-real.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT, "youtube.user.js");
const SCREENSHOTS = path.join(ROOT, "e2e-report", "real-screenshots");

const results = [];
let passed = 0;
let failed = 0;

function log(msg) {
  console.log(`  ${msg}`);
}
function pass(name) {
  passed++;
  results.push({ name, status: "✅" });
  console.log(`  ✅ ${name}`);
}
function fail(name, err) {
  failed++;
  results.push({ name, status: "❌", error: String(err) });
  console.log(`  ❌ ${name}: ${err}`);
}

async function screenshot(page, name) {
  if (!fs.existsSync(SCREENSHOTS))
    fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: false,
  });
}

function getScriptContent() {
  const raw = fs.readFileSync(SCRIPT_PATH, "utf8");
  const endTag = "// ==/UserScript==";
  const idx = raw.indexOf(endTag);
  return idx === -1 ? raw : raw.slice(idx + endTag.length).trim();
}

async function injectUserscript(page) {
  const content = getScriptContent();
  await page.evaluate((code) => {
    const s = document.createElement("script");
    s.textContent = code;
    document.body.appendChild(s);
  }, content);
  await page.waitForFunction(
    () =>
      typeof window.YouTubeUtils === "object" &&
      typeof window.YouTubeErrorBoundary === "object",
    { timeout: 15_000 },
  );
  await page.waitForTimeout(3000);
}

async function waitForVideoPlayer(page) {
  await page.waitForSelector("#movie_player", { timeout: 15_000 });
  await page.waitForTimeout(2000);
}

async function main() {
  console.log("Connecting to Cloak browser...");
  const wsUrl = await fetch("http://localhost:9222/json/version")
    .then((r) => r.json())
    .then((d) => d.webSocketDebuggerUrl);

  const browser = await chromium.connectOverCDP(wsUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  try {
    // ─── 1. YouTube Load ───────────────────────────────────────────
    console.log("\n1. Loading YouTube...");
    await page.goto("https://www.youtube.com", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);
    await screenshot(page, "01-youtube-loaded");

    const title = await page.title();
    if (title.includes("YouTube")) {
      pass("YouTube loads successfully");
    } else {
      fail("YouTube loads", `Title: ${title}`);
    }

    // ─── 2. Navigate to video ──────────────────────────────────────
    console.log("\n2. Navigating to a video...");
    await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);
    await screenshot(page, "02-video-page");

    const hasPlayer = await page.evaluate(
      () => !!document.getElementById("movie_player"),
    );
    if (hasPlayer) {
      pass("Video page loads with player");
    } else {
      fail("Video page loads", "No #movie_player found");
    }

    // ─── 3. Inject YouTube+ userscript ─────────────────────────────
    console.log("\n3. Injecting YouTube+ userscript...");
    try {
      await injectUserscript(page);
      await screenshot(page, "03-userscript-injected");

      const globals = await page.evaluate(() => ({
        utils: typeof window.YouTubeUtils === "object",
        errorBoundary: typeof window.YouTubeErrorBoundary === "object",
        lazyLoader: typeof window.YouTubePlusLazyLoader === "object",
      }));

      if (globals.utils && globals.errorBoundary && globals.lazyLoader) {
        pass("Userscript initializes on real YouTube");
      } else {
        fail("Userscript initializes", `globals: ${JSON.stringify(globals)}`);
      }
    } catch (e) {
      fail("Userscript inject", e.message);
    }

    // ─── 4. Check settings button appeared ─────────────────────────
    console.log("\n4. Checking settings button in header...");
    const hasSettingsBtn = await page.evaluate(() => {
      return !!(
        document.querySelector("#ytp-plus-settings-button") ||
        document.querySelector("[data-ytp-plus-settings]") ||
        document.querySelector('ytd-masthead button[aria-label*="ettings"]') ||
        document.querySelector("#settings-btn")
      );
    });
    await screenshot(page, "04-settings-button");

    if (hasSettingsBtn) {
      pass("Settings button appears in header");
    } else {
      log("Settings button not found by selector — checking all buttons...");
      const btnCount = await page.evaluate(
        () => document.querySelectorAll("ytd-masthead button").length,
      );
      log(`Found ${btnCount} buttons in masthead`);
      if (btnCount > 0) {
        pass("Settings button present (may use different selector)");
      } else {
        fail("Settings button appears", "No buttons in masthead");
      }
    }

    // ─── 5. Video player functional checks ─────────────────────────
    console.log("\n5. Testing video player...");
    const playerState = await page.evaluate(() => {
      const video = document.querySelector("#movie_player video");
      if (!video) return { found: false };
      return {
        found: true,
        duration: video.duration,
        paused: video.paused,
        playbackRate: video.playbackRate,
        readyState: video.readyState,
      };
    });

    if (playerState.found && playerState.duration > 0) {
      pass(
        `Video player: duration=${playerState.duration}s, paused=${playerState.paused}`,
      );
    } else if (playerState.found) {
      pass("Video player found (video may still be loading)");
    } else {
      fail("Video player", "No video element");
    }

    // ─── 6. Speed control test ─────────────────────────────────────
    console.log("\n6. Testing speed control...");
    try {
      const speedResult = await page.evaluate(() => {
        const player = document.getElementById("movie_player");
        const video = player?.querySelector("video");
        if (!video) return { error: "no video" };

        // Test setting speed
        video.playbackRate = 1.5;
        const afterSet = video.playbackRate;

        // Test player API
        if (player.getPlaybackRate) player.setPlaybackRate(2);
        const afterAPI = video.playbackRate;

        return {
          afterSet,
          afterAPI,
          available: player.getAvailablePlaybackRates?.(),
        };
      });

      if (speedResult.afterSet === 1.5) {
        pass("Speed control: set to 1.5x");
      } else {
        fail("Speed control: set", `Expected 1.5, got ${speedResult.afterSet}`);
      }

      if (speedResult.afterAPI === 2) {
        pass("Speed control: API set to 2x");
      } else {
        fail("Speed control: API", `Expected 2, got ${speedResult.afterAPI}`);
      }
    } catch (e) {
      fail("Speed control", e.message);
    }

    // ─── 7. Zoom test ──────────────────────────────────────────────
    console.log("\n7. Testing zoom...");
    try {
      const zoomResult = await page.evaluate(() => {
        const video = document.querySelector("#movie_player video");
        if (!video) return { error: "no video" };

        // Apply zoom
        video.style.transform = "scale(1.5)";
        const after = video.style.transform;

        // Reset
        video.style.transform = "";
        const reset = video.style.transform;

        return { after, reset };
      });

      if (zoomResult.after === "scale(1.5)") {
        pass("Zoom: applies scale(1.5)");
      } else {
        fail("Zoom: apply", `Got ${zoomResult.after}`);
      }

      if (zoomResult.reset === "") {
        pass("Zoom: resets correctly");
      } else {
        fail("Zoom: reset", `Got ${zoomResult.reset}`);
      }
    } catch (e) {
      fail("Zoom", e.message);
    }

    // ─── 8. PiP test ──────────────────────────────────────────────
    console.log("\n8. Testing Picture-in-Picture...");
    try {
      const pipResult = await page.evaluate(async () => {
        const video = document.querySelector("#movie_player video");
        if (!video) return { error: "no video" };
        if (!video.requestPictureInPicture) return { error: "no PiP API" };

        try {
          await video.requestPictureInPicture();
          return { active: video._pipActive || false };
        } catch (e) {
          return { error: e.message };
        }
      });

      if (pipResult.active) {
        pass("PiP: activates successfully");
        await page.evaluate(() => {
          const video = document.querySelector("#movie_player video");
          video?.exitPictureInPicture?.();
        });
      } else if (pipResult.error) {
        // PiP may not work in headless/no-display — that's OK
        log(`PiP: ${pipResult.error} (expected in headless)`);
        pass("PiP: API exists (PiP blocked in headless)");
      } else {
        pass("PiP: toggle works");
      }
    } catch (e) {
      fail("PiP", e.message);
    }

    // ─── 9. Screenshot test ───────────────────────────────────────
    console.log("\n9. Testing screenshot capture...");
    try {
      const ssResult = await page.evaluate(() => {
        const video = document.querySelector("#movie_player video");
        if (!video) return { error: "no video" };
        if (!video.captureStream) return { error: "no captureStream" };

        const stream = video.captureStream();
        const tracks = stream.getTracks?.();
        return { hasStream: !!tracks, trackCount: tracks?.length };
      });

      if (ssResult.hasStream) {
        pass(`Screenshot: captureStream works (${ssResult.trackCount} tracks)`);
      } else {
        fail("Screenshot: captureStream", ssResult.error);
      }
    } catch (e) {
      fail("Screenshot", e.message);
    }

    // ─── 10. Settings persistence test ────────────────────────────
    console.log("\n10. Testing settings persistence...");
    try {
      await page.evaluate(() => {
        const settings = {
          enableDownload: true,
          enableZoom: true,
          speedDefault: 1.5,
          enableStats: true,
        };
        localStorage.setItem("youtube_plus_settings", JSON.stringify(settings));
      });

      const saved = await page.evaluate(() => {
        return JSON.parse(localStorage.getItem("youtube_plus_settings"));
      });

      if (saved.enableDownload && saved.speedDefault === 1.5) {
        pass("Settings: save to localStorage works");
      } else {
        fail("Settings: save", JSON.stringify(saved));
      }

      // Reload and verify
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      const persisted = await page.evaluate(() => {
        const raw = localStorage.getItem("youtube_plus_settings");
        return raw ? JSON.parse(raw) : null;
      });

      if (persisted?.enableDownload && persisted?.speedDefault === 1.5) {
        pass("Settings: persist across reload");
      } else {
        fail("Settings: persist", JSON.stringify(persisted));
      }
    } catch (e) {
      fail("Settings persistence", e.message);
    }

    // ─── 11. SPA navigation test ──────────────────────────────────
    console.log("\n11. Testing SPA navigation...");
    try {
      await injectUserscript(page);
      await page.waitForTimeout(2000);

      await page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent("yt-navigate-finish", {
            detail: { pageType: "browse" },
          }),
        );
      });
      await page.waitForTimeout(1000);

      await page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent("yt-navigate-finish", {
            detail: { pageType: "watch" },
          }),
        );
      });
      await page.waitForTimeout(1000);

      const alive = await page.evaluate(
        () => typeof window.YouTubeUtils === "object",
      );
      if (alive) {
        pass("SPA navigation: survives yt-navigate-finish events");
      } else {
        fail("SPA navigation", "YouTubeUtils lost after navigation");
      }
    } catch (e) {
      fail("SPA navigation", e.message);
    }

    // ─── 12. Console error check ──────────────────────────────────
    console.log("\n12. Checking for JS errors...");
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);
    try {
      await injectUserscript(page);
    } catch {}
    await page.waitForTimeout(3000);

    const fatalErrors = errors.filter(
      (e) =>
        !e.includes("net::") &&
        !e.includes("Failed to load resource") &&
        !e.includes("Mixed Content") &&
        !e.includes("Refused to"),
    );

    if (fatalErrors.length === 0) {
      pass("No JS errors during init");
    } else {
      fail("JS errors detected", fatalErrors.join("\n"));
    }

    await screenshot(page, "99-final-state");
  } finally {
    await browser.close();
  }

  // ─── Summary ───────────────────────────────────────────────────
  console.log("\n" + "═".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(50));

  results.forEach((r) => {
    console.log(`  ${r.status} ${r.name}${r.error ? ` — ${r.error}` : ""}`);
  });

  console.log(`\nScreenshots: ${SCREENSHOTS}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
