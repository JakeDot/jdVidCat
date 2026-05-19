const DEFAULT_MAX_DOWNLOADS = 100;
const VIDEO_EXTENSIONS = ["mp4", "m4v", "webm", "mov", "mkv", "avi", "m3u8"];
const MAX_HISTORY_ENTRIES = 100;
const MAX_PREVIEW_LINKS_RATIO = 0.2; // 20% of max downloads for preview links to prevent excessive crawling while still discovering content

// Configuration for smart link traversal
const PREVIEW_LINK_PATTERNS = [
  /preview/i,
  /thumbnail/i,
  /thumb/i,
  /poster/i,
  /snapshot/i
];

function normalizeUrl(value) {
  if (!value) {
    return null;
  }
  return value.replace(/\\u0026/g, "&").replace(/\\\//g, "/").trim();
}

function toAbsolute(baseUrl, candidate) {
  const normalizedCandidate = normalizeUrl(candidate);
  if (!normalizedCandidate) {
    return null;
  }
  try {
    return new URL(normalizedCandidate, baseUrl).href;
  } catch {
    return null;
  }
}

function extractVideoUrls(baseUrl, htmlText) {
  const found = new Set();
  const directPattern = /(?:src|href|content|data-src)=["']([^"']+)["']/gi;
  const loosePattern = /(https?:\/\/[^\s"'<>]+|\/[^\s"'<>]+)/gi;

  for (const pattern of [directPattern, loosePattern]) {
    let match;
    while ((match = pattern.exec(htmlText)) !== null) {
      const absolute = toAbsolute(baseUrl, match[1]);
      if (!absolute) {
        continue;
      }

      const lower = absolute.toLowerCase();
      if (VIDEO_EXTENSIONS.some((ext) => lower.includes(`.${ext}`)) || lower.includes("mime=video") || lower.includes("/video/")) {
        found.add(absolute);
      }
    }
  }

  return [...found];
}

function extractVideoPreviewUrls(baseUrl, htmlText, rootOrigin) {
  const links = new Set();
  const hrefPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;

  let match;
  while ((match = hrefPattern.exec(htmlText)) !== null) {
    const absolute = toAbsolute(baseUrl, match[1]);
    if (!absolute) {
      continue;
    }

    try {
      const parsed = new URL(absolute);
      const looksLikePreview = PREVIEW_LINK_PATTERNS.some((pattern) => pattern.test(absolute));

      if (parsed.origin === rootOrigin && looksLikePreview) {
        links.add(parsed.href);
      }
    } catch {
      // ignore invalid links
    }
  }

  return [...links];
}

function extractPaginationUrls(baseUrl, htmlText, rootOrigin) {
  const links = new Set();
  const hrefPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;

  let match;
  while ((match = hrefPattern.exec(htmlText)) !== null) {
    const absolute = toAbsolute(baseUrl, match[1]);
    if (!absolute) {
      continue;
    }

    try {
      const parsed = new URL(absolute);
      const looksLikePagination =
        /([?&]page=\d+)/i.test(parsed.search) ||
        /\/page\/\d+/i.test(parsed.pathname) ||
        /\bnext\b/i.test(absolute);

      if (parsed.origin === rootOrigin && looksLikePagination) {
        links.add(parsed.href);
      }
    } catch {
      // ignore invalid pagination links
    }
  }

  return [...links];
}

function filenameFromUrl(url, index, extensionFallback = "mp4") {
  try {
    const parsed = new URL(url);
    const pathName = parsed.pathname.split("/").filter(Boolean).pop() || `video-${index + 1}.${extensionFallback}`;
    const cleaned = pathName.replace(/[^a-zA-Z0-9._-]/g, "-");
    return `jdCatVid/${String(index + 1).padStart(3, "0")}-${cleaned}`;
  } catch {
    return `jdCatVid/${String(index + 1).padStart(3, "0")}-video.${extensionFallback}`;
  }
}

async function collectBlobUrlsFromTab(tabId) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const value = window.__jdCatVidBlobUrls;
        return Array.isArray(value) ? value : [];
      }
    });
    return injection?.result || [];
  } catch {
    return [];
  }
}

async function convertBlobToDataUrl(tabId, blobUrl) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [blobUrl],
    func: async (url) => {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Failed to read blob"));
          reader.readAsDataURL(blob);
        });
        return { ok: true, dataUrl, mime: blob.type || "video/mp4" };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
  });

  return result?.result || { ok: false, error: "Blob conversion script did not return data" };
}

async function downloadUrl(url, index) {
  const filename = filenameFromUrl(url, index);
  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
    await addDownloadToHistory(url, filename);
  } catch (error) {
    // Log error for debugging - failed downloads are not added to history
    console.warn("Download attempt failed for:", url, "Error:", error);
    // Users can manually retry failed downloads by copying the URL to the browser address bar
  }
}

async function startDownloadFromTab({ startUrl, tabId, maxDownloads = DEFAULT_MAX_DOWNLOADS }) {
  const max = Number.isFinite(maxDownloads) ? Math.max(1, Math.floor(maxDownloads)) : DEFAULT_MAX_DOWNLOADS;
  const maxPreviewLinks = Math.floor(max * MAX_PREVIEW_LINKS_RATIO);

  const visitedPages = new Set();
  const queuedUrls = new Set([startUrl]); // Track queued URLs to prevent duplicates
  const queuedPages = [startUrl];
  const videos = new Set();
  // Tracks preview links for status reporting and deduplication; persists throughout crawl
  // (unlike queuedUrls which removes URLs when pages are visited)
  const videoPreviewLinks = new Set();

  const rootOrigin = new URL(startUrl).origin;

  while (queuedPages.length > 0 && videos.size < max) {
    const current = queuedPages.shift();
    if (!current || visitedPages.has(current)) {
      continue;
    }

    visitedPages.add(current);
    queuedUrls.delete(current);

    try {
      const response = await fetch(current, { credentials: "include" });
      if (!response.ok) {
        continue;
      }

      const html = await response.text();
      
      // Extract video URLs directly from the page
      for (const videoUrl of extractVideoUrls(current, html)) {
        if (videos.size >= max) {
          break;
        }
        videos.add(videoUrl);
      }

      // Extract video preview links for traversal
      for (const previewUrl of extractVideoPreviewUrls(current, html, rootOrigin)) {
        if (!videoPreviewLinks.has(previewUrl) && videoPreviewLinks.size < maxPreviewLinks) {
          videoPreviewLinks.add(previewUrl);
          queuedUrls.add(previewUrl);
          queuedPages.push(previewUrl);
        }
      }

      // Extract pagination links
      for (const pageUrl of extractPaginationUrls(current, html, rootOrigin)) {
        if (!visitedPages.has(pageUrl) && !queuedUrls.has(pageUrl)) {
          queuedUrls.add(pageUrl);
          queuedPages.push(pageUrl);
        }
      }
    } catch {
      // ignore fetch failures for individual pages and continue crawl
    }
  }

  const normalVideoUrls = [...videos].slice(0, max);
  let downloaded = 0;

  for (const url of normalVideoUrls) {
    await downloadUrl(url, downloaded);
    downloaded += 1;
  }

  const remainingSlots = max - downloaded;
  if (remainingSlots > 0 && Number.isInteger(tabId)) {
    const blobUrls = await collectBlobUrlsFromTab(tabId);
    for (const blobUrl of blobUrls.slice(0, remainingSlots)) {
      const blobResult = await convertBlobToDataUrl(tabId, blobUrl);
      if (!blobResult.ok) {
        continue;
      }

      const filename = `jdCatVid/${String(downloaded + 1).padStart(3, "0")}-blob.mp4`;
      await chrome.downloads.download({
        url: blobResult.dataUrl,
        filename,
        saveAs: false,
        conflictAction: "uniquify"
      });
      await addDownloadToHistory(blobUrl, filename);
      downloaded += 1;
    }
  }

  return {
    downloaded,
    crawledPages: visitedPages.size,
    discoveredVideos: videos.size,
    previewLinksFollowed: videoPreviewLinks.size
  };
}

async function getDownloadHistory() {
  const { downloadHistory = [] } = await chrome.storage.local.get("downloadHistory");
  return downloadHistory;
}

async function addDownloadToHistory(url, filename) {
  const history = await getDownloadHistory();
  // Generate a more robust unique ID
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const randomHex = Array.from(randomBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  
  const entry = {
    id: `${Date.now()}-${randomHex}`,
    url,
    filename,
    timestamp: new Date().toISOString()
  };
  history.push(entry);
  // Keep only last MAX_HISTORY_ENTRIES downloads
  if (history.length > MAX_HISTORY_ENTRIES) {
    history.shift();
  }
  await chrome.storage.local.set({ downloadHistory: history });
  // Notify popup if open (popup might not be open, which is expected)
  chrome.runtime.sendMessage({ type: "jdcatvid:history-updated", history }).catch(() => {
    // Silently ignore errors - this is expected when popup is not open
  });
  return entry;
}

async function clearDownloadHistory() {
  await chrome.storage.local.set({ downloadHistory: [] });
}

async function ensureContextMenuExists() {
  try {
    // Remove all existing context menus to avoid duplicate ID errors
    await chrome.contextMenus.removeAll();
    // Create fresh context menu item
    chrome.contextMenus.create({
      id: "jdcatvid-download",
      title: "jdCatVid: Download videos from this page",
      contexts: ["page"]
    });
  } catch (error) {
    console.error("Failed to create context menu:", error);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  // Initialize storage on install only, not on every update
  if (details.reason === "install") {
    await chrome.storage.sync.set({ maxDownloads: DEFAULT_MAX_DOWNLOADS });
    await chrome.storage.local.set({ downloadHistory: [] });
  }
  
  // Ensure context menu exists on both install and update
  await ensureContextMenuExists();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "jdcatvid:get-history") {
    (async () => {
      const history = await getDownloadHistory();
      sendResponse({ ok: true, history });
    })();
    return true;
  }

  if (message?.type === "jdcatvid:clear-history") {
    (async () => {
      await clearDownloadHistory();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type !== "jdcatvid:start") {
    return;
  }

  (async () => {
    try {
      const result = await startDownloadFromTab(message.payload);
      sendResponse({ ok: true, result });
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
  })();

  return true;
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !tab?.url) {
    console.error("Context menu action failed: tab information unavailable");
    return;
  }

  if (info.menuItemId === "jdcatvid-download") {
    // Use saved max downloads setting
    const { maxDownloads = DEFAULT_MAX_DOWNLOADS } = await chrome.storage.sync.get("maxDownloads");
    try {
      await startDownloadFromTab({
        tabId: tab.id,
        startUrl: tab.url,
        maxDownloads
      });
    } catch (error) {
      console.error("Download failed:", error);
    }
  }
});
