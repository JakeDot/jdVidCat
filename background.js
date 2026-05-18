const DEFAULT_MAX_DOWNLOADS = 100;
const VIDEO_EXTENSIONS = ["mp4", "m4v", "webm", "mov", "mkv", "avi", "m3u8"];

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
  await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
  await addDownloadToHistory(url, filename);
}

async function startDownloadFromTab({ startUrl, tabId, maxDownloads = DEFAULT_MAX_DOWNLOADS }) {
  const max = Number.isFinite(maxDownloads) ? Math.max(1, Math.floor(maxDownloads)) : DEFAULT_MAX_DOWNLOADS;

  const visitedPages = new Set();
  const queuedPages = [startUrl];
  const videos = new Set();

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
      for (const videoUrl of extractVideoUrls(current, html)) {
        if (videos.size >= max) {
          break;
        }
        videos.add(videoUrl);
      }

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
    discoveredVideos: videos.size
  };
}

async function getDownloadHistory() {
  const { downloadHistory = [] } = await chrome.storage.local.get("downloadHistory");
  return downloadHistory;
}

async function addDownloadToHistory(url, filename) {
  const history = await getDownloadHistory();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    url,
    filename,
    timestamp: new Date().toISOString(),
    status: "completed"
  };
  history.push(entry);
  // Keep only last 100 downloads
  if (history.length > 100) {
    history.shift();
  }
  await chrome.storage.local.set({ downloadHistory: history });
  // Notify popup if open
  chrome.runtime.sendMessage({ type: "jdcatvid:history-updated", history }).catch(() => {});
  return entry;
}

async function clearDownloadHistory() {
  await chrome.storage.local.set({ downloadHistory: [] });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ maxDownloads: DEFAULT_MAX_DOWNLOADS });
  chrome.storage.local.set({ downloadHistory: [] });
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
