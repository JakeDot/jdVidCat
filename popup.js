const statusNode = document.getElementById("status");
const maxDownloadsNode = document.getElementById("maxDownloads");
const startButton = document.getElementById("startBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyListNode = document.getElementById("historyList");

// Tab functionality
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
  // jDownloader uses a protocol handler or can be called via URLs
  // The basic approach is to encode the URL for jDownloader
  return `dlapi://dl/${encodeURIComponent(url)}`;
}

async function loadHistory() {
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

    historyListNode.innerHTML = history
      .slice()
      .reverse()
      .map((entry) => {
        const url = new URL(entry.url);
        const displayUrl = url.hostname ? `${url.hostname}${url.pathname.substring(0, 50)}...` : entry.url.substring(0, 60) + "...";
        const timestamp = new Date(entry.timestamp).toLocaleString();
        const jdLink = buildJDownloaderLink(entry.url);
        
        return `
          <div class="history-item">
            <div class="history-item-title">${entry.filename}</div>
            <div class="history-item-meta">${displayUrl}</div>
            <div class="history-item-meta">${timestamp}</div>
            <a href="${jdLink}" class="history-item-link" title="Open in jDownloader">Open in jDownloader</a>
          </div>
        `;
      })
      .join("");
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
  const maxDownloads = Math.max(1, Number.parseInt(maxDownloadsNode.value, 10) || 100);
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

      const { downloaded, crawledPages, discoveredVideos } = response.result;
      setStatus(`Downloaded ${downloaded} videos (crawled ${crawledPages} pages, found ${discoveredVideos} links).`);
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
