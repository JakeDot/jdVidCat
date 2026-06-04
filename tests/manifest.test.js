/**
 * @jest-environment node
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("Metadata and Manifest Validation", () => {
  const manifestPath = path.join(__dirname, "../manifest.json");
  const packagePath = path.join(__dirname, "../package.json");

  test("manifest.json exists and is valid JSON", () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const content = fs.readFileSync(manifestPath, "utf8");
    let manifest;
    expect(() => {
      manifest = JSON.parse(content);
    }).not.toThrow();

    // Check basic manifest schema
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("jdVidCat");
    expect(typeof manifest.description).toBe("string");
    expect(manifest.description.trim().length).toBeGreaterThan(0);
  });

  test("manifest.json contains the correct Firefox Add-on ID", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    
    expect(manifest.browser_specific_settings).toBeDefined();
    expect(manifest.browser_specific_settings.gecko).toBeDefined();
    expect(manifest.browser_specific_settings.gecko.id).toBe("jdvidcat@jakedot.net");
    expect(manifest.browser_specific_settings.gecko.data_collection_permissions).toBeDefined();
    expect(manifest.browser_specific_settings.gecko.data_collection_permissions.required).toEqual(["none"]);
  });

  test("manifest.json background configuration contains service_worker and fallback scripts", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    expect(manifest.background).toBeDefined();
    expect(manifest.background.service_worker).toBe("background.js");
    expect(Array.isArray(manifest.background.scripts)).toBe(true);
    expect(manifest.background.scripts).toContain("background.js");
  });

  test("package.json exists and contains correct metadata", () => {
    expect(fs.existsSync(packagePath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

    expect(pkg.name).toBe("jdvidcat");
    expect(typeof pkg.description).toBe("string");
    expect(pkg.description.trim().length).toBeGreaterThan(0);
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts.test).toBe("jest");
  });

  test("extension icon files referenced in manifest exist on disk", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.icons).toBeDefined();

    for (const size of Object.keys(manifest.icons)) {
      const iconRelativePath = manifest.icons[size];
      const iconFullPath = path.join(__dirname, "..", iconRelativePath);
      expect(fs.existsSync(iconFullPath)).toBe(true);
    }
  });
});
