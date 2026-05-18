# jdCatVid

JakeDot Video Category Downloader

## jdCatVid browser extension

`jdCatVid` is a Manifest V3 browser extension that:

- Starts from the **current tab URL**.
- Crawls category/tag pages with pagination.
- Auto-detects likely video URLs and downloads them.
- Captures JavaScript-created `blob:` video URLs from the active tab and downloads those too.
- Uses a default download limit of **100** videos.

### Load locally

1. Open Chromium-based browser extensions page (`chrome://extensions`).
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this repository folder.
4. Open a category/tag page and click the `jdCatVid` extension popup button.

### Build artifacts

A GitHub Actions workflow in `.github/workflows/build.yml` validates the extension files and creates three distribution formats:
- `jdCatVid.zip` - Generic extension package
- `jdCatVid.xpi` - Firefox add-on format
- `jdCatVid-chrome.zip` - Chrome extension format
