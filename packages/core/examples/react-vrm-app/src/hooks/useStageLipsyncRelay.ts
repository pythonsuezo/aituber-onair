import { useEffect, useRef } from 'react';
import type {
  VrmChromaBgMode,
  VrmEmotionTuneMap,
  VrmExpressionBlendSettings,
  VrmLegacyExpressionSettings,
  VrmLightingSettings,
} from '../types/settings';
import {
  STAGE_LIPSYNC_CHANNEL,
  type StageLipsyncMessage,
} from '../windowMode';

/**
 * Publishes mouth state from the chat/combined window so a `?window=stage`
 * view (or second Electron window) can drive VRM lip-sync.
 */
export function useStageLipsyncRelay(
  mouthLevel: number,
  isSpeaking: boolean,
  assistantEmotion: string | undefined,
  vrmLighting: VrmLightingSettings,
  vrmExpressionBlend: VrmExpressionBlendSettings,
  vrmEmotionTunes: VrmEmotionTuneMap,
  vrmChromaBg: VrmChromaBgMode,
  vrmLegacyExpression: VrmLegacyExpressionSettings,
  enabled: boolean,
) {
  const bcRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (!enabled) {
      bcRef.current?.close();
      bcRef.current = null;
      return;
    }
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    bcRef.current = new BroadcastChannel(STAGE_LIPSYNC_CHANNEL);
    return () => {
      bcRef.current?.close();
      bcRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !bcRef.current) {
      return;
    }
    const msg: StageLipsyncMessage = {
      type: 'lipsync',
      mouthLevel,
      isSpeaking,
      assistantEmotion: assistantEmotion ?? null,
      vrmLighting,
      vrmExpressionBlend,
      vrmEmotionTunes,
      vrmChromaBg,
      vrmLegacyExpression,
    };
    bcRef.current.postMessage(msg);
  }, [
    mouthLevel,
    isSpeaking,
    assistantEmotion,
    vrmLighting,
    vrmExpressionBlend,
    vrmEmotionTunes,
    vrmChromaBg,
    vrmLegacyExpression,
    enabled,
  ]);
}
