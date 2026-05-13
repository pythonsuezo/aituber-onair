import { useEffect, useState } from 'react';
import { AvatarBackground } from './AvatarPanel';
import { useSettings } from '../hooks/useSettings';
import {
  STAGE_EMOTION_PREVIEW_CHANNEL,
  STAGE_LIPSYNC_CHANNEL,
  STAGE_VRM_CONTROL_CHANNEL,
  VRM_CONTROL_EVENT,
  VRM_EMOTION_PREVIEW_EVENT,
  type StageEmotionPreviewMessage,
  type StageLipsyncMessage,
  type StageVrmControlMessage,
} from '../windowMode';
import type {
  VrmChromaBgMode,
  VrmExpressionBlendSettings,
  VrmEmotionTuneMap,
  VrmLegacyExpressionSettings,
  VrmLightingSettings,
} from '../types/settings';

type StageRelayState = {
  mouthLevel: number;
  isSpeaking: boolean;
  assistantEmotion?: string;
  vrmLighting?: VrmLightingSettings;
  vrmExpressionBlend?: VrmExpressionBlendSettings;
  vrmEmotionTunes?: VrmEmotionTuneMap;
  vrmChromaBg?: VrmChromaBgMode;
  vrmLegacyExpression?: VrmLegacyExpressionSettings;
};

/**
 * VRM-only window: receives lip-sync from the chat window via BroadcastChannel.
 */
export function StageViewerApp() {
  const { settings } = useSettings();
  const [relay, setRelay] = useState<StageRelayState>({
    mouthLevel: 0,
    isSpeaking: false,
  });

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    const bcVrmControl = new BroadcastChannel(STAGE_VRM_CONTROL_CHANNEL);
    bcVrmControl.onmessage = (ev: MessageEvent<StageVrmControlMessage>) => {
      const data = ev.data;
      if (data?.type !== 'vrm-control') {
        return;
      }
      window.dispatchEvent(
        new CustomEvent(VRM_CONTROL_EVENT, {
          detail: { action: data.action },
        }),
      );
    };

    const bcPreview = new BroadcastChannel(STAGE_EMOTION_PREVIEW_CHANNEL);
    bcPreview.onmessage = (ev: MessageEvent<StageEmotionPreviewMessage>) => {
      const data = ev.data;
      if (data?.type !== 'emotion-preview') {
        return;
      }
      window.dispatchEvent(
        new CustomEvent(VRM_EMOTION_PREVIEW_EVENT, {
          detail: {
            emotion: data.emotion,
            durationMs: data.durationMs,
          },
        }),
      );
    };

    const bc = new BroadcastChannel(STAGE_LIPSYNC_CHANNEL);
    bc.onmessage = (ev: MessageEvent<StageLipsyncMessage>) => {
      const data = ev.data;
      if (data?.type !== 'lipsync') {
        return;
      }
      setRelay({
        mouthLevel: data.mouthLevel,
        isSpeaking: data.isSpeaking,
        assistantEmotion: data.assistantEmotion ?? undefined,
        vrmLighting: data.vrmLighting,
        vrmExpressionBlend: data.vrmExpressionBlend,
        vrmEmotionTunes: data.vrmEmotionTunes,
        vrmChromaBg: data.vrmChromaBg,
        vrmLegacyExpression: data.vrmLegacyExpression,
      });
    };
    return () => {
      bcVrmControl.onmessage = null;
      bcVrmControl.close();
      bcPreview.onmessage = null;
      bcPreview.close();
      bc.onmessage = null;
      bc.close();
    };
  }, []);

  const vrmLighting: VrmLightingSettings = {
    ...settings.visual.vrmLighting,
    ...(relay.vrmLighting || {}),
  };
  const vrmExpressionBlend: VrmExpressionBlendSettings =
    relay.vrmExpressionBlend ?? settings.visual.vrmExpressionBlend;
  const vrmEmotionTunes: VrmEmotionTuneMap =
    relay.vrmEmotionTunes ?? settings.visual.vrmEmotionTunes;
  const vrmChromaBg: VrmChromaBgMode =
    relay.vrmChromaBg ?? settings.visual.vrmChromaBg;
  const vrmLegacyExpression: VrmLegacyExpressionSettings =
    relay.vrmLegacyExpression ?? settings.visual.vrmLegacyExpression;

  return (
    <div className="app app--stage-only">
      <AvatarBackground
        mouthLevel={relay.mouthLevel}
        isSpeaking={relay.isSpeaking}
        useDarkStudioBackground={false}
        vrmChromaBg={vrmChromaBg}
        vrmLighting={vrmLighting}
        vrmExpressionBlend={vrmExpressionBlend}
        vrmEmotionTunes={vrmEmotionTunes}
        vrmLegacyExpression={vrmLegacyExpression}
        assistantEmotion={relay.assistantEmotion}
      />
    </div>
  );
}
