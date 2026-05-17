/**
 * jdVidCat - Background Service Worker
 *
 * Sniffs network traffic for HLS (.m3u8) and DASH (.mpd) stream manifests.
 * When a manifest URL is detected, it is handed off to JDownloader 2 via its
 * local Click'N'Load API running on http://127.0.0.1:9666.
 */

const JDOWNLOADER_API_URL = "http://127.0.0.1:9666/flash/add";

// Patterns that identify video stream manifests
const MANIFEST_PATTERNS = [".m3u8", ".mpd"];

// In-memory deduplication: maps tabId -> Set of already-seen manifest URLs.
// Cleared when the tab is closed or navigated away.
const seenUrls = new Map();

/**
 * Returns true if the request URL looks like an HLS or DASH manifest.
 * We deliberately exclude .ts segment URLs and only match playlist/manifest
 * files so that JDownloader receives the top-level URL it needs.
 * @param {string} url
 * @returns {boolean}
 */
function isManifestUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return MANIFEST_PATTERNS.some((ext) => pathname.includes(ext));
  } catch {
    return false;
  }
}

/**
 * Sends a manifest URL to JDownloader 2 via the Click'N'Load flash/add API.
 * JDownloader must be running with its built-in web server enabled (default
 * port 9666).
 * @param {string} manifestUrl - The stream manifest URL to add.
 * @param {string} packageName - Optional package name shown in JDownloader.
 */
async function sendToJDownloader(manifestUrl, packageName) {
  const params = new URLSearchParams();
  params.append("urls", manifestUrl);
  if (packageName) {
    params.append("packagename", packageName);
  }

  try {
    const response = await fetch(JDOWNLOADER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (response.ok) {
      console.log(`[jdVidCat] Sent to JDownloader: ${manifestUrl}`);
      showNotification(
        "Stream sent to JDownloader",
        `Added: ${manifestUrl}`
      );
    } else {
      console.warn(
        `[jdVidCat] JDownloader responded with ${response.status} for: ${manifestUrl}`
      );
    }
  } catch (err) {
    // JDownloader may not be running – log and notify without crashing.
    console.warn(
      `[jdVidCat] Could not reach JDownloader (is it running?): ${err.message}`
    );
    showNotification(
      "jdVidCat: JDownloader not reachable",
      "Make sure JDownloader 2 is running with Remote API enabled."
    );
  }
}

/**
 * Persists a captured URL to chrome.storage.session so the popup can display it.
 * @param {string} url
 * @param {number} tabId
 */
async function persistCapturedUrl(url, tabId) {
  const data = await chrome.storage.session.get({ capturedUrls: [] });
  const list = data.capturedUrls;

  // Avoid duplicates across the full persisted list
  if (!list.some((entry) => entry.url === url)) {
    list.unshift({ url, tabId, ts: Date.now() });
    // Keep at most 50 entries
    if (list.length > 50) {
      list.splice(50);
    }
    await chrome.storage.session.set({ capturedUrls: list });
  }
}

/**
 * Shows a browser notification (requires "notifications" permission).
 * @param {string} title
 * @param {string} message
 */
function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title,
    message,
  });
}

// ---------------------------------------------------------------------------
// webRequest listener – fires before each network request is sent
// ---------------------------------------------------------------------------
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { url, tabId } = details;

    if (!isManifestUrl(url)) {
      return;
    }

    // Per-tab deduplication
    if (!seenUrls.has(tabId)) {
      seenUrls.set(tabId, new Set());
    }
    const tabSeen = seenUrls.get(tabId);
    if (tabSeen.has(url)) {
      return;
    }
    tabSeen.add(url);

    console.log(`[jdVidCat] Detected manifest: ${url} (tab ${tabId})`);

    // Persist for popup display
    persistCapturedUrl(url, tabId);

    // Hand off to JDownloader
    sendToJDownloader(url);
  },
  { urls: ["<all_urls>"] }
);

// ---------------------------------------------------------------------------
// Clean up per-tab state when a tab is closed
// ---------------------------------------------------------------------------
chrome.tabs.onRemoved.addListener((tabId) => {
  seenUrls.delete(tabId);
});

// ---------------------------------------------------------------------------
// Clean up per-tab state on navigation (new page load in same tab)
// ---------------------------------------------------------------------------
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    seenUrls.delete(details.tabId);
  }
});

// ---------------------------------------------------------------------------
// Message handler for the popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "getCapturedUrls") {
    chrome.storage.session
      .get({ capturedUrls: [] })
      .then((data) => sendResponse({ urls: data.capturedUrls }));
    return true; // async response
  }

  if (request.action === "clearCapturedUrls") {
    chrome.storage.session.set({ capturedUrls: [] }).then(() => {
      seenUrls.clear();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (request.action === "sendToJDownloader") {
    sendToJDownloader(request.url).then(() => sendResponse({ ok: true }));
    return true;
  }
});
