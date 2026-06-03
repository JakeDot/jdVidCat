# jdVidCat

<img alt="logo" src="https://raw.githubusercontent.com/JakeDot/jdVidCat/refs/heads/main/icons/jdVidCat.svg" />

JakeDot Video Category Downloader

## jdVidCat browser extension

`jdVidCat` is a Manifest V3 browser extension that:

- Starts from the **current tab URL**.
- Crawls category/tag pages with pagination.
- Auto-detects likely video URLs and downloads them.
- Captures JavaScript-created `blob:` video URLs from the active tab and downloads those too.
- Uses a default download limit of **100** videos.

### Load locally

1. Open Chromium-based browser extensions page (`chrome://extensions`).
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this repository folder.
4. Open a category/tag page and click the `jdVidCat` extension popup button.

### Build artifacts

A GitHub Actions workflow in `.github/workflows/build.yml` validates the extension files and creates three distribution formats:
- `jdVidCat.zip` - Generic extension package
- `jdVidCat.xpi` - Firefox add-on format
- `jdVidCat-chrome.zip` - Chrome extension format

### Release workflow

To create a new release with automatic version bumping:

1. Go to **Actions** → **Manual Release** workflow
2. Click **Run workflow**
3. Select version bump type:
   - `patch` - for bug fixes (0.1.5 → 0.1.6)
   - `minor` - for new features (0.1.5 → 0.2.0)
   - `major` - for breaking changes (0.1.5 → 1.0.0)
4. Optionally add release notes
5. Click **Run workflow**

The workflow will:
- Bump the version in `manifest.json`
- Create a commit and tag
- Push to the main branch
- Create a GitHub Release with build artifacts (XPI, Chrome ZIP, source ZIP)
- Trigger automatic publishing to Chrome Web Store and Firefox Add-ons (if secrets are configured)

**Note:** The automatic version bump on every main push has been disabled by default. To re-enable it for a specific commit, include `[auto-version-bump]` in the commit message.
