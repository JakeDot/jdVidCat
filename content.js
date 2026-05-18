(() => {
  const blobUrls = new Set();

  function persistBlobUrl(value) {
    if (typeof value === "string" && value.startsWith("blob:")) {
      blobUrls.add(value);
      window.__jdCatVidBlobUrls = [...blobUrls];
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

  window.__jdCatVidBlobUrls = [...blobUrls];
})();
