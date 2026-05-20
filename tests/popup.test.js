/**
 * @jest-environment jsdom
 */
"use strict";

// ── DOM setup (must precede requiring popup.js) ───────────────────────────────
document.body.innerHTML = `
  <p id="status">Ready</p>
  <input id="maxDownloads" type="number" value="100" />
  <button id="startBtn">Download</button>
  <button id="clearHistoryBtn" class="secondary">Clear History</button>
  <div id="historyList"></div>
  <button class="tab-btn active" data-tab="download">Download</button>
  <button class="tab-btn" data-tab="history">History</button>
  <div id="download" class="tab-content active"></div>
  <div id="history" class="tab-content"></div>
`;

// ── Chrome API mock (must precede requiring popup.js) ─────────────────────────
global.chrome = {
  storage: {
    sync: {
      // popup.js uses callback-style get
      get: jest.fn((keys, cb) => {
        if (typeof cb === "function") cb({ maxDownloads: 100 });
      }),
      set: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() },
    lastError: null
  },
  tabs: {
    query: jest.fn().mockResolvedValue([{ id: 1, url: "https://example.com/page" }])
  }
};

const { buildJDownloaderLink, setCopyButtonFeedback, setStatus } = require("../popup.js");

// ── buildJDownloaderLink ──────────────────────────────────────────────────────
describe("buildJDownloaderLink", () => {
  test("builds a dlapi:// link for an https URL", () => {
    const link = buildJDownloaderLink("https://example.com/video.mp4");
    expect(link).toBe(`dlapi://dl/${encodeURIComponent("https://example.com/video.mp4")}`);
  });

  test("builds a dlapi:// link for an http URL", () => {
    const link = buildJDownloaderLink("http://example.com/video.mp4");
    expect(link).toBe(`dlapi://dl/${encodeURIComponent("http://example.com/video.mp4")}`);
  });

  test("builds a dlapi:// link for a blob: URL", () => {
    const link = buildJDownloaderLink("blob:https://example.com/abc123");
    expect(link).toBe(`dlapi://dl/${encodeURIComponent("blob:https://example.com/abc123")}`);
  });

  test("returns '#' for a javascript: URL", () => {
    expect(buildJDownloaderLink("javascript:alert(1)")).toBe("#");
  });

  test("returns '#' for a file: URL", () => {
    expect(buildJDownloaderLink("file:///etc/passwd")).toBe("#");
  });

  test("returns '#' for a data: URL", () => {
    expect(buildJDownloaderLink("data:text/html,<h1>XSS</h1>")).toBe("#");
  });

  test("returns '#' for an entirely invalid URL string", () => {
    expect(buildJDownloaderLink("not a url at all")).toBe("#");
  });

  test("percent-encodes special characters in the URL", () => {
    const url = "https://example.com/video?a=1&b=2";
    const link = buildJDownloaderLink(url);
    expect(link).toBe(`dlapi://dl/${encodeURIComponent(url)}`);
    expect(link).toContain("%3A"); // colon is encoded
  });
});

// ── setStatus ─────────────────────────────────────────────────────────────────
describe("setStatus", () => {
  test("updates the #status element text", () => {
    setStatus("Crawling pages...");
    expect(document.getElementById("status").textContent).toBe("Crawling pages...");
  });

  test("clears the #status element text when given an empty string", () => {
    setStatus("some text");
    setStatus("");
    expect(document.getElementById("status").textContent).toBe("");
  });
});

// ── setCopyButtonFeedback ─────────────────────────────────────────────────────
describe("setCopyButtonFeedback", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("immediately updates the button label", () => {
    const btn = document.createElement("button");
    btn.textContent = "Copy URL";
    btn.dataset.originalLabel = "Copy URL";
    setCopyButtonFeedback(btn, "Copied!");
    expect(btn.textContent).toBe("Copied!");
  });

  test("restores the original label after the feedback duration", () => {
    const btn = document.createElement("button");
    btn.textContent = "Copy URL";
    btn.dataset.originalLabel = "Copy URL";
    setCopyButtonFeedback(btn, "Copied!");
    jest.advanceTimersByTime(1500);
    expect(btn.textContent).toBe("Copy URL");
  });

  test("cancels the previous timer when called again before it fires", () => {
    const btn = document.createElement("button");
    btn.textContent = "Copy URL";
    btn.dataset.originalLabel = "Copy URL";

    setCopyButtonFeedback(btn, "Copied!");
    jest.advanceTimersByTime(800);
    setCopyButtonFeedback(btn, "Failed");
    expect(btn.textContent).toBe("Failed");

    // The 1500 ms from the second call restores to original
    jest.advanceTimersByTime(1500);
    expect(btn.textContent).toBe("Copy URL");
  });

  test("falls back to 'Copy URL' label when data-originalLabel is absent", () => {
    const btn = document.createElement("button");
    btn.textContent = "Copy URL";
    // No dataset.originalLabel set
    setCopyButtonFeedback(btn, "Copied!");
    jest.advanceTimersByTime(1500);
    expect(btn.textContent).toBe("Copy URL");
  });
});

// ── Tab switching ─────────────────────────────────────────────────────────────
describe("Tab switching", () => {
  test("clicking a tab button makes it active", () => {
    const historyTabBtn = document.querySelector('[data-tab="history"]');
    historyTabBtn.click();
    expect(historyTabBtn.classList.contains("active")).toBe(true);
  });

  test("clicking a tab button deactivates other tab buttons", () => {
    const downloadTabBtn = document.querySelector('[data-tab="download"]');
    const historyTabBtn = document.querySelector('[data-tab="history"]');

    historyTabBtn.click();
    expect(downloadTabBtn.classList.contains("active")).toBe(false);

    downloadTabBtn.click();
    expect(historyTabBtn.classList.contains("active")).toBe(false);
  });

  test("clicking a tab shows its content panel", () => {
    const historyTabBtn = document.querySelector('[data-tab="history"]');
    historyTabBtn.click();
    expect(document.getElementById("history").classList.contains("active")).toBe(true);
  });

  test("clicking a tab hides other content panels", () => {
    const historyTabBtn = document.querySelector('[data-tab="history"]');
    historyTabBtn.click();
    expect(document.getElementById("download").classList.contains("active")).toBe(false);
  });
});

// ── loadHistory rendering ─────────────────────────────────────────────────────
describe("history tab: loadHistory rendering", () => {
  beforeEach(() => {
    document.getElementById("historyList").innerHTML = "";
    // Reset any previous sendMessage mock state
    jest.clearAllMocks();
    // Re-wire sync.get since clearMocks clears calls only (not implementations)
  });

  function triggerLoadHistory(historyEntries) {
    // Simulate clicking the history tab, which calls loadHistory()
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg.type === "jdcatvid:get-history" && typeof cb === "function") {
        cb({ ok: true, history: historyEntries });
      }
    });
    const historyTabBtn = document.querySelector('[data-tab="history"]');
    historyTabBtn.click();
  }

  test("shows 'No downloads yet' message when history is empty", () => {
    triggerLoadHistory([]);
    expect(document.getElementById("historyList").innerHTML).toContain("No downloads yet");
  });

  test("renders one item per history entry", () => {
    const entries = [
      {
        id: "1",
        url: "https://example.com/a.mp4",
        filename: "jdCatVid/001-a.mp4",
        timestamp: new Date().toISOString()
      },
      {
        id: "2",
        url: "https://example.com/b.mp4",
        filename: "jdCatVid/002-b.mp4",
        timestamp: new Date().toISOString()
      }
    ];
    triggerLoadHistory(entries);
    expect(document.querySelectorAll(".history-item")).toHaveLength(2);
  });

  test("shows filename in each history item", () => {
    triggerLoadHistory([
      {
        id: "1",
        url: "https://example.com/clip.mp4",
        filename: "jdCatVid/001-clip.mp4",
        timestamp: new Date().toISOString()
      }
    ]);
    expect(document.querySelector(".history-item-title").textContent).toBe("jdCatVid/001-clip.mp4");
  });

  test("renders items in reverse chronological order", () => {
    const entries = [
      { id: "1", url: "https://example.com/first.mp4", filename: "001", timestamp: new Date().toISOString() },
      { id: "2", url: "https://example.com/second.mp4", filename: "002", timestamp: new Date().toISOString() }
    ];
    triggerLoadHistory(entries);
    const titles = Array.from(document.querySelectorAll(".history-item-title")).map((el) => el.textContent);
    // Reversed: most recent (last in array) first
    expect(titles[0]).toBe("002");
    expect(titles[1]).toBe("001");
  });

  test("adds a Browser Download link for non-blob URLs", () => {
    triggerLoadHistory([
      { id: "1", url: "https://example.com/clip.mp4", filename: "001", timestamp: new Date().toISOString() }
    ]);
    const links = document.querySelectorAll(".history-item-link");
    const texts = Array.from(links).map((a) => a.textContent);
    expect(texts).toContain("Browser Download");
  });

  test("omits Browser Download link for blob: URLs", () => {
    triggerLoadHistory([
      {
        id: "1",
        url: "blob:https://example.com/abc",
        filename: "jdCatVid/001-blob.mp4",
        timestamp: new Date().toISOString()
      }
    ]);
    const links = document.querySelectorAll(".history-item-link");
    const texts = Array.from(links).map((a) => a.textContent);
    expect(texts).not.toContain("Browser Download");
  });

  test("shows 'Error loading history' when chrome.runtime.lastError is set", () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      // Simulate an error by setting lastError before calling cb
      Object.defineProperty(chrome.runtime, "lastError", {
        value: { message: "Extension context invalidated" },
        writable: true,
        configurable: true
      });
      if (typeof cb === "function") cb(null);
      Object.defineProperty(chrome.runtime, "lastError", {
        value: null,
        writable: true,
        configurable: true
      });
    });
    const historyTabBtn = document.querySelector('[data-tab="history"]');
    historyTabBtn.click();
    expect(document.getElementById("historyList").innerHTML).toContain("Error loading history");
  });
});
