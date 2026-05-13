export type VisionSettingsV1 = {
  version: 1;
  /** Auto-send vision frames at interval */
  enabled: boolean;
  /** 5-180 seconds */
  intervalSec: number;
  /** Optional instruction text to send with the image */
  prompt: string;
  /** If true, request a vision frame when user sends a text message */
  sendWithUserMessage: boolean;
  /** If true, skip sending when frame is (almost) unchanged */
  skipIfUnchanged: boolean;
  /** 0-1 threshold for change detection (higher = less sensitive) */
  changeThreshold: number;
  /** Max width for JPEG frame sent to LLM (downscaled from capture) */
  captureMaxWidth: number;
  /** Max height for JPEG frame */
  captureMaxHeight: number;
  /** JPEG quality 0.35–0.95 */
  jpegQuality: number;
  /** Preview area max height in px */
  previewMaxHeightPx: number;
};

export const VISION_SETTINGS_STORAGE_KEY = 'react-vrm-vision-settings-v1';

export const DEFAULT_VISION_SETTINGS: VisionSettingsV1 = {
  version: 1,
  enabled: false,
  intervalSec: 30,
  prompt: '',
  sendWithUserMessage: false,
  skipIfUnchanged: true,
  changeThreshold: 0.02,
  captureMaxWidth: 1280,
  captureMaxHeight: 720,
  jpegQuality: 0.82,
  previewMaxHeightPx: 220,
};

export function clampVisionIntervalSec(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VISION_SETTINGS.intervalSec;
  return Math.min(180, Math.max(5, Math.round(v)));
}

export function clampChangeThreshold(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VISION_SETTINGS.changeThreshold;
  return Math.min(0.2, Math.max(0, v));
}

export function clampCaptureMaxWidth(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VISION_SETTINGS.captureMaxWidth;
  return Math.min(1920, Math.max(320, Math.round(v / 16) * 16));
}

export function clampCaptureMaxHeight(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VISION_SETTINGS.captureMaxHeight;
  return Math.min(1080, Math.max(180, Math.round(v / 16) * 16));
}

export function clampJpegQuality(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VISION_SETTINGS.jpegQuality;
  return Math.min(0.95, Math.max(0.35, Math.round(v * 100) / 100));
}

export function clampPreviewMaxHeightPx(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VISION_SETTINGS.previewMaxHeightPx;
  return Math.min(520, Math.max(120, Math.round(v)));
}

/** オブジェクトを正規化したビジョン設定（バックアップ・localStorage 共通） */
export function reconcileVisionSettingsFromUnknown(raw: unknown): VisionSettingsV1 {
  if (raw == null || typeof raw !== 'object') {
    return DEFAULT_VISION_SETTINGS;
  }
  const parsed = raw as Partial<VisionSettingsV1>;
  if (parsed.version !== 1) {
    return DEFAULT_VISION_SETTINGS;
  }
  return {
    ...DEFAULT_VISION_SETTINGS,
    ...parsed,
    intervalSec: clampVisionIntervalSec(Number(parsed.intervalSec)),
    changeThreshold: clampChangeThreshold(Number(parsed.changeThreshold)),
    prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
    enabled: !!parsed.enabled,
    sendWithUserMessage: !!parsed.sendWithUserMessage,
    skipIfUnchanged: parsed.skipIfUnchanged !== false,
    captureMaxWidth: clampCaptureMaxWidth(Number(parsed.captureMaxWidth)),
    captureMaxHeight: clampCaptureMaxHeight(Number(parsed.captureMaxHeight)),
    jpegQuality: clampJpegQuality(Number(parsed.jpegQuality)),
    previewMaxHeightPx: clampPreviewMaxHeightPx(Number(parsed.previewMaxHeightPx)),
  };
}

export function loadVisionSettings(): VisionSettingsV1 {
  try {
    const raw = localStorage.getItem(VISION_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_VISION_SETTINGS;
    return reconcileVisionSettingsFromUnknown(JSON.parse(raw));
  } catch {
    return DEFAULT_VISION_SETTINGS;
  }
}

export function saveVisionSettings(next: VisionSettingsV1): void {
  try {
    localStorage.setItem(VISION_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

