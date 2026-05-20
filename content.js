(() => {
  const blobUrls = new Set();

  // Expose blob URLs via a non-writable, non-configurable getter so that
  // host-page scripts cannot replace or clear the array while the background
  // script can still read the live data via executeScript.
  let cachedArray = [];
  Object.defineProperty(window, "__jdCatVidBlobUrls", {
    get() {
      return cachedArray;
    },
    configurable: false,
    enumerable: false
  });

  function persistBlobUrl(value) {
    if (typeof value === "string" && value.startsWith("blob:")) {
      blobUrls.add(value);
      cachedArray = [...blobUrls];
    }
  }

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function createObjectURLProxy(object) {
    const result = originalCreateObjectURL(object);
    persistBlobUrl(result);
    return result;
  };

  const scanVideoElements = () => {
    document.querySelectorAll("video, source").forEach((node) => {
      persistBlobUrl(node.currentSrc || node.src || node.getAttribute("src"));
    });
  };

  const observer = new MutationObserver(scanVideoElements);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanVideoElements, { once: true });
  } else {
    scanVideoElements();
  }
})();
