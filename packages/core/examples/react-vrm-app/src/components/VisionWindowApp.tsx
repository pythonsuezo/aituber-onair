import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureVisionBar } from './CaptureVisionBar';
import { useVisionChannelSender, useVisionChannelReceiver } from '../hooks/useVisionChannel';
import {
  clampCaptureMaxHeight,
  clampCaptureMaxWidth,
  clampChangeThreshold,
  clampJpegQuality,
  clampVisionIntervalSec,
  loadVisionSettings,
  saveVisionSettings,
  VISION_SETTINGS_STORAGE_KEY,
  type VisionSettingsV1,
} from '../visionSettings';
import { stashVisionFrame } from '../utils/visionFrameBridge';
import type { VisionChannelMessage } from '../windowMode';

function buildOneShotPromptFromRequest(msg: Extract<VisionChannelMessage, { type: 'requestFrame' }>): string {
  const requestedPrompt = (msg.prompt || '').trim();
  const userText = (msg.userText || '').trim();
  if (userText) {
    const parts = [
      `ユーザーの発言: 「${userText}」`,
      '上記の発言とキャプチャ画面の内容の両方を踏まえて、日本語で自然に応答してください。',
    ];
    if (requestedPrompt) {
      parts.push(`追加指示:\n${requestedPrompt}`);
    }
    return parts.join('\n\n');
  }
  return requestedPrompt;
}

export function VisionWindowApp() {
  const send = useVisionChannelSender();
  const [settings, setSettings] = useState<VisionSettingsV1>(() => loadVisionSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const lastSentAtRef = useRef<number>(0);
  const intervalIdRef = useRef<number>(0);
  const oneShotPromptRef = useRef<string>('');

  const persist = useCallback((next: VisionSettingsV1) => {
    setSettings(next);
    saveVisionSettings(next);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === VISION_SETTINGS_STORAGE_KEY) {
        setSettings(loadVisionSettings());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const onSendVision = useCallback(
    async (imageDataUrl: string, promptFromUI: string) => {
      const s = settingsRef.current;
      const prompt = (
        oneShotPromptRef.current ||
        promptFromUI ||
        s.prompt ||
        ''
      ).trim();
      const createdAt = Date.now();
      oneShotPromptRef.current = '';
      lastSentAtRef.current = createdAt;
      const id = await stashVisionFrame({ imageDataUrl, prompt });
      send({
        type: 'visionFrameRef',
        id,
        createdAt,
      });
    },
    [send],
  );

  const requestTickRef = useRef<(() => void) | null>(null);

  const scheduleInterval = useCallback(() => {
    window.clearInterval(intervalIdRef.current);
    intervalIdRef.current = 0;

    const s = settingsRef.current;
    if (!s.enabled) {
      return;
    }

    const ms = clampVisionIntervalSec(s.intervalSec) * 1000;
    intervalIdRef.current = window.setInterval(() => {
      if (Date.now() - lastSentAtRef.current < ms * 0.5) {
        return;
      }
      requestTickRef.current?.();
    }, ms);
  }, []);

  useEffect(() => {
    scheduleInterval();
    return () => {
      window.clearInterval(intervalIdRef.current);
      intervalIdRef.current = 0;
    };
  }, [scheduleInterval, settings.enabled, settings.intervalSec]);

  useVisionChannelReceiver((msg: VisionChannelMessage) => {
    if (msg?.type !== 'requestFrame') return;
    oneShotPromptRef.current = buildOneShotPromptFromRequest(msg);
    requestTickRef.current?.();
  });

  const intervalSec = useMemo(
    () => clampVisionIntervalSec(settings.intervalSec),
    [settings.intervalSec],
  );
  const changeThreshold = useMemo(
    () => clampChangeThreshold(settings.changeThreshold),
    [settings.changeThreshold],
  );
  const capW = useMemo(
    () => clampCaptureMaxWidth(settings.captureMaxWidth),
    [settings.captureMaxWidth],
  );
  const capH = useMemo(
    () => clampCaptureMaxHeight(settings.captureMaxHeight),
    [settings.captureMaxHeight],
  );
  const jpegQ = useMemo(
    () => clampJpegQuality(settings.jpegQuality),
    [settings.jpegQuality],
  );

  return (
    <div className="vision-window vision-window--simple">
      <CaptureVisionBar
        variant="minimal"
        disabled={false}
        onSendVision={onSendVision}
        onAutoTick={(fn) => {
          requestTickRef.current = fn;
        }}
        defaultPrompt={settings.prompt}
        skipIfUnchanged={settings.skipIfUnchanged}
        changeThreshold={changeThreshold}
        captureMaxWidth={capW}
        captureMaxHeight={capH}
        jpegQuality={jpegQ}
      />

      <div className="vision-window-toolbar">
        <div className="vision-toolbar-buttons">
          <button
            type="button"
            className={`vision-mode-btn${settings.enabled ? ' vision-mode-btn--on' : ''}`}
            aria-pressed={settings.enabled}
            onClick={() => persist({ ...settings, enabled: !settings.enabled })}
          >
            定時送信
          </button>
          <button
            type="button"
            className={`vision-mode-btn${settings.sendWithUserMessage ? ' vision-mode-btn--on' : ''}`}
            aria-pressed={settings.sendWithUserMessage}
            onClick={() =>
              persist({
                ...settings,
                sendWithUserMessage: !settings.sendWithUserMessage,
              })
            }
          >
            同時送信
          </button>
        </div>

        {settings.enabled ? (
          <label className="vision-toolbar-interval">
            <span className="vision-toolbar-interval-label">{intervalSec} 秒</span>
            <input
              type="range"
              min={5}
              max={180}
              value={intervalSec}
              onChange={(e) =>
                persist({
                  ...settings,
                  intervalSec: clampVisionIntervalSec(Number(e.target.value)),
                })
              }
            />
          </label>
        ) : null}

        <p className="vision-toolbar-hint">
          画質・指示文・変化検知はチャット窓の ⚙ Vision から変更できます。
        </p>
      </div>
    </div>
  );
}
