/**
 * @jest-environment node
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("manifest metadata validation", () => {
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  test("uses manifest version 3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  test("includes Firefox gecko metadata", () => {
    expect(manifest.browser_specific_settings?.gecko?.id).toBe("jdvidcat@jakedot.net");
    expect(manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required).toEqual(["none"]);
  });

  test("uses a service worker background script", () => {
    expect(manifest.background?.service_worker).toBe("background.js");
    expect(manifest.background?.scripts).toBeUndefined();
  });
});
