// 模拟 Reddit 官方 Android 客户端的设备身份，移植自 redlib src/oauth.rs 的 Device::android()。
// 每个进程只生成一次（见 getProcessDevice），之后所有请求（含 token 请求）都复用同一身份。

import { randomUUID } from "node:crypto";
import { ANDROID_APP_VERSION_LIST } from "./android-app-versions.js";

export interface AndroidDevice {
  // client-vendor-id / X-Reddit-Device-Id 共用的 uuid v4
  uuid: string;
  // 例如 "Version 2024.22.1/Build 1652272"
  appVersion: string;
  androidVersion: number;
  userAgent: string;
  // 每个请求都要带上的 Android 请求头
  headers: Readonly<Record<string, string>>;
}

export type Random = () => number;

// 与 redlib 的 TextGenerator 模板 "available-codecs=video/avc, video/hevc{, video/x-vnd.on2.vp9|}" 等价
export const MEDIA_CODEC_VARIANTS = [
  "available-codecs=video/avc, video/hevc",
  "available-codecs=video/avc, video/hevc, video/x-vnd.on2.vp9",
] as const;

function pick<T>(list: readonly T[], rand: Random): T {
  const item = list[Math.floor(rand() * list.length) % list.length];
  if (item === undefined) throw new Error("pick() on empty list");
  return item;
}

// [min, max] 闭区间整数
function intIn(min: number, max: number, rand: Random): number {
  return min + Math.min(max - min, Math.floor(rand() * (max - min + 1)));
}

export function createAndroidDevice(rand: Random = Math.random, uuid: string = randomUUID()): AndroidDevice {
  const appVersion = pick(ANDROID_APP_VERSION_LIST, rand);
  const androidVersion = intIn(9, 14, rand);
  const userAgent = `Reddit/${appVersion}/Android ${androidVersion}`;
  // redlib: fastrand::u32(1000..=100_000) / 1000，保留三位小数
  const qos = (intIn(1000, 100_000, rand) / 1000).toFixed(3);
  const codecs = pick(MEDIA_CODEC_VARIANTS, rand);

  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    "x-reddit-retry": "algo=no-retries",
    "x-reddit-compression": "1",
    "x-reddit-qos": qos,
    "x-reddit-media-codecs": codecs,
    "Content-Type": "application/json; charset=UTF-8",
    "client-vendor-id": uuid,
    "X-Reddit-Device-Id": uuid,
  };
  return { uuid, appVersion, androidVersion, userAgent, headers: Object.freeze(headers) };
}

let processDevice: AndroidDevice | undefined;

// 进程级单例：同一进程内所有请求共用一个设备身份
export function getProcessDevice(): AndroidDevice {
  processDevice ??= createAndroidDevice();
  return processDevice;
}
