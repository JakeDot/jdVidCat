const statusNode = document.getElementById("status");
const maxDownloadsNode = document.getElementById("maxDownloads");
const startButton = document.getElementById("startBtn");

chrome.storage.sync.get(["maxDownloads"], ({ maxDownloads }) => {
  if (typeof maxDownloads === "number" && maxDownloads > 0) {
    maxDownloadsNode.value = maxDownloads;
  }
});

function setStatus(text) {
  statusNode.textContent = text;
}

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
