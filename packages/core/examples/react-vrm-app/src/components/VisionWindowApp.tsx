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
  const [minimalOptionsVisible, setMinimalOptionsVisible] = useState(false);
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
        minimalOptionsVisible={minimalOptionsVisible}
        onToggleMinimalOptions={() => setMinimalOptionsVisible((v) => !v)}
        periodicEnabled={settings.enabled}
        onTogglePeriodicEnabled={() =>
          persist({
            ...settings,
            enabled: !settings.enabled,
          })
        }
        sendWithUserMessageEnabled={settings.sendWithUserMessage}
        onToggleSendWithUserMessage={() =>
          persist({
            ...settings,
            sendWithUserMessage: !settings.sendWithUserMessage,
          })
        }
        periodicIntervalSec={intervalSec}
        onChangePeriodicIntervalSec={(next) =>
          persist({
            ...settings,
            intervalSec: clampVisionIntervalSec(next),
          })
        }
      />

    </div>
  );
}
