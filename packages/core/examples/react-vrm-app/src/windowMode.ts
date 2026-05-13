import type {
  VrmChromaBgMode,
  VrmEmotionTuneMap,
  VrmExpressionBlendSettings,
  VrmExpressionNameOverrides,
  VrmLegacyExpressionSettings,
  VrmLightingSettings,
} from './types/settings';

export type AppWindowMode = 'combined' | 'chat' | 'stage' | 'vision';

/** `?window=chat` | `?window=stage` | `?window=vision` | (default) combined single-pane */
export function getAppWindowMode(): AppWindowMode {
  const v = new URLSearchParams(window.location.search).get('window');
  if (v === 'chat') {
    return 'chat';
  }
  if (v === 'stage') {
    return 'stage';
  }
  if (v === 'vision') {
    return 'vision';
  }
  return 'combined';
}

/** Window / document title (taskbar, OBS window picker, Electron title bar). */
export function getWindowTitleForMode(mode: AppWindowMode): string {
  switch (mode) {
    case 'chat':
      return 'AITuber | チャット（操作・設定）';
    case 'stage':
      return 'AITuber | VRM';
    case 'vision':
      return 'AITuber | ビジョン（プレビュー）';
    default:
      return 'AITuber | チャット + VRM';
  }
}

export const STAGE_LIPSYNC_CHANNEL = 'aituber-react-vrm-stage-lipsync';

/** `?window=stage` など別ウィンドウの VRM が、メイン側のプレビュー指示を受け取る */
export const STAGE_EMOTION_PREVIEW_CHANNEL =
  'aituber-react-vrm-stage-emotion-preview-v1';

/** 設定画面などから VRM 表情プレビューを指示（`window` に dispatch） */
export const VRM_EMOTION_PREVIEW_EVENT = 'aituber:vrm-emotion-preview';

export type VrmEmotionPreviewEventDetail = {
  /** `null` でプレビュー終了。`neutral` はニュートラル表情 */
  emotion: string | null;
  /** 省略時 12 秒 */
  durationMs?: number;
};

export type StageEmotionPreviewMessage = {
  type: 'emotion-preview';
  emotion: string | null;
  durationMs?: number;
};

/**
 * 同一タブの `AvatarBackground` 用に `window` へ dispatch しつつ、
 * ステージ専用ウィンドウ向けに BroadcastChannel でも送る。
 */
export function publishVrmEmotionPreview(detail: VrmEmotionPreviewEventDetail) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(VRM_EMOTION_PREVIEW_EVENT, {
        detail,
      }),
    );
  }

  try {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    const bc = new BroadcastChannel(STAGE_EMOTION_PREVIEW_CHANNEL);
    const msg: StageEmotionPreviewMessage = {
      type: 'emotion-preview',
      emotion: detail.emotion,
      durationMs: detail.durationMs,
    };
    bc.postMessage(msg);
    bc.close();
  } catch {
    // ignore BroadcastChannel / postMessage failures
  }
}

/** IndexedDB のカスタム VRM を読み直す／同梱モデルに戻す（`AvatarBackground` が購読） */
export const VRM_CONTROL_EVENT = 'aituber:vrm-control';

/** ステージ専用ウィンドウへ VRM 変更を伝える（同一オリジンのみ） */
export const STAGE_VRM_CONTROL_CHANNEL =
  'aituber-react-vrm-stage-vrm-control-v1';

export type StageVrmControlMessage = {
  type: 'vrm-control';
  action: 'reload' | 'bundled';
};

/**
 * 同一タブの `AvatarBackground` 用に `window` へ dispatch しつつ、
 * ステージ専用ウィンドウ向けに BroadcastChannel でも送る。
 */
export function publishVrmControl(detail: { action: 'reload' | 'bundled' }) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VRM_CONTROL_EVENT, { detail }));
  }

  try {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    const bc = new BroadcastChannel(STAGE_VRM_CONTROL_CHANNEL);
    const msg: StageVrmControlMessage = {
      type: 'vrm-control',
      action: detail.action,
    };
    bc.postMessage(msg);
    bc.close();
  } catch {
    // ignore
  }
}

export const VISION_CHANNEL = 'aituber-react-vrm-vision-channel-v1';

export type StageLipsyncMessage = {
  type: 'lipsync';
  mouthLevel: number;
  isSpeaking: boolean;
  /** 感情タグ（例: happy）に応じた表情。未指定はニュートラル扱い */
  assistantEmotion?: string | null;
  /** ステージ窓でメイン画面と同じライティングにする */
  vrmLighting?: VrmLightingSettings;
  vrmExpressionBlend?: VrmExpressionBlendSettings;
  vrmEmotionTunes?: VrmEmotionTuneMap;
  /** ステージ窓でメインと同じ表情スロット名の上書きを使う */
  vrmExpressionNames?: VrmExpressionNameOverrides;
  /** ステージ窓でメインと同じクロマ色にする */
  vrmChromaBg?: VrmChromaBgMode;
  /** ステージ窓でメインと同じ旧式表情（手動まばたき等）を使う */
  vrmLegacyExpression?: VrmLegacyExpressionSettings;
};

export type VisionChannelMessage =
  | {
      type: 'visionFrameRef';
      id: string;
      createdAt: number;
    }
  | {
      type: 'requestFrame';
      prompt: string;
      /** チャット同時送信: この発言と画面を1回のビジョン応答にまとめる */
      userText?: string;
      createdAt: number;
    };
