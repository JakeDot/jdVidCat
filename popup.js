const statusNode = document.getElementById("status");
const maxDownloadsNode = document.getElementById("maxDownloads");
const startButton = document.getElementById("startBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyListNode = document.getElementById("historyList");

const MAX_PATHNAME_LENGTH = 50;
const MAX_URL_DISPLAY_LENGTH = 60;
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;
    
    // Remove active class from all tabs and contents
    tabButtons.forEach((b) => b.classList.remove("active"));
    tabContents.forEach((content) => content.classList.remove("active"));
    
    // Add active class to clicked tab and corresponding content
    btn.classList.add("active");
    document.getElementById(tabName).classList.add("active");
    
    // Load history when switching to history tab
    if (tabName === "history") {
      loadHistory();
    }
  });
});

chrome.storage.sync.get(["maxDownloads"], ({ maxDownloads }) => {
  if (typeof maxDownloads === "number" && maxDownloads > 0) {
    maxDownloadsNode.value = maxDownloads;
  }
});

function setStatus(text) {
  statusNode.textContent = text;
}

function buildJDownloaderLink(url) {
  // jDownloader supports the dlapi:// protocol handler for adding downloads
  // This requires jDownloader to be installed with the protocol handler registered
  // Only allow http/https/blob URLs to prevent passing unsafe schemes to external handlers
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "blob:") {
      return "#";
    }
  } catch {
    return "#";
  }
  return `dlapi://dl/${encodeURIComponent(url)}`;
}

function loadHistory() {
  chrome.runtime.sendMessage({ type: "jdcatvid:get-history" }, (response) => {
    if (chrome.runtime.lastError) {
      historyListNode.innerHTML = '<div class="empty-history">Error loading history</div>';
      return;
    }

    const history = response?.history || [];
    
    if (history.length === 0) {
      historyListNode.innerHTML = '<div class="empty-history">No downloads yet</div>';
      return;
    }

    // Clear previous history
    historyListNode.innerHTML = "";
    
    // Build and append elements
    history
      .slice()
      .reverse()
      .forEach((entry) => {
        let displayUrl = "Unknown";
        try {
          const url = new URL(entry.url);
          const origPathLen = url.pathname.length;
          const pathPart = url.pathname.substring(0, MAX_PATHNAME_LENGTH);
          displayUrl = url.hostname + pathPart + (origPathLen > MAX_PATHNAME_LENGTH ? "..." : "");
        } catch {
          // Handle invalid URLs (e.g., blob URLs, malformed URLs)
          displayUrl = entry.url.substring(0, MAX_URL_DISPLAY_LENGTH) + (entry.url.length > MAX_URL_DISPLAY_LENGTH ? "..." : "");
        }
        const timestamp = new Date(entry.timestamp).toLocaleString();
        const jdLink = buildJDownloaderLink(entry.url);
        
        // Create elements safely to prevent XSS
        const item = document.createElement("div");
        item.className = "history-item";
        
        const titleEl = document.createElement("div");
        titleEl.className = "history-item-title";
        titleEl.textContent = entry.filename;
        
        const metaUrlEl = document.createElement("div");
        metaUrlEl.className = "history-item-meta";
        metaUrlEl.textContent = displayUrl;
        
        const metaTimeEl = document.createElement("div");
        metaTimeEl.className = "history-item-meta";
        metaTimeEl.textContent = timestamp;
        
        const linkEl = document.createElement("a");
        linkEl.href = jdLink;
        linkEl.className = "history-item-link";
        linkEl.title = "Open in jDownloader (if not installed, use the Browser Download link below)";
        linkEl.target = "_blank";
        linkEl.textContent = "Open in jDownloader";
        
        item.appendChild(titleEl);
        item.appendChild(metaUrlEl);
        item.appendChild(metaTimeEl);
        item.appendChild(linkEl);
        
        // Add fallback browser download link for non-blob URLs
        if (!entry.url.startsWith("blob:")) {
          const browserLink = document.createElement("a");
          browserLink.href = entry.url;
          browserLink.className = "history-item-link";
          browserLink.title = "Browser download (fallback if jDownloader unavailable)";
          browserLink.target = "_blank";
          browserLink.textContent = "Browser Download";
          item.appendChild(browserLink);
        }
        
        historyListNode.appendChild(item);
      });
  });
}

clearHistoryBtn.addEventListener("click", () => {
  if (confirm("Are you sure you want to clear download history?")) {
    chrome.runtime.sendMessage({ type: "jdcatvid:clear-history" }, () => {
      loadHistory();
    });
  }
});

startButton.addEventListener("click", async () => {
  const rawValue = Number.parseInt(maxDownloadsNode.value, 10);
  const maxDownloads = Number.isNaN(rawValue) || rawValue <= 0 ? 100 : Math.min(rawValue, 10000);
  maxDownloadsNode.value = maxDownloads;
  chrome.storage.sync.set({ maxDownloads });

  setStatus("Reading current tab...");

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id || !activeTab.url) {
    setStatus("Unable to detect current tab URL.");
    return;
  }

  setStatus("Crawling pages and preparing downloads...");

  chrome.runtime.sendMessage(
    {
      type: "jdcatvid:start",
      payload: {
        tabId: activeTab.id,
        startUrl: activeTab.url,
        maxDownloads
      }
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setStatus(`Failed: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (!response?.ok) {
        setStatus(`Failed: ${response?.error || "Unknown error"}`);
        return;
      }

      const { downloaded, crawledPages, discoveredVideos, previewLinksFollowed } = response.result;
      const details = `${downloaded} video(s) from ${crawledPages} page(s) - ${discoveredVideos} links found, ${previewLinksFollowed} preview link(s) followed`;
      setStatus(`Downloaded ${details}.`);
    }
  );
});

// Listen for history updates from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "jdcatvid:history-updated") {
    // Refresh history if history tab is visible
    const historyTab = document.getElementById("history");
    if (historyTab.classList.contains("active")) {
      loadHistory();
    }
  }
});
