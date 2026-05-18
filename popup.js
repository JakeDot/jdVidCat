/**
 * jdVidCat – Popup Script
 *
 * Displays captured stream manifest URLs and lets the user manually
 * send individual or all URLs to JDownloader.
 */

const urlListEl = document.getElementById("urlList");
const emptyMsgEl = document.getElementById("emptyMsg");
const countEl = document.getElementById("count");
const clearBtn = document.getElementById("clearBtn");
const sendAllBtn = document.getElementById("sendAllBtn");
const statusBar = document.getElementById("statusBar");

/** Format a Unix timestamp as a human-readable relative time string. */
function relativeTime(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds <= 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** Returns the likely type label for a manifest URL. */
function manifestType(url) {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return "HLS";
  if (lower.includes(".mpd")) return "DASH";
  return "Stream";
}

/** Send a single URL to JDownloader via the background service worker. */
function sendOne(url, btn) {
  btn.disabled = true;
  btn.textContent = "Sending…";
  setStatus(`Sending to JDownloader…`);

  chrome.runtime.sendMessage({ action: "sendToJDownloader", url }, () => {
    btn.textContent = "Sent ✓";
    setStatus("Sent to JDownloader.");
  });
}

/** Update the status bar text (auto-clears after 3 s). */
let statusTimer = null;
function setStatus(text) {
  statusBar.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusBar.textContent = "Ready";
  }, 3000);
}

/** Render the list of captured URLs. */
function renderList(entries) {
  // Remove all existing <li> elements (but keep #emptyMsg)
  Array.from(urlListEl.querySelectorAll("li:not(#emptyMsg)")).forEach((el) =>
    el.remove()
  );

  if (!entries || entries.length === 0) {
    emptyMsgEl.style.display = "";
    countEl.textContent = "0";
    sendAllBtn.disabled = true;
    return;
  }

  emptyMsgEl.style.display = "none";
  countEl.textContent = String(entries.length);
  sendAllBtn.disabled = false;

  entries.forEach(({ url, ts }) => {
    const li = document.createElement("li");

    const info = document.createElement("div");
    info.className = "url-info";

    const urlSpan = document.createElement("span");
    urlSpan.className = "url-text";
    urlSpan.textContent = url;
    urlSpan.title = url;

    const meta = document.createElement("span");
    meta.className = "url-meta";
    meta.textContent = `${manifestType(url)} · ${relativeTime(ts)}`;

    info.appendChild(urlSpan);
    info.appendChild(meta);

    const btn = document.createElement("button");
    btn.className = "send-btn";
    btn.textContent = "Send";
    btn.dataset.url = url;
    btn.addEventListener("click", () => sendOne(url, btn));

    li.appendChild(info);
    li.appendChild(btn);
    urlListEl.appendChild(li);
  });
}

/** Load captured URLs from the background service worker. */
function loadUrls() {
  chrome.runtime.sendMessage({ action: "getCapturedUrls" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus("Error: " + chrome.runtime.lastError.message);
      return;
    }
    renderList(response ? response.urls : []);
  });
}

// ---- Event listeners -------------------------------------------------------

clearBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "clearCapturedUrls" }, () => {
    renderList([]);
    setStatus("List cleared.");
  });
});

sendAllBtn.addEventListener("click", () => {
  const btns = Array.from(urlListEl.querySelectorAll(".send-btn"));
  btns.forEach((btn) => {
    if (!btn.disabled) {
      const url = btn.dataset.url;
      sendOne(url, btn);
    }
  });
});

// Initial load
loadUrls();
