# jdVidCat

**jdVidCat** is a Chrome extension (Manifest V3) that automatically detects HLS and DASH video stream manifests while you browse and hands their URLs off to [JDownloader 2](https://jdownloader.org/) for downloading.

## How It Works

Modern video streaming sites (Twitch, Vimeo, etc.) use `blob:` URLs backed by HLS (`.m3u8`) or DASH (`.mpd`) adaptive streams. These streams can be gigabytes in size, making in-browser downloading impractical. Instead, jdVidCat acts as a **network sniffer**:

1. It monitors all network requests using the `chrome.webRequest` API.
2. When it detects a request to an `.m3u8` (HLS) or `.mpd` (DASH) manifest, it captures the URL.
3. It immediately POSTs that URL to JDownloader 2's local **Click'N'Load** API (`http://127.0.0.1:9666/flash/add`), which queues the stream for download.
4. JDownloader 2 handles the download and stitching of stream segments into a single video file.

## Prerequisites

- [JDownloader 2](https://jdownloader.org/) must be installed and running.
- JDownloader's built-in web server must be enabled (it is on by default on port **9666**).  
  Enable it via: *Settings → Advanced Settings → Remote API → enabled = true*

## Installation

1. Download the latest `jdVidCat.zip` from the [Actions](../../actions) artifacts.
2. Unzip the file.
3. Open Chrome and go to `chrome://extensions/`.
4. Enable **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the unzipped folder.

## Usage

- Browse to any page with a video stream (e.g. Twitch, Vimeo, a sports site).
- jdVidCat will automatically detect and send manifest URLs to JDownloader 2.
- Click the extension icon to see all captured stream URLs in the popup.
- Use the **Send** button on any row to manually re-send a URL to JDownloader.
- Use **Send all to JDownloader** to queue every captured URL at once.
- Use **Clear list** to reset the captured URL list.

## Permissions Used

| Permission | Reason |
|---|---|
| `webRequest` | Monitor network traffic to find stream manifests |
| `webNavigation` | Reset per-tab deduplication on page navigation |
| `tabs` | Clean up state when a tab is closed |
| `storage` | Persist captured URLs for the popup |
| `notifications` | Notify when a stream is sent to JDownloader |
| `http://127.0.0.1:9666/*` | Communicate with JDownloader's local API |

## Building

```bash
zip -r jdVidCat.zip manifest.json background.js popup.html popup.js icons/
```

The CI workflow (`.github/workflows/build.yml`) validates all files and produces the `jdVidCat.zip` artifact on every push.
