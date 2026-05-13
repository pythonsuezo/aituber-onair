import type { AppSettings } from '../types/settings';
import {
  reconcileVisionSettingsFromUnknown,
  saveVisionSettings,
} from '../visionSettings';
import { getAppWindowMode, publishVrmControl } from '../windowMode';
import { clearStoredVrm, loadStoredVrmBuffer, saveVrmBuffer } from './vrmBlobStorage';

const BACKUP_FORMAT_VERSION = 1 as const;
const ORBIT_KEY_PREFIX = 'react-vrm-orbit-camera-v1:';

export type AppBackupFileV1 = {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  /** 識別用（手編集しない想定） */
  source: 'aituber-react-vrm-app';
  appSettings: AppSettings;
  visionSettings: unknown;
  /** `react-vrm-orbit-camera-v1:*` のみ */
  orbitCameras: Record<string, string>;
  /** IndexedDB のカスタム VRM。無い場合は `null`（同梱モデル相当） */
  customVrmBase64: string | null;
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}

function collectOrbitCameraKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(ORBIT_KEY_PREFIX)) {
        continue;
      }
      const v = localStorage.getItem(k);
      if (v) {
        out[k] = v;
      }
    }
  } catch {
    // ignore
  }
  return out;
}

export async function buildAppBackupFileV1(
  appSettings: AppSettings,
  visionSettingsRaw: unknown,
): Promise<AppBackupFileV1> {
  const buf = await loadStoredVrmBuffer();
  const customVrmBase64 =
    buf && buf.byteLength > 0 ? arrayBufferToBase64(buf) : null;
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    source: 'aituber-react-vrm-app',
    appSettings,
    visionSettings: visionSettingsRaw,
    orbitCameras: collectOrbitCameraKeys(),
    customVrmBase64,
  };
}

export function downloadAppBackupJson(payload: AppBackupFileV1): void {
  const mode = getAppWindowMode();
  const stamp = payload.exportedAt.replace(/[:.]/g, '-').slice(0, 19);
  const name = `aituber-react-vrm-backup-${mode}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function isLikelyAppSettings(v: unknown): v is AppSettings {
  if (!isRecord(v)) return false;
  return (
    isRecord(v.llm)
    && isRecord(v.visual)
    && isRecord(v.tts)
    && isRecord(v.stream)
  );
}

/**
 * パース済みのバックアップオブジェクトを適用する（ファイル／復元ポイント共通）。
 */
export async function restoreAppBackupFromObject(
  parsed: unknown,
  applySettingsFromBackup: (raw: unknown) => void,
): Promise<{ ok: true; reloadSuggested: boolean } | { ok: false; message: string }> {
  if (!isRecord(parsed)) {
    return { ok: false, message: 'バックアップの形式が不正です。' };
  }
  if (parsed.formatVersion !== BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      message: `未対応のバックアップ形式です（formatVersion: ${String(parsed.formatVersion)}）。`,
    };
  }
  if (parsed.source !== 'aituber-react-vrm-app') {
    return { ok: false, message: 'このアプリ用のバックアップではありません。' };
  }
  if (!isLikelyAppSettings(parsed.appSettings)) {
    return { ok: false, message: 'appSettings が欠損しているか壊れています。' };
  }

  try {
    saveVisionSettings(
      reconcileVisionSettingsFromUnknown(parsed.visionSettings),
    );
  } catch {
    return { ok: false, message: 'ビジョン設定のリストアに失敗しました。' };
  }

  if ('orbitCameras' in parsed && isRecord(parsed.orbitCameras)) {
    try {
      for (const [k, v] of Object.entries(parsed.orbitCameras)) {
        if (!k.startsWith(ORBIT_KEY_PREFIX) || typeof v !== 'string') {
          continue;
        }
        localStorage.setItem(k, v);
      }
    } catch {
      return { ok: false, message: 'カメラ位置（orbit）のリストアに失敗しました。' };
    }
  }

  try {
    if ('customVrmBase64' in parsed) {
      if (
        typeof parsed.customVrmBase64 === 'string'
        && parsed.customVrmBase64.length > 0
      ) {
        const buf = base64ToArrayBuffer(parsed.customVrmBase64);
        if (!buf || buf.byteLength === 0) {
          return {
            ok: false,
            message: 'カスタム VRM（Base64）のデコードに失敗しました。',
          };
        }
        await saveVrmBuffer(buf);
      } else if (parsed.customVrmBase64 === null) {
        await clearStoredVrm();
      }
    }
  } catch {
    return { ok: false, message: 'カスタム VRM のリストアに失敗しました。' };
  }

  try {
    applySettingsFromBackup(parsed.appSettings);
  } catch {
    return { ok: false, message: 'アプリ設定の適用に失敗しました。' };
  }

  publishVrmControl({ action: 'reload' });

  return { ok: true, reloadSuggested: true };
}

/**
 * バックアップ JSON を適用する。`applySettingsFromBackup` は React 側の `useSettings` から渡す。
 * 戻り値の `reloadSuggested` が true のとき、別ウィンドウやビジョン状態のため再読み込み推奨。
 */
export async function restoreAppBackupFromJson(
  jsonText: string,
  applySettingsFromBackup: (raw: unknown) => void,
): Promise<{ ok: true; reloadSuggested: boolean } | { ok: false; message: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return { ok: false, message: 'JSON の解析に失敗しました。' };
  }
  return restoreAppBackupFromObject(parsed, applySettingsFromBackup);
}
