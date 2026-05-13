import type { VoiceEngine } from '../../../engines/VoiceEngine';
import type { VoicePeakVoiceServiceOptions } from '../../VoiceService';
import {
  type EngineHandler,
  type VoicePeakConfigurableEngine,
  hasApiEndpointSetter,
  mergeOptionValues,
} from './types';

const allowedUpdateKeys = [
  'voicepeakApiUrl',
  'voicepeakEmotion',
  'voicepeakSpeed',
  'voicepeakPitch',
  'voicepeakEmotionByNarrator',
  'voicepeakEmotionTagMapByNarrator',
] as const;

export const voicePeakEngineHandler: EngineHandler<VoicePeakVoiceServiceOptions> =
  {
    allowedUpdateKeys,
    applyOptions(engine: VoiceEngine, options: VoicePeakVoiceServiceOptions) {
      const voicepeakEngine = engine as VoicePeakConfigurableEngine;

      if (options.voicepeakApiUrl && hasApiEndpointSetter(engine)) {
        engine.setApiEndpoint(options.voicepeakApiUrl);
      }
      if (
        options.voicepeakEmotion !== undefined &&
        voicepeakEngine.setEmotion
      ) {
        const em = options.voicepeakEmotion;
        if (typeof em === 'string' && em.trim() === '') {
          voicepeakEngine.setEmotion(undefined);
        } else {
          voicepeakEngine.setEmotion(em);
        }
      }
      if (options.voicepeakSpeed !== undefined && voicepeakEngine.setSpeed) {
        voicepeakEngine.setSpeed(options.voicepeakSpeed);
      }
      if (options.voicepeakPitch !== undefined && voicepeakEngine.setPitch) {
        voicepeakEngine.setPitch(options.voicepeakPitch);
      }
      if (
        options.voicepeakEmotionByNarrator !== undefined &&
        voicepeakEngine.setNarratorEmotionMap
      ) {
        voicepeakEngine.setNarratorEmotionMap(
          options.voicepeakEmotionByNarrator,
        );
      }
      if (
        options.voicepeakEmotionTagMapByNarrator !== undefined &&
        voicepeakEngine.setNarratorTagEmotionMap
      ) {
        voicepeakEngine.setNarratorTagEmotionMap(
          options.voicepeakEmotionTagMapByNarrator,
        );
      }
    },
    mergeOptions(current, update) {
      return mergeOptionValues(current, update);
    },
  };
