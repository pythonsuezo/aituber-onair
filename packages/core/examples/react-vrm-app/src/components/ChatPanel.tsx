import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types/chat';
import type {
  VrmChromaBgMode,
  VrmEmotionTuneMap,
  VrmExpressionBlendSettings,
  VrmLegacyExpressionSettings,
  VrmLightingSettings,
} from '../types/settings';
import { AvatarBackground } from './AvatarPanel';
import { ChatLog } from './ChatLog';
import { ChatInput } from './ChatInput';

interface ChatPanelProps {
  messages: ChatMessage[];
  partialResponse: string;
  isProcessing: boolean;
  onSend: (text: string) => void;
  onOpenVisionWindow: () => void;
  onToggleSettings: () => void;
  mouthLevel: number;
  isSpeaking: boolean;
  backgroundImageUrl?: string | null;
  /** スマホレイアウトでは VRM を暗背景（クロマ無し） */
  useDarkStudioBackground: boolean;
  vrmChromaBg: VrmChromaBgMode;
  vrmLighting: VrmLightingSettings;
  vrmExpressionBlend: VrmExpressionBlendSettings;
  vrmEmotionTunes: VrmEmotionTuneMap;
  vrmLegacyExpression: VrmLegacyExpressionSettings;
  assistantEmotion?: string;
  /** When false, VRM is shown only in the separate stage window (e.g. `?window=stage`). */
  showAvatar?: boolean;
}

export function ChatPanel({
  messages,
  partialResponse,
  isProcessing,
  onSend,
  onOpenVisionWindow,
  onToggleSettings,
  mouthLevel,
  isSpeaking,
  backgroundImageUrl,
  useDarkStudioBackground,
  vrmChromaBg,
  vrmLighting,
  vrmExpressionBlend,
  vrmEmotionTunes,
  vrmLegacyExpression,
  assistantEmotion,
  showAvatar = true,
}: ChatPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [avatarRatio, setAvatarRatio] = useState(0.52);
  const dragRef = useRef<{
    dragging: boolean;
    panelTop: number;
    panelHeight: number;
  }>({
    dragging: false,
    panelTop: 0,
    panelHeight: 0,
  });

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!dragRef.current.dragging) return;
      const y = event.clientY - dragRef.current.panelTop;
      const ratio = y / Math.max(1, dragRef.current.panelHeight);
      setAvatarRatio(Math.min(0.78, Math.max(0.26, ratio)));
    };
    const onPointerUp = () => {
      dragRef.current.dragging = false;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  const panelStyle = backgroundImageUrl
    ? {
        backgroundImage: `url(${backgroundImageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined;

  return (
    <div
      ref={panelRef}
      className={
        showAvatar ? 'chat-panel' : 'chat-panel chat-panel--no-avatar'
      }
      style={panelStyle}
    >
      <button
        type="button"
        className="settings-button chat-settings-button"
        onClick={onToggleSettings}
        aria-label="Settings"
      >
        ⚙
      </button>
      <button
        type="button"
        className="settings-button chat-vision-button"
        onClick={onOpenVisionWindow}
        aria-label="Vision preview"
        title="ビジョン（プレビュー）"
      >
        👁
      </button>
      {showAvatar ? (
        <div
          className="chat-avatar-region"
          style={{ flexBasis: `${(avatarRatio * 100).toFixed(1)}%` }}
        >
          <AvatarBackground
            mouthLevel={mouthLevel}
            isSpeaking={isSpeaking}
            useDarkStudioBackground={useDarkStudioBackground}
            vrmChromaBg={vrmChromaBg}
            vrmLighting={vrmLighting}
            vrmExpressionBlend={vrmExpressionBlend}
            vrmEmotionTunes={vrmEmotionTunes}
            vrmLegacyExpression={vrmLegacyExpression}
            assistantEmotion={assistantEmotion}
          />
        </div>
      ) : null}
      {showAvatar ? (
        <div
          className="chat-splitter"
          onPointerDown={() => {
            const panel = panelRef.current;
            if (!panel) return;
            const rect = panel.getBoundingClientRect();
            dragRef.current = {
              dragging: true,
              panelTop: rect.top,
              panelHeight: rect.height,
            };
          }}
          role="separator"
          aria-orientation="horizontal"
          aria-label="アバターとチャットの境界を調整"
        />
      ) : null}
      <div className="chat-conversation-region">
        <ChatLog messages={messages} partialResponse={partialResponse} />
        <ChatInput onSend={onSend} disabled={isProcessing} />
      </div>
    </div>
  );
}
