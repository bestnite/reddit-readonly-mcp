import { describe, expect, it } from "vitest";
import { ANDROID_APP_VERSION_LIST } from "../src/auth/android-app-versions.js";
import { createAndroidDevice, getProcessDevice, MEDIA_CODEC_VARIANTS } from "../src/auth/device.js";

describe("android device identity", () => {
  it("ships the 150 real app versions copied from redlib", () => {
    expect(ANDROID_APP_VERSION_LIST).toHaveLength(150);
    for (const v of ANDROID_APP_VERSION_LIST) expect(v).toMatch(/^Version \d{4}\.\d+\.\d+\/Build \d+$/);
  });

  it("builds the redlib header set with one uuid for vendor and device id", () => {
    for (let i = 0; i < 200; i++) {
      const d = createAndroidDevice();
      const h = d.headers;
      expect(h["User-Agent"]).toMatch(/^Reddit\/Version \d{4}\.\d+\.\d+\/Build \d+\/Android (9|1[0-4])$/);
      expect(ANDROID_APP_VERSION_LIST).toContain(d.appVersion);
      expect(d.androidVersion).toBeGreaterThanOrEqual(9);
      expect(d.androidVersion).toBeLessThanOrEqual(14);
      expect(h["x-reddit-retry"]).toBe("algo=no-retries");
      expect(h["x-reddit-compression"]).toBe("1");
      expect(h["x-reddit-qos"]).toMatch(/^\d{1,3}\.\d{3}$/);
      const qos = Number(h["x-reddit-qos"]);
      expect(qos).toBeGreaterThanOrEqual(1);
      expect(qos).toBeLessThanOrEqual(100);
      expect(MEDIA_CODEC_VARIANTS).toContain(h["x-reddit-media-codecs"]);
      expect(h["Content-Type"]).toBe("application/json; charset=UTF-8");
      expect(h["client-vendor-id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(h["X-Reddit-Device-Id"]).toBe(h["client-vendor-id"]);
      expect(d.uuid).toBe(h["client-vendor-id"]);
    }
  });

  it("covers the extremes of the random ranges", () => {
    const lo = createAndroidDevice(() => 0);
    const hi = createAndroidDevice(() => 0.999999);
    expect(lo.androidVersion).toBe(9);
    expect(hi.androidVersion).toBe(14);
    expect(lo.headers["x-reddit-qos"]).toBe("1.000");
    expect(hi.headers["x-reddit-qos"]).toBe("100.000");
    expect(lo.appVersion).toBe(ANDROID_APP_VERSION_LIST[0]);
    expect(hi.appVersion).toBe(ANDROID_APP_VERSION_LIST[149]);
  });

  it("generates the process device once", () => {
    expect(getProcessDevice()).toBe(getProcessDevice());
  });
});
