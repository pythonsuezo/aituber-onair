import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { CaptureVisionBar } from './components/CaptureVisionBar';
import { SettingsPanel } from './components/SettingsPanel';
import { StageViewerApp } from './components/StageViewerApp';
import { VisionWindowApp } from './components/VisionWindowApp';
import { useAudioLipsync } from './hooks/useAudioLipsync';
import { useAituberCore } from './hooks/useAituberCore';
import { useSettings } from './hooks/useSettings';
import { useStageLipsyncRelay } from './hooks/useStageLipsyncRelay';
import { useVisionChannelReceiver, useVisionChannelSender } from './hooks/useVisionChannel';
import { useTwitchComments } from './hooks/useTwitchComments';
import { useYoutubeComments } from './hooks/useYoutubeComments';
import { getAppWindowMode, type VisionChannelMessage } from './windowMode';
import {
  clampCaptureMaxHeight,
  clampCaptureMaxWidth,
  clampChangeThreshold,
  clampJpegQuality,
  clampVisionIntervalSec,
  loadVisionSettings,
  saveVisionSettings,
  type VisionSettingsV1,
} from './visionSettings';
import { takeVisionFrame } from './utils/visionFrameBridge';
import type { TwitchChatMessage } from './services/twitch/twitchService';
import type { YouTubeChatMessage } from './services/youtube/youtubeService';
import './styles/app.css';

const windowMode = getAppWindowMode();

function buildOneShotPromptFromRequest(
  msg: Extract<VisionChannelMessage, { type: 'requestFrame' }>,
): string {
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

export default function App() {
  if (windowMode === 'stage') {
    return <StageViewerApp />;
  }
  if (windowMode === 'vision') {
    return <VisionWindowApp />;
  }

  return <MainApp windowMode={windowMode} />;
}

function MainApp({ windowMode }: { windowMode: 'combined' | 'chat' }) {
  const { play, stop, mouthLevel, isSpeaking } = useAudioLipsync();
  const settingsHook = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [streamErrorMessage, setStreamErrorMessage] = useState('');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const backgroundObjectUrlRef = useRef<string | null>(null);
  const jikkyoSendToAiRef = useRef(false);
  const jikkyoAiHeaderEnabledRef = useRef(false);
  const jikkyoAiHeaderTextRef = useRef('');
  const isProcessingRef = useRef(false);
  const jikkyoQueueRef = useRef<string[]>([]);
  const [inlineVisionOpen, setInlineVisionOpen] = useState(false);
  const [inlineVisionOptionsOpen, setInlineVisionOptionsOpen] = useState(false);
  const [inlineVisionSettings, setInlineVisionSettings] = useState<VisionSettingsV1>(() =>
    loadVisionSettings(),
  );
  const [isMobileUi, setIsMobileUi] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
  });
  /** 幅が狭いときのみ暗背景VRM。タッチPCでも幅が広ければクロマを使える */
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 900px)').matches;
  });
  const [inlineVisionTransform, setInlineVisionTransform] = useState({
    x: 0,
    y: 0,
    scale: 1,
  });
  const inlineVisionTickRef = useRef<(() => void) | null>(null);
  /** モバイル定時送信: VisionWindowApp と同様に interval で tick を叩く */
  const inlineVisionIntervalRef = useRef(0);
  const lastInlineVisionSentAtRef = useRef(0);
  const inlineVisionPromptRef = useRef('');
  const gestureRef = useRef<{
    mode: 'none' | 'drag' | 'pinch';
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    pinchStartDistance: number;
    baseScale: number;
  }>({
    mode: 'none',
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
    pinchStartDistance: 0,
    baseScale: 1,
  });
  const pendingVisionFallbackTimerRef = useRef<number | null>(null);
  const pendingVisionFallbackTextRef = useRef<string>('');

  const updateInlineVisionSettings = useCallback(
    (updater: (prev: VisionSettingsV1) => VisionSettingsV1) => {
      setInlineVisionSettings((prev) => {
        const next = updater(prev);
        saveVisionSettings(next);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!inlineVisionOpen) return;
    setInlineVisionSettings(loadVisionSettings());
  }, [inlineVisionOpen, settingsOpen]);

  jikkyoSendToAiRef.current = settingsHook.settings.stream.jikkyoSendToAi;
  jikkyoAiHeaderEnabledRef.current =
    settingsHook.settings.stream.jikkyoAiHeaderEnabled;
  jikkyoAiHeaderTextRef.current =
    settingsHook.settings.stream.jikkyoAiHeaderText || '';

  const handleAudioPlay = useCallback(
    async (arrayBuffer: ArrayBuffer) => {
      await play(arrayBuffer);
    },
    [play]
  );

  const {
    messages,
    isProcessing,
    partialResponse,
    assistantEmotion,
    processChat,
    sendVisionFrame,
    setPendingVisionPairWithUserText,
    cancelPendingVisionUserText,
  } = useAituberCore({
    onAudioPlay: handleAudioPlay,
    settings: settingsHook.settings,
    getApiKeyForProvider: settingsHook.getApiKeyForProvider,
  });
  isProcessingRef.current = isProcessing;

  useStageLipsyncRelay(
    mouthLevel,
    isSpeaking,
    assistantEmotion,
    settingsHook.settings.visual.vrmLighting,
    settingsHook.settings.visual.vrmExpressionBlend,
    settingsHook.settings.visual.vrmEmotionTunes,
    settingsHook.settings.visual.vrmChromaBg,
    settingsHook.settings.visual.vrmLegacyExpression,
    true,
  );

  const visionSend = useVisionChannelSender();

  const clearVisionFallbackTimer = useCallback(() => {
    if (pendingVisionFallbackTimerRef.current !== null) {
      window.clearTimeout(pendingVisionFallbackTimerRef.current);
      pendingVisionFallbackTimerRef.current = null;
    }
  }, []);

  const dispatchNextJikkyoIfIdle = useCallback(() => {
    if (isProcessingRef.current) {
      return;
    }
    const next = jikkyoQueueRef.current.shift();
    if (!next) {
      return;
    }
    stop();
    processChat(next);
  }, [processChat, stop]);

  useVisionChannelReceiver(async (msg: VisionChannelMessage) => {
    if (msg?.type === 'requestFrame') {
      if (!isMobileUi) return;
      if (!inlineVisionOpen || !inlineVisionTickRef.current) return;
      inlineVisionPromptRef.current = buildOneShotPromptFromRequest(msg);
      inlineVisionTickRef.current();
      return;
    }
    if (msg?.type !== 'visionFrameRef') return;
    // A vision frame arrived, so text fallback is unnecessary.
    clearVisionFallbackTimer();
    const frame = await takeVisionFrame(msg.id);
    if (!frame) {
      console.warn('[vision] frame not found (expired or storage blocked):', msg.id);
      cancelPendingVisionUserText();
      // If frame could not be taken, ensure chat still goes through as text.
      const fallbackText = pendingVisionFallbackTextRef.current.trim();
      if (fallbackText) {
        pendingVisionFallbackTextRef.current = '';
        processChat(fallbackText);
      }
      return;
    }
    pendingVisionFallbackTextRef.current = '';
    stop();
    await sendVisionFrame(frame.imageDataUrl, frame.prompt);
  });

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px), (pointer: coarse)');
    const apply = () => setIsMobileUi(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => {
      mq.removeEventListener?.('change', apply);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => setIsNarrowViewport(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => {
      mq.removeEventListener?.('change', apply);
    };
  }, []);

  const clampScale = (v: number) => Math.min(2.2, Math.max(0.65, v));
  const touchDistance = (
    a: { clientX: number; clientY: number },
    b: { clientX: number; clientY: number },
  ) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const handleInlineVisionTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!isMobileUi) return;
      const t = e.touches;
      if (t.length >= 2) {
        gestureRef.current.mode = 'pinch';
        gestureRef.current.pinchStartDistance = touchDistance(t[0]!, t[1]!);
        gestureRef.current.baseScale = inlineVisionTransform.scale;
        return;
      }
      if (t.length === 1) {
        gestureRef.current.mode = 'drag';
        gestureRef.current.startX = t[0]!.clientX;
        gestureRef.current.startY = t[0]!.clientY;
        gestureRef.current.baseX = inlineVisionTransform.x;
        gestureRef.current.baseY = inlineVisionTransform.y;
      }
    },
    [inlineVisionTransform.scale, inlineVisionTransform.x, inlineVisionTransform.y, isMobileUi],
  );

  const handleInlineVisionTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!isMobileUi) return;
      const t = e.touches;
      const g = gestureRef.current;
      if (g.mode === 'pinch' && t.length >= 2) {
        const dist = touchDistance(t[0]!, t[1]!);
        const ratio = g.pinchStartDistance > 0 ? dist / g.pinchStartDistance : 1;
        setInlineVisionTransform((prev) => ({
          ...prev,
          scale: clampScale(g.baseScale * ratio),
        }));
        e.preventDefault();
        return;
      }
      if (g.mode === 'drag' && t.length === 1) {
        const dx = t[0]!.clientX - g.startX;
        const dy = t[0]!.clientY - g.startY;
        setInlineVisionTransform((prev) => ({
          ...prev,
          x: g.baseX + dx,
          y: g.baseY + dy,
        }));
        e.preventDefault();
      }
    },
    [isMobileUi],
  );

  const handleInlineVisionTouchEnd = useCallback(() => {
    gestureRef.current.mode = 'none';
  }, []);

  useEffect(() => {
    if (!window.jikkyoTcp?.updateConfig) {
      return;
    }
    void window.jikkyoTcp.updateConfig({
      enabled: settingsHook.settings.stream.jikkyoTcpEnabled,
      listenPort: settingsHook.settings.stream.jikkyoListenPort,
      bouyomiPort: settingsHook.settings.stream.jikkyoBouyomiPort,
      forwardToBouyomi: settingsHook.settings.stream.jikkyoForwardToBouyomi,
    });
  }, [
    settingsHook.settings.stream.jikkyoTcpEnabled,
    settingsHook.settings.stream.jikkyoListenPort,
    settingsHook.settings.stream.jikkyoBouyomiPort,
    settingsHook.settings.stream.jikkyoForwardToBouyomi,
  ]);

  useEffect(() => {
    if (!window.jikkyoTcp?.onMessage) {
      return;
    }
    const off = window.jikkyoTcp.onMessage((payload) => {
      const cleaned = (payload?.cleaned || '').trim();
      if (!cleaned) {
        return;
      }
      if (!jikkyoSendToAiRef.current) {
        return;
      }
      const headerEnabled = jikkyoAiHeaderEnabledRef.current;
      const header = (jikkyoAiHeaderTextRef.current || '').trim();
      const finalText =
        headerEnabled && header
          ? `${header}${cleaned}`
          : cleaned;
      jikkyoQueueRef.current.push(finalText);
      // Prevent unbounded growth when bursts happen.
      if (jikkyoQueueRef.current.length > 200) {
        jikkyoQueueRef.current.splice(0, jikkyoQueueRef.current.length - 200);
      }
      dispatchNextJikkyoIfIdle();
    });
    return () => {
      off?.();
    };
  }, [dispatchNextJikkyoIfIdle]);

  useEffect(() => {
    if (!isProcessing) {
      pendingVisionFallbackTextRef.current = '';
      clearVisionFallbackTimer();
      dispatchNextJikkyoIfIdle();
    }
  }, [clearVisionFallbackTimer, dispatchNextJikkyoIfIdle, isProcessing]);

  const openVisionWindow = useCallback(() => {
    if (!isMobileUi) {
      const url = `${window.location.origin}${window.location.pathname}?window=vision`;
      window.open(url, 'aituber-vision', 'popup=yes,width=560,height=820');
      return;
    }
    setInlineVisionOpen((v) => !v);
  }, [isMobileUi]);

  const handleInlineVisionSend = useCallback(
    async (imageDataUrl: string, promptFromUI: string) => {
      const oneShot = inlineVisionPromptRef.current;
      inlineVisionPromptRef.current = '';
      const prompt = (oneShot || promptFromUI || '').trim();
      lastInlineVisionSentAtRef.current = Date.now();
      stop();
      await sendVisionFrame(imageDataUrl, prompt);
    },
    [sendVisionFrame, stop],
  );

  useEffect(() => {
    window.clearInterval(inlineVisionIntervalRef.current);
    inlineVisionIntervalRef.current = 0;

    if (!isMobileUi || !inlineVisionOpen || !inlineVisionSettings.enabled) {
      return;
    }

    const ms = clampVisionIntervalSec(inlineVisionSettings.intervalSec) * 1000;
    inlineVisionIntervalRef.current = window.setInterval(() => {
      if (Date.now() - lastInlineVisionSentAtRef.current < ms * 0.5) {
        return;
      }
      inlineVisionTickRef.current?.();
    }, ms);

    return () => {
      window.clearInterval(inlineVisionIntervalRef.current);
      inlineVisionIntervalRef.current = 0;
    };
  }, [
    isMobileUi,
    inlineVisionOpen,
    inlineVisionSettings.enabled,
    inlineVisionSettings.intervalSec,
  ]);

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      stop();
      const v = loadVisionSettings();
      if (v.sendWithUserMessage) {
        // テキスト専用の processChat は呼ばず、画像＋発言を1回の processVisionChat にまとめる
        setPendingVisionPairWithUserText(trimmed);
        pendingVisionFallbackTextRef.current = trimmed;
        clearVisionFallbackTimer();
        if (isMobileUi && inlineVisionOpen && inlineVisionTickRef.current) {
          inlineVisionPromptRef.current = buildOneShotPromptFromRequest({
            type: 'requestFrame',
            prompt: v.prompt || '',
            userText: trimmed,
            createdAt: Date.now(),
          });
          inlineVisionTickRef.current();
          return;
        }
        pendingVisionFallbackTimerRef.current = window.setTimeout(() => {
          // Vision window not open / preview not active -> fallback to text chat.
          const fallbackText = pendingVisionFallbackTextRef.current.trim();
          if (!fallbackText) return;
          pendingVisionFallbackTextRef.current = '';
          cancelPendingVisionUserText();
          processChat(fallbackText);
        }, 1200);
        visionSend({
          type: 'requestFrame',
          prompt: v.prompt || '',
          userText: trimmed,
          createdAt: Date.now(),
        });
      } else {
        processChat(trimmed);
      }
    },
    [
      stop,
      processChat,
      isMobileUi,
      inlineVisionOpen,
      visionSend,
      setPendingVisionPairWithUserText,
      cancelPendingVisionUserText,
      clearVisionFallbackTimer,
    ],
  );

  const handleYoutubeComment = useCallback(
    (comment: YouTubeChatMessage) => {
      stop();
      processChat(`「${comment.userName}」さんのコメント: ${comment.userComment}`);
    },
    [processChat, stop]
  );

  const handleTwitchComment = useCallback(
    (comment: TwitchChatMessage) => {
      stop();
      processChat(`「${comment.userName}」さんのコメント: ${comment.userComment}`);
    },
    [processChat, stop]
  );

  const handleBackgroundImageChange = useCallback((file: File | null) => {
    if (backgroundObjectUrlRef.current) {
      URL.revokeObjectURL(backgroundObjectUrlRef.current);
      backgroundObjectUrlRef.current = null;
    }

    if (!file) {
      setBackgroundImageUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    backgroundObjectUrlRef.current = nextUrl;
    setBackgroundImageUrl(nextUrl);
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes('access_token')) return;

    const params = new URLSearchParams(hash.slice(1));
    const token = params.get('access_token');
    const state = params.get('state');
    const savedState = sessionStorage.getItem('twitchOauthState');

    if (token && state && state === savedState) {
      settingsHook.updateTwitchAccessToken(token);
      setStreamErrorMessage('');
      sessionStorage.removeItem('twitchOauthState');
    }

    history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search
    );
  }, []);

  useYoutubeComments({
    youtubeLiveId: settingsHook.settings.stream.youtubeLiveId,
    youtubeApiKey: settingsHook.settings.stream.youtubeApiKey,
    isEnabled:
      settingsHook.settings.stream.platform === 'youtube' &&
      settingsHook.settings.stream.youtubeEnabled,
    intervalMs: settingsHook.settings.stream.youtubeCommentIntervalMs,
    onComment: handleYoutubeComment,
  });

  useTwitchComments({
    twitchChannel: settingsHook.settings.stream.twitchChannel,
    twitchClientId: settingsHook.settings.stream.twitchClientId,
    twitchAccessToken: settingsHook.settings.stream.twitchAccessToken,
    isEnabled:
      settingsHook.settings.stream.platform === 'twitch' &&
      settingsHook.settings.stream.twitchEnabled,
    intervalMs: settingsHook.settings.stream.twitchCommentIntervalMs,
    onComment: handleTwitchComment,
    onTokenExpired: () => {
      settingsHook.updateTwitchAccessToken('');
      settingsHook.updateTwitchEnabled(false);
      setStreamErrorMessage('Twitch access token expired. Please reconnect.');
    },
    onError: (message) => {
      setStreamErrorMessage(message);
      if (message) {
        console.warn(message);
      }
    },
  });

  // Close the dialog with the Escape key
  useEffect(() => {
    if (!settingsOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen]);

  useEffect(() => {
    const backgroundObjectUrl = backgroundObjectUrlRef;

    return () => {
      if (pendingVisionFallbackTimerRef.current !== null) {
        window.clearTimeout(pendingVisionFallbackTimerRef.current);
      }
      if (backgroundObjectUrl.current) {
        URL.revokeObjectURL(backgroundObjectUrl.current);
      }
    };
  }, []);

  const vSettings = inlineVisionSettings;

  return (
    <div className="app">
      <ChatPanel
        messages={messages}
        partialResponse={partialResponse}
        isProcessing={isProcessing}
        onSend={handleSend}
        onOpenVisionWindow={openVisionWindow}
        mouthLevel={mouthLevel}
        isSpeaking={isSpeaking}
        backgroundImageUrl={backgroundImageUrl}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        showAvatar={windowMode === 'combined'}
        useDarkStudioBackground={isNarrowViewport}
        vrmChromaBg={settingsHook.settings.visual?.vrmChromaBg ?? 'blue'}
        vrmLighting={settingsHook.settings.visual.vrmLighting}
        vrmExpressionBlend={settingsHook.settings.visual.vrmExpressionBlend}
        vrmEmotionTunes={settingsHook.settings.visual.vrmEmotionTunes}
        vrmLegacyExpression={settingsHook.settings.visual.vrmLegacyExpression}
        assistantEmotion={assistantEmotion}
      />
      {isMobileUi && inlineVisionOpen && (
        <div
          className="inline-vision-overlay"
          style={{
            transform: `translate(${inlineVisionTransform.x}px, ${inlineVisionTransform.y}px) scale(${inlineVisionTransform.scale})`,
            transformOrigin: 'bottom right',
            touchAction: 'none',
          }}
          onTouchStart={handleInlineVisionTouchStart}
          onTouchMove={handleInlineVisionTouchMove}
          onTouchEnd={handleInlineVisionTouchEnd}
          onTouchCancel={handleInlineVisionTouchEnd}
        >
          <CaptureVisionBar
            variant="minimal"
            disabled={false}
            onSendVision={handleInlineVisionSend}
            onAutoTick={(fn) => {
              inlineVisionTickRef.current = fn;
            }}
            defaultPrompt={vSettings.prompt}
            skipIfUnchanged={vSettings.skipIfUnchanged}
            changeThreshold={clampChangeThreshold(vSettings.changeThreshold)}
            captureMaxWidth={clampCaptureMaxWidth(vSettings.captureMaxWidth)}
            captureMaxHeight={clampCaptureMaxHeight(vSettings.captureMaxHeight)}
            jpegQuality={clampJpegQuality(vSettings.jpegQuality)}
            previewMaxHeightPx={180}
            minimalOptionsVisible={inlineVisionOptionsOpen}
            onToggleMinimalOptions={() => setInlineVisionOptionsOpen((v) => !v)}
            periodicEnabled={vSettings.enabled}
            onTogglePeriodicEnabled={() =>
              updateInlineVisionSettings((prev) => ({ ...prev, enabled: !prev.enabled }))
            }
            sendWithUserMessageEnabled={vSettings.sendWithUserMessage}
            onToggleSendWithUserMessage={() =>
              updateInlineVisionSettings((prev) => ({
                ...prev,
                sendWithUserMessage: !prev.sendWithUserMessage,
              }))
            }
            periodicIntervalSec={vSettings.intervalSec}
            onChangePeriodicIntervalSec={(next) =>
              updateInlineVisionSettings((prev) => ({
                ...prev,
                intervalSec: clampVisionIntervalSec(next),
              }))
            }
          />
        </div>
      )}

      {settingsOpen && (
        <div className="settings-dialog-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-dialog" onClick={e => e.stopPropagation()}>
            <div className="settings-dialog-header">
              <h2>Settings</h2>
              <button className="settings-dialog-close" onClick={() => setSettingsOpen(false)}>&times;</button>
            </div>
            <SettingsPanel
              {...settingsHook}
              isProcessing={isProcessing}
              backgroundImageUrl={backgroundImageUrl}
              streamErrorMessage={streamErrorMessage}
              onBackgroundImageChange={handleBackgroundImageChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
