/**
 * @jest-environment jsdom
 */
"use strict";

const fs = require("fs");
const path = require("path");

const contentCode = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");

// Track calls to the original createObjectURL so tests can inspect them.
let mockCreateObjectURL;
let blobCounter = 0;

beforeAll(() => {
  mockCreateObjectURL = jest.fn(() => `blob:https://example.com/${++blobCounter}`);
  URL.createObjectURL = mockCreateObjectURL;

  // eslint-disable-next-line no-eval
  eval(contentCode);
});

// ── __jdCatVidBlobUrls property descriptor ────────────────────────────────────
describe("__jdCatVidBlobUrls property", () => {
  test("is defined on window after content.js loads", () => {
    expect(window.__jdCatVidBlobUrls).toBeDefined();
  });

  test("is an array", () => {
    expect(Array.isArray(window.__jdCatVidBlobUrls)).toBe(true);
  });

  test("is non-configurable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "__jdCatVidBlobUrls");
    expect(descriptor.configurable).toBe(false);
  });

  test("is non-enumerable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "__jdCatVidBlobUrls");
    expect(descriptor.enumerable).toBe(false);
  });

  test("throws when an attempt is made to redefine it", () => {
    expect(() => {
      Object.defineProperty(window, "__jdCatVidBlobUrls", {
        value: ["overwritten"],
        configurable: true
      });
    }).toThrow();
  });
});

// ── URL.createObjectURL proxy ─────────────────────────────────────────────────
describe("URL.createObjectURL proxy", () => {
  test("replaces the original createObjectURL with a proxy", () => {
    expect(URL.createObjectURL).not.toBe(mockCreateObjectURL);
  });

  test("the proxy still calls the original and returns a blob: URL", () => {
    const callsBefore = mockCreateObjectURL.mock.calls.length;
    const result = URL.createObjectURL(new Blob(["test-data"]));
    expect(mockCreateObjectURL.mock.calls.length).toBe(callsBefore + 1);
    expect(result).toMatch(/^blob:/);
  });

  test("blob: URLs returned by createObjectURL are captured in __jdCatVidBlobUrls", () => {
    const url = URL.createObjectURL(new Blob(["capture-test"]));
    expect(window.__jdCatVidBlobUrls).toContain(url);
  });

  test("non-blob: return values are not stored", () => {
    // Force the underlying mock to return a non-blob URL for one call
    mockCreateObjectURL.mockReturnValueOnce("https://not-a-blob.com/resource");
    const lengthBefore = window.__jdCatVidBlobUrls.length;
    URL.createObjectURL(new Blob(["non-blob-result"]));
    expect(window.__jdCatVidBlobUrls.length).toBe(lengthBefore);
  });

  test("duplicate blob: URLs are stored only once (Set deduplication)", () => {
    const fixedUrl = "blob:https://example.com/deduplicated-url";
    mockCreateObjectURL.mockReturnValueOnce(fixedUrl);
    URL.createObjectURL(new Blob(["dup-a"]));
    const lengthAfterFirst = window.__jdCatVidBlobUrls.length;

    mockCreateObjectURL.mockReturnValueOnce(fixedUrl);
    URL.createObjectURL(new Blob(["dup-b"]));
    // Length must not increase because the URL is already in the Set
    expect(window.__jdCatVidBlobUrls.length).toBe(lengthAfterFirst);
  });

  test("__jdCatVidBlobUrls getter returns a fresh array snapshot each time", () => {
    const snap1 = window.__jdCatVidBlobUrls;
    URL.createObjectURL(new Blob(["snapshot-test"]));
    const snap2 = window.__jdCatVidBlobUrls;
    // The references are different objects (new array each time)
    expect(snap2).not.toBe(snap1);
    expect(snap2.length).toBe(snap1.length + 1);
  });
});

// ── DOM scanning for video elements ──────────────────────────────────────────
describe("DOM scanning for video/source elements", () => {
  const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

  afterAll(async () => {
    // Clear the DOM and flush pending MutationObserver callbacks
    // before jsdom tears down to avoid "Cannot log after tests are done" noise.
    document.body.innerHTML = "";
    await flushMicrotasks();
  });

  test("video element with blob src is captured via MutationObserver", async () => {
    const blobUrl = "blob:https://example.com/mo-video-1";
    const video = document.createElement("video");
    video.setAttribute("src", blobUrl);
    document.body.appendChild(video);
    await flushMicrotasks();
    expect(window.__jdCatVidBlobUrls).toContain(blobUrl);
  });

  test("source element with blob src is captured via MutationObserver", async () => {
    const blobUrl = "blob:https://example.com/mo-source-1";
    const source = document.createElement("source");
    source.setAttribute("src", blobUrl);
    document.body.appendChild(source);
    await flushMicrotasks();
    expect(window.__jdCatVidBlobUrls).toContain(blobUrl);
  });

  test("non-blob src on a video element is not stored", async () => {
    const lengthBefore = window.__jdCatVidBlobUrls.length;
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/video.mp4");
    document.body.appendChild(video);
    await flushMicrotasks();
    // May or may not have grown, but should not contain the https URL
    expect(window.__jdCatVidBlobUrls).not.toContain("https://example.com/video.mp4");
  });

  test("video element src attribute change is detected", async () => {
    const blobUrl = "blob:https://example.com/attr-change-1";
    const video = document.createElement("video");
    document.body.appendChild(video);
    await flushMicrotasks();

    video.setAttribute("src", blobUrl);
    await flushMicrotasks();
    expect(window.__jdCatVidBlobUrls).toContain(blobUrl);
  });
});
