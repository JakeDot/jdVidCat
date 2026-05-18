const DEFAULT_MAX_DOWNLOADS = 100;
const VIDEO_EXTENSIONS = ["mp4", "m4v", "webm", "mov", "mkv", "avi", "m3u8"];
const MAX_HISTORY_ENTRIES = 100;
const MAX_PREVIEW_LINKS_RATIO = 0.2; // 20% of max downloads for preview links

// Configuration for smart link traversal
const PREVIEW_LINK_PATTERNS = [
  /preview/i,
  /thumbnail/i,
  /thumb/i,
  /poster/i,
  /snapshot/i
];

const VIDEO_PREVIEW_SELECTORS = [
  'a[href*="preview"]',
  'a[href*="watch"]',
  'a[href*="video"]',
  'a[href*="play"]',
  '[data-video]',
  'a.video-link',
  'a.play-link'
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

async function downloadUrl(url, index, useFallback = true) {
  const filename = filenameFromUrl(url, index);
  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
  } catch (error) {
    // Log error but continue - download may fail due to various reasons
    // (protocol mismatch, network issues, etc.)
    console.warn("Download attempt failed for:", url, "Error:", error);
    // The browser's download API will attempt the download regardless
    // If it truly fails, the user can use the fallback browser download from history
  }
  await addDownloadToHistory(url, filename);
}

async function startDownloadFromTab({ startUrl, tabId, maxDownloads = DEFAULT_MAX_DOWNLOADS }) {
  const max = Number.isFinite(maxDownloads) ? Math.max(1, Math.floor(maxDownloads)) : DEFAULT_MAX_DOWNLOADS;

  const visitedPages = new Set();
  const queuedPages = [startUrl];
  const videos = new Set();
  const videoPreviewLinks = new Set();

  const rootOrigin = new URL(startUrl).origin;

  while (queuedPages.length > 0 && videos.size < max) {
    const current = queuedPages.shift();
    if (!current || visitedPages.has(current)) {
      continue;
    }

    visitedPages.add(current);

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
        if (!visitedPages.has(previewUrl) && videoPreviewLinks.size < max * MAX_PREVIEW_LINKS_RATIO) {
          videoPreviewLinks.add(previewUrl);
          queuedPages.push(previewUrl);
        }
      }

      // Extract pagination links
      for (const pageUrl of extractPaginationUrls(current, html, rootOrigin)) {
        if (!visitedPages.has(pageUrl)) {
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ maxDownloads: DEFAULT_MAX_DOWNLOADS });
  chrome.storage.local.set({ downloadHistory: [] });
  
  // Create context menu item
  chrome.contextMenus.create({
    id: "jdcatvid-download",
    title: "Download videos from this category/tag (jdCatVid)",
    contexts: ["page"]
  });
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
    console.error("Unable to get tab information");
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
