/**
 * @jest-environment node
 */
"use strict";

// ── Chrome API mock (must be set up before requiring background.js) ──────────
let mockLocalStorage = {};

const mockChrome = {
  storage: {
    local: {
      get: jest.fn((key) => {
        if (typeof key === "string") {
          const result = {};
          if (key in mockLocalStorage) result[key] = mockLocalStorage[key];
          return Promise.resolve(result);
        }
        if (Array.isArray(key)) {
          const result = {};
          for (const k of key) {
            if (k in mockLocalStorage) result[k] = mockLocalStorage[k];
          }
          return Promise.resolve(result);
        }
        return Promise.resolve({ ...mockLocalStorage });
      }),
      set: jest.fn((data) => {
        Object.assign(mockLocalStorage, data);
        return Promise.resolve();
      })
    },
    sync: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined)
    }
  },
  downloads: {
    download: jest.fn().mockResolvedValue(1)
  },
  scripting: {
    executeScript: jest.fn().mockResolvedValue([{ result: [] }])
  },
  runtime: {
    sendMessage: jest.fn().mockResolvedValue({}),
    onInstalled: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    lastError: null
  },
  contextMenus: {
    removeAll: jest.fn().mockResolvedValue(undefined),
    create: jest.fn(),
    onClicked: { addListener: jest.fn() }
  },
  tabs: {
    query: jest.fn().mockResolvedValue([])
  }
};

global.chrome = mockChrome;

const {
  normalizeUrl,
  toAbsolute,
  extractVideoUrls,
  extractVideoPreviewUrls,
  extractPaginationUrls,
  filenameFromUrl,
  convertBlobToDataUrl,
  getDownloadHistory,
  addDownloadToHistory,
  clearDownloadHistory,
  startDownloadFromTab,
  MAX_HISTORY_ENTRIES
} = require("../background.js");

beforeEach(() => {
  mockLocalStorage = {};
  // clearMocks: true in jest config handles mock.calls etc.
  // Re-wire storage mock after clearMocks (implementations are preserved by clearMocks)
});

// ── normalizeUrl ──────────────────────────────────────────────────────────────
describe("normalizeUrl", () => {
  test("returns null for null", () => {
    expect(normalizeUrl(null)).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(normalizeUrl(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(normalizeUrl("")).toBeNull();
  });

  test("decodes \\u0026 to &", () => {
    expect(normalizeUrl("a\\u0026b")).toBe("a&b");
  });

  test("decodes escaped forward slash", () => {
    expect(normalizeUrl("a\\/b")).toBe("a/b");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeUrl("  hello  ")).toBe("hello");
  });

  test("handles combined transformations", () => {
    expect(normalizeUrl("  a\\u0026b\\/c  ")).toBe("a&b/c");
  });

  test("returns unchanged normal strings", () => {
    expect(normalizeUrl("https://example.com/video.mp4")).toBe("https://example.com/video.mp4");
  });
});

// ── toAbsolute ────────────────────────────────────────────────────────────────
describe("toAbsolute", () => {
  const base = "https://example.com/page";

  test("returns null for null candidate", () => {
    expect(toAbsolute(base, null)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(toAbsolute(base, "")).toBeNull();
  });

  test("returns absolute https URL unchanged", () => {
    expect(toAbsolute(base, "https://cdn.example.com/video.mp4")).toBe("https://cdn.example.com/video.mp4");
  });

  test("returns absolute http URL unchanged", () => {
    expect(toAbsolute(base, "http://cdn.example.com/video.mp4")).toBe("http://cdn.example.com/video.mp4");
  });

  test("resolves root-relative path against base origin", () => {
    expect(toAbsolute(base, "/path/video.mp4")).toBe("https://example.com/path/video.mp4");
  });

  test("returns null for javascript: protocol", () => {
    expect(toAbsolute(base, "javascript:alert(1)")).toBeNull();
  });

  test("returns null for data: protocol", () => {
    expect(toAbsolute(base, "data:text/html,<h1>XSS</h1>")).toBeNull();
  });

  test("returns null for file: protocol", () => {
    expect(toAbsolute(base, "file:///etc/passwd")).toBeNull();
  });

  test("returns null for ftp: protocol", () => {
    expect(toAbsolute(base, "ftp://example.com/file.mp4")).toBeNull();
  });

  test("decodes \\u0026 in candidate before resolving", () => {
    const result = toAbsolute(base, "https://example.com/path?a=1\\u0026b=2");
    expect(result).toBe("https://example.com/path?a=1&b=2");
  });

  test("returns null when base itself is invalid and candidate is relative", () => {
    expect(toAbsolute("not-a-valid-base", "/path")).toBeNull();
  });
});

// ── extractVideoUrls ──────────────────────────────────────────────────────────
describe("extractVideoUrls", () => {
  const base = "https://example.com/page";

  test("finds mp4 in src attribute", () => {
    const html = `<video src="https://cdn.example.com/clip.mp4"></video>`;
    expect(extractVideoUrls(base, html)).toContain("https://cdn.example.com/clip.mp4");
  });

  test("finds webm in href attribute", () => {
    const html = `<a href="https://example.com/clip.webm">Video</a>`;
    expect(extractVideoUrls(base, html)).toContain("https://example.com/clip.webm");
  });

  test("finds mov in data-src attribute", () => {
    const html = `<source data-src="https://example.com/film.mov">`;
    expect(extractVideoUrls(base, html)).toContain("https://example.com/film.mov");
  });

  test("finds mkv in content attribute", () => {
    const html = `<meta content="https://example.com/video.mkv">`;
    expect(extractVideoUrls(base, html)).toContain("https://example.com/video.mkv");
  });

  test("finds avi extension", () => {
    const html = `<source src="https://example.com/video.avi">`;
    expect(extractVideoUrls(base, html)).toContain("https://example.com/video.avi");
  });

  test("finds m4v extension", () => {
    const html = `<source src="https://example.com/video.m4v">`;
    expect(extractVideoUrls(base, html)).toContain("https://example.com/video.m4v");
  });

  test("finds m3u8 extension", () => {
    const html = `<source src="https://example.com/stream.m3u8">`;
    expect(extractVideoUrls(base, html)).toContain("https://example.com/stream.m3u8");
  });

  test("finds URL with mime=video query param", () => {
    const html = `<source src="https://example.com/stream?mime=video/mp4">`;
    expect(extractVideoUrls(base, html)).toContain("https://example.com/stream?mime=video/mp4");
  });

  test("finds URL with /video/ path segment", () => {
    const html = `<a href="https://example.com/video/123">Watch</a>`;
    expect(extractVideoUrls(base, html)).toContain("https://example.com/video/123");
  });

  test("deduplicates identical URLs", () => {
    const html = `<video src="https://example.com/clip.mp4"></video><source src="https://example.com/clip.mp4">`;
    const urls = extractVideoUrls(base, html);
    expect(urls.filter((u) => u === "https://example.com/clip.mp4")).toHaveLength(1);
  });

  test("ignores non-video URLs", () => {
    const html = `<img src="https://example.com/image.jpg"><a href="https://example.com/page.html">Link</a>`;
    expect(extractVideoUrls(base, html)).toHaveLength(0);
  });

  test("resolves relative video paths against base", () => {
    const html = `<video src="/videos/clip.mp4">`;
    expect(extractVideoUrls(base, html)).toContain("https://example.com/videos/clip.mp4");
  });

  test("returns empty array for empty HTML", () => {
    expect(extractVideoUrls(base, "")).toHaveLength(0);
  });

  test("finds loose absolute URL not inside an attribute", () => {
    const html = `Download from https://example.com/film.mp4 here`;
    expect(extractVideoUrls(base, html)).toContain("https://example.com/film.mp4");
  });

  test("finds multiple different video URLs", () => {
    const html = `
      <video src="https://example.com/a.mp4"></video>
      <video src="https://example.com/b.webm"></video>
    `;
    const urls = extractVideoUrls(base, html);
    expect(urls).toContain("https://example.com/a.mp4");
    expect(urls).toContain("https://example.com/b.webm");
  });
});

// ── extractVideoPreviewUrls ───────────────────────────────────────────────────
describe("extractVideoPreviewUrls", () => {
  const base = "https://example.com/page";
  const rootOrigin = "https://example.com";

  test("finds links with 'preview' keyword in URL from same origin", () => {
    const html = `<a href="https://example.com/preview/123">Preview</a>`;
    expect(extractVideoPreviewUrls(base, html, rootOrigin)).toContain("https://example.com/preview/123");
  });

  test("finds links with 'thumbnail' keyword", () => {
    const html = `<a href="https://example.com/thumbnail-1">Thumbnail</a>`;
    expect(extractVideoPreviewUrls(base, html, rootOrigin)).toContain("https://example.com/thumbnail-1");
  });

  test("finds links with 'thumb' keyword", () => {
    const html = `<a href="https://example.com/thumb/video1">Thumb</a>`;
    expect(extractVideoPreviewUrls(base, html, rootOrigin)).toContain("https://example.com/thumb/video1");
  });

  test("finds links with 'poster' keyword", () => {
    const html = `<a href="https://example.com/poster-image">Poster</a>`;
    expect(extractVideoPreviewUrls(base, html, rootOrigin)).toContain("https://example.com/poster-image");
  });

  test("finds links with 'snapshot' keyword", () => {
    const html = `<a href="https://example.com/snapshots/vid">Snapshot</a>`;
    expect(extractVideoPreviewUrls(base, html, rootOrigin)).toContain("https://example.com/snapshots/vid");
  });

  test("excludes links from a different origin", () => {
    const html = `<a href="https://other.com/preview/123">Preview</a>`;
    expect(extractVideoPreviewUrls(base, html, rootOrigin)).toHaveLength(0);
  });

  test("excludes links that have no preview pattern", () => {
    const html = `<a href="https://example.com/normalpage">Normal</a>`;
    expect(extractVideoPreviewUrls(base, html, rootOrigin)).toHaveLength(0);
  });

  test("returns empty array for empty HTML", () => {
    expect(extractVideoPreviewUrls(base, "", rootOrigin)).toHaveLength(0);
  });

  test("deduplicates identical preview links", () => {
    const html = `
      <a href="https://example.com/preview/1">P1</a>
      <a href="https://example.com/preview/1">P1 again</a>
    `;
    const urls = extractVideoPreviewUrls(base, html, rootOrigin);
    expect(urls.filter((u) => u === "https://example.com/preview/1")).toHaveLength(1);
  });
});

// ── extractPaginationUrls ─────────────────────────────────────────────────────
describe("extractPaginationUrls", () => {
  const base = "https://example.com/page";
  const rootOrigin = "https://example.com";

  test("finds ?page=N query links", () => {
    const html = `<a href="https://example.com/list?page=2">2</a>`;
    expect(extractPaginationUrls(base, html, rootOrigin)).toContain("https://example.com/list?page=2");
  });

  test("finds /page/N path links", () => {
    const html = `<a href="https://example.com/category/page/3">3</a>`;
    expect(extractPaginationUrls(base, html, rootOrigin)).toContain("https://example.com/category/page/3");
  });

  test("finds links with 'next' keyword in URL", () => {
    const html = `<a href="https://example.com/list?next=true">Next</a>`;
    expect(extractPaginationUrls(base, html, rootOrigin)).toContain("https://example.com/list?next=true");
  });

  test("excludes pagination links from a different origin", () => {
    const html = `<a href="https://other.com/list?page=2">2</a>`;
    expect(extractPaginationUrls(base, html, rootOrigin)).toHaveLength(0);
  });

  test("excludes normal links with no pagination pattern", () => {
    const html = `<a href="https://example.com/about">About</a>`;
    expect(extractPaginationUrls(base, html, rootOrigin)).toHaveLength(0);
  });

  test("returns empty array for empty HTML", () => {
    expect(extractPaginationUrls(base, "", rootOrigin)).toHaveLength(0);
  });

  test("finds &page= inside a longer query string", () => {
    const html = `<a href="https://example.com/list?cat=video&page=2">2</a>`;
    expect(extractPaginationUrls(base, html, rootOrigin)).toContain(
      "https://example.com/list?cat=video&page=2"
    );
  });
});

// ── filenameFromUrl ───────────────────────────────────────────────────────────
describe("filenameFromUrl", () => {
  test("extracts filename and prefixes with padded index", () => {
    expect(filenameFromUrl("https://example.com/path/video.mp4", 0)).toBe("jdCatVid/001-video.mp4");
  });

  test("pads single-digit index to 3 digits", () => {
    expect(filenameFromUrl("https://example.com/vid.mp4", 9)).toBe("jdCatVid/010-vid.mp4");
  });

  test("pads two-digit index to 3 digits", () => {
    expect(filenameFromUrl("https://example.com/vid.mp4", 99)).toBe("jdCatVid/100-vid.mp4");
  });

  test("falls back to video-1.mp4 when URL path has no filename", () => {
    const result = filenameFromUrl("https://example.com/", 0);
    expect(result).toBe("jdCatVid/001-video-1.mp4");
  });

  test("replaces special characters in filename with dashes", () => {
    const result = filenameFromUrl("https://example.com/my%20video!.mp4", 0);
    expect(result).not.toContain(" ");
    expect(result).not.toContain("!");
    expect(result).toMatch(/^jdCatVid\/001-/);
  });

  test("truncates filename portion at 200 characters", () => {
    const longName = "a".repeat(250) + ".mp4";
    const result = filenameFromUrl(`https://example.com/${longName}`, 0);
    const filenamePart = result.replace("jdCatVid/001-", "");
    expect(filenamePart.length).toBeLessThanOrEqual(200);
  });

  test("uses default mp4 extensionFallback for invalid URL", () => {
    expect(filenameFromUrl("not-a-url", 0)).toBe("jdCatVid/001-video.mp4");
  });

  test("uses custom extensionFallback for invalid URL", () => {
    expect(filenameFromUrl("not-a-url", 0, "webm")).toBe("jdCatVid/001-video.webm");
  });
});

// ── getDownloadHistory ────────────────────────────────────────────────────────
describe("getDownloadHistory", () => {
  test("returns empty array when storage has no history", async () => {
    const history = await getDownloadHistory();
    expect(history).toEqual([]);
  });

  test("returns stored history entries", async () => {
    const entry = {
      id: "abc",
      url: "https://example.com/v.mp4",
      filename: "jdCatVid/001-v.mp4",
      timestamp: new Date().toISOString()
    };
    mockLocalStorage.downloadHistory = [entry];
    const history = await getDownloadHistory();
    expect(history).toEqual([entry]);
  });

  test("returns multiple entries in order", async () => {
    const entries = [
      { id: "1", url: "https://example.com/a.mp4", filename: "jdCatVid/001-a.mp4", timestamp: "" },
      { id: "2", url: "https://example.com/b.mp4", filename: "jdCatVid/002-b.mp4", timestamp: "" }
    ];
    mockLocalStorage.downloadHistory = entries;
    const history = await getDownloadHistory();
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe("1");
    expect(history[1].id).toBe("2");
  });
});

// ── addDownloadToHistory ──────────────────────────────────────────────────────
describe("addDownloadToHistory", () => {
  test("returns an entry with all required fields", async () => {
    const entry = await addDownloadToHistory("https://example.com/video.mp4", "jdCatVid/001-video.mp4");
    expect(entry).toMatchObject({
      url: "https://example.com/video.mp4",
      filename: "jdCatVid/001-video.mp4"
    });
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("persists the entry to chrome.storage.local", async () => {
    await addDownloadToHistory("https://example.com/video.mp4", "jdCatVid/001-video.mp4");
    const history = await getDownloadHistory();
    expect(history).toHaveLength(1);
    expect(history[0].url).toBe("https://example.com/video.mp4");
  });

  test("appends to existing history", async () => {
    mockLocalStorage.downloadHistory = [
      { id: "1", url: "https://example.com/old.mp4", filename: "jdCatVid/001-old.mp4", timestamp: "" }
    ];
    await addDownloadToHistory("https://example.com/new.mp4", "jdCatVid/002-new.mp4");
    const history = await getDownloadHistory();
    expect(history).toHaveLength(2);
  });

  test("caps history at MAX_HISTORY_ENTRIES by dropping oldest", async () => {
    mockLocalStorage.downloadHistory = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, i) => ({
      id: String(i),
      url: `https://example.com/video-${i}.mp4`,
      filename: `jdCatVid/${i}-video.mp4`,
      timestamp: ""
    }));
    await addDownloadToHistory("https://example.com/new.mp4", "jdCatVid/001-new.mp4");
    const history = await getDownloadHistory();
    expect(history).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(history[history.length - 1].url).toBe("https://example.com/new.mp4");
  });

  test("sends history-updated message to runtime after adding", async () => {
    await addDownloadToHistory("https://example.com/video.mp4", "jdCatVid/001-video.mp4");
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "jdcatvid:history-updated" })
    );
  });

  test("each entry gets a unique id", async () => {
    const e1 = await addDownloadToHistory("https://example.com/a.mp4", "a");
    const e2 = await addDownloadToHistory("https://example.com/b.mp4", "b");
    expect(e1.id).not.toBe(e2.id);
  });
});

// ── clearDownloadHistory ──────────────────────────────────────────────────────
describe("clearDownloadHistory", () => {
  test("removes all history entries", async () => {
    mockLocalStorage.downloadHistory = [
      { id: "1", url: "x", filename: "y", timestamp: "z" }
    ];
    await clearDownloadHistory();
    expect(await getDownloadHistory()).toEqual([]);
  });

  test("works correctly when history is already empty", async () => {
    await clearDownloadHistory();
    expect(await getDownloadHistory()).toEqual([]);
  });
});

// ── convertBlobToDataUrl ──────────────────────────────────────────────────────
describe("convertBlobToDataUrl", () => {
  test("returns error object for a non-blob URL string", async () => {
    const result = await convertBlobToDataUrl(1, "https://example.com/video.mp4");
    expect(result).toEqual({ ok: false, error: "Not a valid blob URL" });
  });

  test("returns error object for null input", async () => {
    const result = await convertBlobToDataUrl(1, null);
    expect(result).toEqual({ ok: false, error: "Not a valid blob URL" });
  });

  test("returns error object for empty string", async () => {
    const result = await convertBlobToDataUrl(1, "");
    expect(result).toEqual({ ok: false, error: "Not a valid blob URL" });
  });

  test("calls executeScript for a valid blob: URL", async () => {
    const mockResult = { ok: true, dataUrl: "data:video/mp4;base64,AAAA", mime: "video/mp4" };
    mockChrome.scripting.executeScript.mockResolvedValue([{ result: mockResult }]);
    const result = await convertBlobToDataUrl(1, "blob:https://example.com/abc");
    expect(result).toEqual(mockResult);
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 1 } })
    );
  });

  test("returns fallback error when executeScript yields no result", async () => {
    mockChrome.scripting.executeScript.mockResolvedValue([null]);
    const result = await convertBlobToDataUrl(1, "blob:https://example.com/abc");
    expect(result).toEqual({ ok: false, error: "Blob conversion script did not return data" });
  });
});

// ── startDownloadFromTab ──────────────────────────────────────────────────────
describe("startDownloadFromTab", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    mockChrome.downloads.download.mockResolvedValue(1);
    mockChrome.scripting.executeScript.mockResolvedValue([{ result: [] }]);
    // Suppress expected console.warn output produced by intentional fetch-failure tests
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("downloads a video found in the page HTML", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(`<video src="https://example.com/video.mp4"></video>`)
    });
    const result = await startDownloadFromTab({
      startUrl: "https://example.com/page",
      tabId: 1,
      maxDownloads: 10
    });
    expect(result.downloaded).toBe(1);
    expect(result.crawledPages).toBe(1);
    expect(result.discoveredVideos).toBe(1);
    expect(mockChrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/video.mp4", saveAs: false })
    );
  });

  test("returns zero downloads for a page with no video URLs", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html><body>No videos here</body></html>")
    });
    const result = await startDownloadFromTab({
      startUrl: "https://example.com/page",
      tabId: 1,
      maxDownloads: 10
    });
    expect(result.downloaded).toBe(0);
    expect(mockChrome.downloads.download).not.toHaveBeenCalled();
  });

  test("respects the maxDownloads limit", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(`
          <video src="https://example.com/v1.mp4"></video>
          <video src="https://example.com/v2.mp4"></video>
          <video src="https://example.com/v3.mp4"></video>
        `)
    });
    const result = await startDownloadFromTab({
      startUrl: "https://example.com/page",
      tabId: 1,
      maxDownloads: 2
    });
    expect(result.downloaded).toBe(2);
    expect(mockChrome.downloads.download).toHaveBeenCalledTimes(2);
  });

  test("uses DEFAULT_MAX_DOWNLOADS when maxDownloads is NaN", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(`<video src="https://example.com/vid.mp4"></video>`)
    });
    const result = await startDownloadFromTab({
      startUrl: "https://example.com/page",
      maxDownloads: NaN
    });
    expect(result.downloaded).toBe(1);
  });

  test("handles a fetch error gracefully without throwing", async () => {
    global.fetch.mockRejectedValue(new Error("Network error"));
    const result = await startDownloadFromTab({
      startUrl: "https://example.com/page",
      tabId: 1,
      maxDownloads: 10
    });
    expect(result.downloaded).toBe(0);
    expect(result.crawledPages).toBe(1);
  });

  test("handles a non-ok HTTP response without throwing", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404 });
    const result = await startDownloadFromTab({
      startUrl: "https://example.com/page",
      tabId: 1,
      maxDownloads: 10
    });
    expect(result.downloaded).toBe(0);
  });

  test("downloads blob URLs when regular video slots remain", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html></html>")
    });
    mockChrome.scripting.executeScript
      .mockResolvedValueOnce([{ result: ["blob:https://example.com/blob1"] }])
      .mockResolvedValueOnce([{ result: { ok: true, dataUrl: "data:video/mp4;base64,X", mime: "video/mp4" } }]);

    const result = await startDownloadFromTab({
      startUrl: "https://example.com/page",
      tabId: 1,
      maxDownloads: 5
    });
    expect(result.downloaded).toBe(1);
    expect(mockChrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: "data:video/mp4;base64,X" })
    );
  });

  test("skips blob URL when conversion fails", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html></html>")
    });
    mockChrome.scripting.executeScript
      .mockResolvedValueOnce([{ result: ["blob:https://example.com/blob1"] }])
      .mockResolvedValueOnce([{ result: { ok: false, error: "fetch failed" } }]);

    const result = await startDownloadFromTab({
      startUrl: "https://example.com/page",
      tabId: 1,
      maxDownloads: 5
    });
    expect(result.downloaded).toBe(0);
  });

  test("return value contains all expected stat fields", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(`<video src="https://example.com/v.mp4"></video>`)
    });
    const result = await startDownloadFromTab({
      startUrl: "https://example.com/page",
      maxDownloads: 5
    });
    expect(result).toHaveProperty("downloaded");
    expect(result).toHaveProperty("crawledPages");
    expect(result).toHaveProperty("discoveredVideos");
    expect(result).toHaveProperty("previewLinksFollowed");
  });

  test("does not attempt blob collection when tabId is not an integer", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html></html>")
    });
    await startDownloadFromTab({
      startUrl: "https://example.com/page",
      tabId: undefined,
      maxDownloads: 5
    });
    // executeScript (used by collectBlobUrlsFromTab) should not have been called
    expect(mockChrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});
