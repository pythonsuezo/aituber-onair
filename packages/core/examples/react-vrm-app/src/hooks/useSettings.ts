import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AITuberOnAirCore,
  refreshOpenRouterFreeModels,
  type RefreshOpenRouterFreeModelsResult,
} from '@aituber-onair/core';
import {
  type AppSettings,
  type ChatProviderOption,
  type StreamingPlatformOption,
  type SystemPromptPreset,
  type TTSEngineOption,
  type VrmChromaBgMode,
  type VrmEmotionTuneMap,
  type VrmExpressionBlendSettings,
  type VrmExpressionNameOverrides,
  type VrmLegacyExpressionSettings,
  type VrmLightingSettings,
  VRM_EXPRESSION_NAME_SLOT_IDS,
  type VrmPerEmotionTune,
  type VrmTuneEmotionId,
  VRM_TUNE_EMOTION_IDS,
} from '../types/settings';
import { DEFAULT_AITUBER_SYSTEM_PROMPT } from '../constants/defaultAituberSystemPrompt';

const LEGACY_VRM_BG_STORAGE_KEY = 'react-vrm-bg-mode-v1';

const DEFAULT_SYSTEM_PROMPT = DEFAULT_AITUBER_SYSTEM_PROMPT;

function normalizeSystemPromptPresets(value: unknown): SystemPromptPreset[] {
  if (!Array.isArray(value)) return [];
  const out: SystemPromptPreset[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const idRaw = typeof o.id === 'string' ? o.id.trim() : '';
    const id =
      idRaw ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `preset-${Date.now()}-${i}`);
    const nameRaw = typeof o.name === 'string' ? o.name.trim() : '';
    const name = nameRaw || `プリセット ${i + 1}`;
    const text = typeof o.text === 'string' ? o.text : '';
    out.push({ id, name, text });
  }
  return out;
}

function newPresetId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeVrmChromaBg(value: unknown): VrmChromaBgMode | undefined {
  if (value === 'green' || value === 'blue' || value === 'purple') {
    return value;
  }
  return undefined;
}

const DEFAULT_VRM_LIGHTING: VrmLightingSettings = {
  ambientIntensity: 1.0,
  directionalIntensity: 0.9,
  directionalLightX: 1.0,
  directionalLightY: 1.8,
  directionalLightZ: 1.2,
};

function clampLightIntensity(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(2, Math.max(0, value));
}

function clampLightAxis(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(50, Math.max(-50, value));
}

function normalizeVrmLighting(
  value: unknown,
): VrmLightingSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_VRM_LIGHTING };
  }
  const o = value as Record<string, unknown>;
  return {
    ambientIntensity: clampLightIntensity(
      o.ambientIntensity,
      DEFAULT_VRM_LIGHTING.ambientIntensity,
    ),
    directionalIntensity: clampLightIntensity(
      o.directionalIntensity,
      DEFAULT_VRM_LIGHTING.directionalIntensity,
    ),
    directionalLightX: clampLightAxis(
      o.directionalLightX,
      DEFAULT_VRM_LIGHTING.directionalLightX,
    ),
    directionalLightY: clampLightAxis(
      o.directionalLightY,
      DEFAULT_VRM_LIGHTING.directionalLightY,
    ),
    directionalLightZ: clampLightAxis(
      o.directionalLightZ,
      DEFAULT_VRM_LIGHTING.directionalLightZ,
    ),
  };
}

const DEFAULT_VRM_EXPRESSION_BLEND: VrmExpressionBlendSettings = {
  moodMaxWeight: 1,
  moodScaleWhileSpeaking: 0.9,
  moodBlendSpeed: 0.22,
  mouthBlendSpeed: 0.35,
  reduceMoodDuringBlink: 0.4,
};

function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function clampBlendSpeed(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0.05, value));
}

function normalizeVrmExpressionBlend(
  value: unknown,
): VrmExpressionBlendSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_VRM_EXPRESSION_BLEND };
  }
  const o = value as Record<string, unknown>;
  const base = DEFAULT_VRM_EXPRESSION_BLEND;
  return {
    moodMaxWeight: clampUnit(o.moodMaxWeight, base.moodMaxWeight),
    moodScaleWhileSpeaking: clampUnit(
      o.moodScaleWhileSpeaking,
      base.moodScaleWhileSpeaking,
    ),
    moodBlendSpeed: clampBlendSpeed(o.moodBlendSpeed, base.moodBlendSpeed),
    mouthBlendSpeed: clampBlendSpeed(o.mouthBlendSpeed, base.mouthBlendSpeed),
    reduceMoodDuringBlink: clampUnit(
      o.reduceMoodDuringBlink,
      base.reduceMoodDuringBlink,
    ),
  };
}

const DEFAULT_VRM_PER_EMOTION_TUN: VrmPerEmotionTune = {
  blinkIntensity: 1,
  mouthIntensity: 1,
  neutralRecoverSec: 0.45,
};

function createDefaultVrmEmotionTunes(): VrmEmotionTuneMap {
  const m = {} as VrmEmotionTuneMap;
  for (const id of VRM_TUNE_EMOTION_IDS) {
    m[id] = { ...DEFAULT_VRM_PER_EMOTION_TUN };
  }
  return m;
}

const DEFAULT_VRM_EMOTION_TUNES = createDefaultVrmEmotionTunes();

function cloneVrmEmotionTunes(map: VrmEmotionTuneMap): VrmEmotionTuneMap {
  const o = {} as VrmEmotionTuneMap;
  for (const id of VRM_TUNE_EMOTION_IDS) {
    o[id] = { ...map[id] };
  }
  return o;
}

function clamp02wide(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(2, Math.max(0, value));
}

function clampRecoverSec(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(8, Math.max(0.05, value));
}

function normalizeOneEmotionTune(
  value: unknown,
  fallback: VrmPerEmotionTune,
): VrmPerEmotionTune {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }
  const r = value as Record<string, unknown>;
  return {
    blinkIntensity: clamp02wide(r.blinkIntensity, fallback.blinkIntensity),
    mouthIntensity: clamp02wide(r.mouthIntensity, fallback.mouthIntensity),
    neutralRecoverSec: clampRecoverSec(
      r.neutralRecoverSec,
      fallback.neutralRecoverSec,
    ),
  };
}

function normalizeVrmExpressionNameOverrides(
  value: unknown,
): VrmExpressionNameOverrides {
  const out: VrmExpressionNameOverrides = {};
  if (!value || typeof value !== 'object') {
    return out;
  }
  const v = value as Record<string, unknown>;
  for (const id of VRM_EXPRESSION_NAME_SLOT_IDS) {
    const raw = v[id];
    if (typeof raw !== 'string') {
      continue;
    }
    const t = raw.trim();
    if (t) {
      out[id] = t;
    }
  }
  return out;
}

const DEFAULT_VRM_LEGACY_EXPRESSION: VrmLegacyExpressionSettings = {
  mouthSensitivity: 1,
  emotionAutoNeutralSeconds: 10,
  blinkWhileNeutral: true,
  blinkWhileHappy: true,
  blinkWhileSad: true,
  blinkWhileAngry: true,
  blinkWhileSurprised: true,
  blinkWhileRelaxed: true,
  blinkIntensityNeutral: 1,
  blinkIntensityHappy: 1,
  blinkIntensitySad: 1,
  blinkIntensityAngry: 1,
  blinkIntensitySurprised: 1,
  blinkIntensityRelaxed: 1,
};

function boolOrFallback(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeVrmLegacyExpression(
  value: unknown,
): VrmLegacyExpressionSettings {
  const b = { ...DEFAULT_VRM_LEGACY_EXPRESSION };
  if (!value || typeof value !== 'object') {
    return b;
  }
  const o = value as Record<string, unknown>;
  const clampSens = (v: unknown, fb: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return fb;
    }
    return Math.min(2.5, Math.max(0.1, v));
  };
  const clampAutoNeutral = (v: unknown, fb: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return fb;
    }
    return Math.min(3600, Math.max(0, v));
  };
  return {
    mouthSensitivity: clampSens(o.mouthSensitivity, b.mouthSensitivity),
    emotionAutoNeutralSeconds: clampAutoNeutral(
      o.emotionAutoNeutralSeconds,
      b.emotionAutoNeutralSeconds,
    ),
    blinkWhileNeutral: boolOrFallback(o.blinkWhileNeutral, b.blinkWhileNeutral),
    blinkWhileHappy: boolOrFallback(o.blinkWhileHappy, b.blinkWhileHappy),
    blinkWhileSad: boolOrFallback(o.blinkWhileSad, b.blinkWhileSad),
    blinkWhileAngry: boolOrFallback(o.blinkWhileAngry, b.blinkWhileAngry),
    blinkWhileSurprised: boolOrFallback(
      o.blinkWhileSurprised,
      b.blinkWhileSurprised,
    ),
    blinkWhileRelaxed: boolOrFallback(o.blinkWhileRelaxed, b.blinkWhileRelaxed),
    blinkIntensityNeutral: clampUnit(
      o.blinkIntensityNeutral,
      b.blinkIntensityNeutral,
    ),
    blinkIntensityHappy: clampUnit(o.blinkIntensityHappy, b.blinkIntensityHappy),
    blinkIntensitySad: clampUnit(o.blinkIntensitySad, b.blinkIntensitySad),
    blinkIntensityAngry: clampUnit(o.blinkIntensityAngry, b.blinkIntensityAngry),
    blinkIntensitySurprised: clampUnit(
      o.blinkIntensitySurprised,
      b.blinkIntensitySurprised,
    ),
    blinkIntensityRelaxed: clampUnit(
      o.blinkIntensityRelaxed,
      b.blinkIntensityRelaxed,
    ),
  };
}

function normalizeVrmEmotionTunes(value: unknown): VrmEmotionTuneMap {
  const base = cloneVrmEmotionTunes(DEFAULT_VRM_EMOTION_TUNES);
  if (!value || typeof value !== 'object') {
    return base;
  }
  const v = value as Partial<Record<VrmTuneEmotionId, unknown>>;
  for (const id of VRM_TUNE_EMOTION_IDS) {
    if (v[id] !== undefined) {
      base[id] = normalizeOneEmotionTune(v[id], base[id]);
    }
  }
  return base;
}

function readLegacyVrmChromaBgFromStorage(): VrmChromaBgMode | undefined {
  try {
    const v = localStorage.getItem(LEGACY_VRM_BG_STORAGE_KEY);
    return normalizeVrmChromaBg(v);
  } catch {
    return undefined;
  }
}

type ApiKeyProvider = Exclude<ChatProviderOption, 'gemini-nano'>;

const STORAGE_KEY = 'react-vrm-app-settings';
const DEFAULT_AIVIS_CLOUD_MODEL_UUID = '22e8ed77-94fe-4ef2-871f-a86f94e9a579';
const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const DEFAULT_GEMINI_TTS_LANGUAGE_CODE = 'ja-JP';
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'local-model';
const DEFAULT_OPENAI_COMPATIBLE_ENDPOINT =
  'http://localhost:11434/v1/chat/completions';
const DEFAULT_OPENAI_COMPATIBLE_TTS_ENDPOINT =
  'http://localhost:8880/v1/audio/speech';
const DEFAULT_UNREAL_SPEECH_TTS_ENDPOINT =
  'https://api.v8.unrealspeech.com/stream';
const DEFAULT_ELEVENLABS_TTS_ENDPOINT =
  'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
const DEFAULT_PIPER_PLUS_BASE_PATH = `${import.meta.env.BASE_URL}piper/`;
const DEFAULT_PIPER_PLUS_MODEL_CONFIG_FILE = 'tsukuyomi-config.json';
const DEFAULT_PIPER_PLUS_MODEL_FILE = 'tsukuyomi-wavlm-300epoch.onnx';
const DEFAULT_PIPER_PLUS_VOICE_FILE = 'mei_normal.htsvoice';
const DEFAULT_OPENROUTER_MAX_CANDIDATES = 1;
const DEFAULT_OPENROUTER_MAX_WORKING = 10;
const EMPTY_MODEL_IDS: string[] = [];

function getOrderedModels(provider: ChatProviderOption): string[] {
  const models = AITuberOnAirCore.getSupportedModels(provider);
  if (provider === 'claude') {
    return [...models].reverse();
  }
  return models;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeModelIds(modelIds: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const modelId of modelIds) {
    const trimmed = modelId.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function mergeModelIds(base: string[], extras: string[]): string[] {
  const merged = [...base];
  const seen = new Set(base);

  for (const modelId of extras) {
    const trimmed = modelId.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    merged.push(trimmed);
  }

  return merged;
}

function normalizeOpenRouterDynamicFreeModels(
  value: AppSettings['llm']['openRouterDynamicFreeModels'] | undefined,
): NonNullable<AppSettings['llm']['openRouterDynamicFreeModels']> {
  return {
    models: normalizeModelIds(value?.models || []),
    fetchedAt:
      typeof value?.fetchedAt === 'number' && Number.isFinite(value.fetchedAt)
        ? value.fetchedAt
        : 0,
    maxCandidates: normalizePositiveInteger(
      value?.maxCandidates,
      DEFAULT_OPENROUTER_MAX_CANDIDATES,
    ),
  };
}

function getDefaultSettings(): AppSettings {
  return {
    llm: {
      provider: 'openai',
      model: 'gpt-4.1-nano',
      endpoint: DEFAULT_OPENAI_COMPATIBLE_ENDPOINT,
      systemPrompt: '',
      systemPromptPresets: [],
      apiKeys: {
        openai: '',
        'openai-compatible': '',
        openrouter: '',
        gemini: '',
        claude: '',
        zai: '',
        kimi: '',
        xai: '',
      },
      openRouterDynamicFreeModels: {
        models: [],
        fetchedAt: 0,
        maxCandidates: DEFAULT_OPENROUTER_MAX_CANDIDATES,
      },
    },
    tts: {
      engine: 'openai' as TTSEngineOption,
      speaker: 'alloy',
      openAiCompatibleApiKey: '',
      openAiCompatibleApiUrl: DEFAULT_OPENAI_COMPATIBLE_TTS_ENDPOINT,
      openAiCompatibleModel: DEFAULT_OPENAI_COMPATIBLE_MODEL,
      openAiCompatibleSpeed: '',
      geminiTtsModel: DEFAULT_GEMINI_TTS_MODEL,
      geminiTtsLanguageCode: DEFAULT_GEMINI_TTS_LANGUAGE_CODE,
      geminiTtsPrompt: '',
      aivisCloudApiKey: '',
      aivisCloudModelUuid: DEFAULT_AIVIS_CLOUD_MODEL_UUID,
      aivisCloudSpeakerUuid: '',
      aivisCloudStyleId: '',
      minimaxApiKey: '',
      minimaxGroupId: '',
      xaiLanguage: 'auto',
      xaiCodec: 'mp3',
      xaiSampleRate: 24000,
      xaiBitRate: 128000,
      unrealSpeechApiKey: '',
      unrealSpeechApiUrl: DEFAULT_UNREAL_SPEECH_TTS_ENDPOINT,
      unrealSpeechBitrate: '192k',
      unrealSpeechSpeed: '',
      unrealSpeechPitch: '',
      unrealSpeechCodec: 'libmp3lame',
      unrealSpeechTemperature: '',
      elevenLabsApiKey: '',
      elevenLabsApiUrl: DEFAULT_ELEVENLABS_TTS_ENDPOINT,
      elevenLabsModel: DEFAULT_ELEVENLABS_MODEL,
      elevenLabsOutputFormat: DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
      elevenLabsLanguageCode: '',
      elevenLabsStability: '',
      elevenLabsSimilarityBoost: '',
      elevenLabsStyle: '',
      elevenLabsUseSpeakerBoost: 'default',
      elevenLabsSpeed: '',
      elevenLabsSeed: '',
      elevenLabsApplyTextNormalization: 'default',
      piperPlusBasePath: DEFAULT_PIPER_PLUS_BASE_PATH,
      piperPlusModelConfigFile: DEFAULT_PIPER_PLUS_MODEL_CONFIG_FILE,
      piperPlusModelFile: DEFAULT_PIPER_PLUS_MODEL_FILE,
      piperPlusVoiceFile: DEFAULT_PIPER_PLUS_VOICE_FILE,
      piperPlusSpeed: '',
      piperPlusNoiseScale: '',
      voicepeakEmotionTagMapByNarrator: {},
    },
    stream: {
      platform: 'none',
      youtubeApiKey: '',
      youtubeLiveId: '',
      youtubeEnabled: false,
      youtubeCommentIntervalMs: 20_000,
      twitchClientId: '',
      twitchAccessToken: '',
      twitchChannel: '',
      twitchEnabled: false,
      twitchCommentIntervalMs: 20_000,
      jikkyoTcpEnabled: false,
      jikkyoListenPort: 50000,
      jikkyoBouyomiPort: 50001,
      jikkyoForwardToBouyomi: false,
      jikkyoSendToAi: true,
      jikkyoAiHeaderEnabled: true,
      jikkyoAiHeaderText: '掲示板：',
    },
    visual: {
      vrmChromaBg: 'blue',
      vrmLighting: { ...DEFAULT_VRM_LIGHTING },
      vrmExpressionBlend: { ...DEFAULT_VRM_EXPRESSION_BLEND },
      vrmEmotionTunes: normalizeVrmEmotionTunes(undefined),
      vrmExpressionNames: normalizeVrmExpressionNameOverrides(undefined),
      vrmLegacyExpression: normalizeVrmLegacyExpression(undefined),
    },
  };
}

function normalizeVoicepeakEmotionTagMap(
  value: unknown,
): Record<string, Record<string, string>> {
  if (value == null || typeof value !== 'object') {
    return {};
  }
  const out: Record<string, Record<string, string>> = {};
  for (const [narratorId, inner] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const nid = narratorId.trim();
    if (!nid || inner == null || typeof inner !== 'object') continue;
    const innerOut: Record<string, string> = {};
    for (const [tag, param] of Object.entries(
      inner as Record<string, unknown>,
    )) {
      const t = String(tag).trim().toLowerCase();
      const p = String(param ?? '').trim();
      if (!t || !p) continue;
      innerOut[t] = p;
    }
    if (Object.keys(innerOut).length > 0) {
      out[nid] = innerOut;
    }
  }
  return out;
}

/** 部分データを既定値とマージして `AppSettings` にする（localStorage / バックアップ共通） */
export function reconcileAppSettings(saved: unknown): AppSettings {
  if (saved == null || typeof saved !== 'object') {
    return getDefaultSettings();
  }
  const partial = saved as Partial<AppSettings>;
  const defaults = getDefaultSettings();
  return {
    llm: {
      ...defaults.llm,
      ...partial.llm,
      apiKeys: { ...defaults.llm.apiKeys, ...partial.llm?.apiKeys },
      openRouterDynamicFreeModels: normalizeOpenRouterDynamicFreeModels(
        partial.llm?.openRouterDynamicFreeModels,
      ),
      systemPrompt:
        typeof partial.llm?.systemPrompt === 'string'
          ? partial.llm.systemPrompt
          : defaults.llm.systemPrompt,
      systemPromptPresets: normalizeSystemPromptPresets(
        partial.llm?.systemPromptPresets,
      ),
    },
    tts: {
      ...defaults.tts,
      ...partial.tts,
      voicepeakEmotionTagMapByNarrator: normalizeVoicepeakEmotionTagMap(
        partial.tts?.voicepeakEmotionTagMapByNarrator ??
          defaults.tts.voicepeakEmotionTagMapByNarrator,
      ),
    },
    stream: { ...defaults.stream, ...partial.stream },
    visual: {
      ...defaults.visual,
      ...(partial.visual || {}),
      vrmChromaBg:
        normalizeVrmChromaBg(partial.visual?.vrmChromaBg) ??
        readLegacyVrmChromaBgFromStorage() ??
        defaults.visual.vrmChromaBg,
      vrmLighting: normalizeVrmLighting(partial.visual?.vrmLighting),
      vrmExpressionBlend: normalizeVrmExpressionBlend(
        partial.visual?.vrmExpressionBlend,
      ),
      vrmEmotionTunes: normalizeVrmEmotionTunes(partial.visual?.vrmEmotionTunes),
      vrmExpressionNames: normalizeVrmExpressionNameOverrides(
        partial.visual?.vrmExpressionNames,
      ),
      vrmLegacyExpression: normalizeVrmLegacyExpression(
        partial.visual?.vrmLegacyExpression,
      ),
    },
  };
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return reconcileAppSettings(JSON.parse(raw));
    }
  } catch {
    // ignore parse errors
  }
  return getDefaultSettings();
}

function saveSettings(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [openRouterRefreshError, setOpenRouterRefreshError] = useState('');
  const [
    isRefreshingOpenRouterFreeModels,
    setIsRefreshingOpenRouterFreeModels,
  ] = useState(false);
  const openRouterDynamicModels = useMemo(
    () => settings.llm.openRouterDynamicFreeModels?.models || EMPTY_MODEL_IDS,
    [settings.llm.openRouterDynamicFreeModels?.models],
  );

  const availableModels = useMemo(() => {
    const models = getOrderedModels(settings.llm.provider);
    if (settings.llm.provider === 'openrouter') {
      return mergeModelIds(models, openRouterDynamicModels);
    }
    if (settings.llm.provider !== 'openai-compatible') {
      return models;
    }
    if (settings.llm.model) {
      return [settings.llm.model];
    }
    return [DEFAULT_OPENAI_COMPATIBLE_MODEL];
  }, [settings.llm.provider, settings.llm.model, openRouterDynamicModels]);

  // Persist settings on change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  /** 別タブ／別ウィンドウが同じ localStorage を更新したときに追従 */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || e.storageArea !== localStorage) return;
      if (e.newValue == null) return;
      try {
        setSettings(loadSettings());
      } catch {
        // ignore
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const applySettingsFromBackup = useCallback((raw: unknown) => {
    setSettings(reconcileAppSettings(raw));
  }, []);

  const updateLLMProvider = useCallback(
    (provider: ChatProviderOption) => {
      const baseModels = getOrderedModels(provider);
      const models =
        provider === 'openrouter'
          ? mergeModelIds(baseModels, openRouterDynamicModels)
          : baseModels;
      const nextModel =
        provider === 'openai-compatible'
          ? DEFAULT_OPENAI_COMPATIBLE_MODEL
          : models[0] || '';
      setSettings((prev) => ({
        ...prev,
        llm: {
          ...prev.llm,
          provider,
          model: nextModel,
          endpoint:
            provider === 'openai-compatible'
              ? prev.llm.endpoint || DEFAULT_OPENAI_COMPATIBLE_ENDPOINT
              : prev.llm.endpoint,
        },
      }));
    },
    [openRouterDynamicModels],
  );

  const updateLLMModel = useCallback((model: string) => {
    setSettings((prev) => ({
      ...prev,
      llm: { ...prev.llm, model },
    }));
  }, []);

  const updateLLMApiKey = useCallback(
    (provider: ChatProviderOption, key: string) => {
      if (provider === 'gemini-nano') {
        return;
      }
      setSettings((prev) => ({
        ...prev,
        llm: {
          ...prev.llm,
          apiKeys: {
            ...prev.llm.apiKeys,
            [provider as ApiKeyProvider]: key,
          },
        },
      }));
    },
    [],
  );

  const updateLLMEndpoint = useCallback((endpoint: string) => {
    setSettings((prev) => ({
      ...prev,
      llm: { ...prev.llm, endpoint },
    }));
  }, []);

  const updateSystemPrompt = useCallback((systemPrompt: string) => {
    setSettings((prev) => ({
      ...prev,
      llm: { ...prev.llm, systemPrompt },
    }));
  }, []);

  const addSystemPromptPreset = useCallback((name: string) => {
    setSettings((prev) => {
      const trimmed = name.trim();
      const presetName =
        trimmed || `プリセット ${prev.llm.systemPromptPresets.length + 1}`;
      return {
        ...prev,
        llm: {
          ...prev.llm,
          systemPromptPresets: [
            ...prev.llm.systemPromptPresets,
            {
              id: newPresetId(),
              name: presetName,
              text: prev.llm.systemPrompt,
            },
          ],
        },
      };
    });
  }, []);

  const applySystemPromptPreset = useCallback((id: string) => {
    setSettings((prev) => {
      const preset = prev.llm.systemPromptPresets.find((p) => p.id === id);
      if (!preset) return prev;
      return {
        ...prev,
        llm: { ...prev.llm, systemPrompt: preset.text },
      };
    });
  }, []);

  const removeSystemPromptPreset = useCallback((id: string) => {
    setSettings((prev) => ({
      ...prev,
      llm: {
        ...prev.llm,
        systemPromptPresets: prev.llm.systemPromptPresets.filter(
          (p) => p.id !== id,
        ),
      },
    }));
  }, []);

  const refreshOpenRouterDynamicFreeModels = useCallback(async () => {
    const apiKey = settings.llm.apiKeys.openrouter?.trim() || '';
    if (!apiKey) {
      const message = 'OpenRouter API key is required.';
      setOpenRouterRefreshError(message);
      return null;
    }

    setIsRefreshingOpenRouterFreeModels(true);
    setOpenRouterRefreshError('');

    try {
      const maxCandidates = normalizePositiveInteger(
        settings.llm.openRouterDynamicFreeModels?.maxCandidates,
        DEFAULT_OPENROUTER_MAX_CANDIDATES,
      );
      const result: RefreshOpenRouterFreeModelsResult =
        await refreshOpenRouterFreeModels({
          apiKey,
          maxCandidates,
          maxWorking: DEFAULT_OPENROUTER_MAX_WORKING,
        });

      setSettings((prev) => ({
        ...prev,
        llm: {
          ...prev.llm,
          openRouterDynamicFreeModels: {
            ...normalizeOpenRouterDynamicFreeModels(
              prev.llm.openRouterDynamicFreeModels,
            ),
            models: normalizeModelIds(result.working),
            fetchedAt: result.fetchedAt,
          },
        },
      }));

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOpenRouterRefreshError(message);
      return null;
    } finally {
      setIsRefreshingOpenRouterFreeModels(false);
    }
  }, [
    settings.llm.apiKeys.openrouter,
    settings.llm.openRouterDynamicFreeModels?.maxCandidates,
  ]);

  const updateOpenRouterMaxCandidates = useCallback((maxCandidates: number) => {
    const normalized = normalizePositiveInteger(
      maxCandidates,
      DEFAULT_OPENROUTER_MAX_CANDIDATES,
    );
    setSettings((prev) => ({
      ...prev,
      llm: {
        ...prev.llm,
        openRouterDynamicFreeModels: {
          ...normalizeOpenRouterDynamicFreeModels(
            prev.llm.openRouterDynamicFreeModels,
          ),
          maxCandidates: normalized,
        },
      },
    }));
  }, []);

  const updateTTSEngine = useCallback((engine: TTSEngineOption) => {
    const defaultSpeaker: Record<string, string> = {
      openai: 'alloy',
      geminiTts: 'Zephyr',
      openaiCompatible: '',
      voicepeak: 'Kasane Teto',
      voicevox: '',
      aivisSpeech: '',
      aivisCloud: DEFAULT_AIVIS_CLOUD_MODEL_UUID,
      minimax: 'male-qn-qingse',
      xai: 'eve',
      unrealSpeech: 'af_bella',
      elevenLabs: '',
      piperPlus: 'default',
      none: '',
    };
    setSettings((prev) => ({
      ...prev,
      tts: {
        ...prev.tts,
        engine,
        speaker: defaultSpeaker[engine] ?? '',
        openAiCompatibleApiUrl:
          engine === 'openaiCompatible'
            ? prev.tts.openAiCompatibleApiUrl ||
              DEFAULT_OPENAI_COMPATIBLE_TTS_ENDPOINT
            : prev.tts.openAiCompatibleApiUrl,
        openAiCompatibleModel:
          engine === 'openaiCompatible'
            ? prev.tts.openAiCompatibleModel || DEFAULT_OPENAI_COMPATIBLE_MODEL
            : prev.tts.openAiCompatibleModel,
        openAiCompatibleSpeed:
          engine === 'openaiCompatible'
            ? prev.tts.openAiCompatibleSpeed || ''
            : prev.tts.openAiCompatibleSpeed,
        geminiTtsModel:
          engine === 'geminiTts'
            ? prev.tts.geminiTtsModel || DEFAULT_GEMINI_TTS_MODEL
            : prev.tts.geminiTtsModel,
        geminiTtsLanguageCode:
          engine === 'geminiTts'
            ? prev.tts.geminiTtsLanguageCode || DEFAULT_GEMINI_TTS_LANGUAGE_CODE
            : prev.tts.geminiTtsLanguageCode,
        geminiTtsPrompt:
          engine === 'geminiTts'
            ? prev.tts.geminiTtsPrompt || ''
            : prev.tts.geminiTtsPrompt,
        aivisCloudModelUuid:
          engine === 'aivisCloud'
            ? prev.tts.aivisCloudModelUuid || DEFAULT_AIVIS_CLOUD_MODEL_UUID
            : prev.tts.aivisCloudModelUuid,
        aivisCloudSpeakerUuid:
          engine === 'aivisCloud'
            ? prev.tts.aivisCloudSpeakerUuid || ''
            : prev.tts.aivisCloudSpeakerUuid,
        aivisCloudStyleId:
          engine === 'aivisCloud'
            ? prev.tts.aivisCloudStyleId || ''
            : prev.tts.aivisCloudStyleId,
        xaiLanguage:
          engine === 'xai'
            ? prev.tts.xaiLanguage || 'auto'
            : prev.tts.xaiLanguage,
        xaiCodec:
          engine === 'xai' ? prev.tts.xaiCodec || 'mp3' : prev.tts.xaiCodec,
        xaiSampleRate:
          engine === 'xai'
            ? prev.tts.xaiSampleRate || 24000
            : prev.tts.xaiSampleRate,
        xaiBitRate:
          engine === 'xai'
            ? prev.tts.xaiBitRate || 128000
            : prev.tts.xaiBitRate,
        unrealSpeechApiUrl:
          engine === 'unrealSpeech'
            ? prev.tts.unrealSpeechApiUrl || DEFAULT_UNREAL_SPEECH_TTS_ENDPOINT
            : prev.tts.unrealSpeechApiUrl,
        unrealSpeechBitrate:
          engine === 'unrealSpeech'
            ? prev.tts.unrealSpeechBitrate || '192k'
            : prev.tts.unrealSpeechBitrate,
        unrealSpeechCodec:
          engine === 'unrealSpeech'
            ? prev.tts.unrealSpeechCodec || 'libmp3lame'
            : prev.tts.unrealSpeechCodec,
        elevenLabsApiUrl:
          engine === 'elevenLabs'
            ? prev.tts.elevenLabsApiUrl || DEFAULT_ELEVENLABS_TTS_ENDPOINT
            : prev.tts.elevenLabsApiUrl,
        elevenLabsModel:
          engine === 'elevenLabs'
            ? prev.tts.elevenLabsModel || DEFAULT_ELEVENLABS_MODEL
            : prev.tts.elevenLabsModel,
        elevenLabsOutputFormat:
          engine === 'elevenLabs'
            ? prev.tts.elevenLabsOutputFormat ||
              DEFAULT_ELEVENLABS_OUTPUT_FORMAT
            : prev.tts.elevenLabsOutputFormat,
        elevenLabsUseSpeakerBoost:
          engine === 'elevenLabs'
            ? prev.tts.elevenLabsUseSpeakerBoost || 'default'
            : prev.tts.elevenLabsUseSpeakerBoost,
        elevenLabsApplyTextNormalization:
          engine === 'elevenLabs'
            ? prev.tts.elevenLabsApplyTextNormalization || 'default'
            : prev.tts.elevenLabsApplyTextNormalization,
        piperPlusBasePath:
          engine === 'piperPlus'
            ? prev.tts.piperPlusBasePath || DEFAULT_PIPER_PLUS_BASE_PATH
            : prev.tts.piperPlusBasePath,
        piperPlusModelConfigFile:
          engine === 'piperPlus'
            ? prev.tts.piperPlusModelConfigFile ||
              DEFAULT_PIPER_PLUS_MODEL_CONFIG_FILE
            : prev.tts.piperPlusModelConfigFile,
        piperPlusModelFile:
          engine === 'piperPlus'
            ? prev.tts.piperPlusModelFile || DEFAULT_PIPER_PLUS_MODEL_FILE
            : prev.tts.piperPlusModelFile,
        piperPlusVoiceFile:
          engine === 'piperPlus'
            ? prev.tts.piperPlusVoiceFile || DEFAULT_PIPER_PLUS_VOICE_FILE
            : prev.tts.piperPlusVoiceFile,
        piperPlusSpeed:
          engine === 'piperPlus'
            ? prev.tts.piperPlusSpeed || ''
            : prev.tts.piperPlusSpeed,
        piperPlusNoiseScale:
          engine === 'piperPlus'
            ? prev.tts.piperPlusNoiseScale || ''
            : prev.tts.piperPlusNoiseScale,
      },
    }));
  }, []);

  const updateTTSSpeaker = useCallback((speaker: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, speaker: speaker.trim() },
    }));
  }, []);

  const updateOpenAiCompatibleApiKey = useCallback((key: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, openAiCompatibleApiKey: key },
    }));
  }, []);

  const updateOpenAiCompatibleApiUrl = useCallback((url: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, openAiCompatibleApiUrl: url },
    }));
  }, []);

  const updateOpenAiCompatibleModel = useCallback((model: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, openAiCompatibleModel: model },
    }));
  }, []);

  const updateOpenAiCompatibleSpeed = useCallback((speed: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, openAiCompatibleSpeed: speed },
    }));
  }, []);

  const updateGeminiTtsModel = useCallback((model: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, geminiTtsModel: model },
    }));
  }, []);

  const updateGeminiTtsLanguageCode = useCallback((languageCode: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, geminiTtsLanguageCode: languageCode },
    }));
  }, []);

  const updateGeminiTtsPrompt = useCallback((prompt: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, geminiTtsPrompt: prompt },
    }));
  }, []);

  const updateVoicevoxApiUrl = useCallback((url: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, voicevoxApiUrl: url },
    }));
  }, []);

  const updateVoicepeakApiUrl = useCallback((url: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, voicepeakApiUrl: url },
    }));
  }, []);

  const updateVoicepeakEmotionTagMapEntry = useCallback(
    (narratorId: string, emotionTag: string, emotionParam: string) => {
      const nid = narratorId.trim();
      const tag = emotionTag.trim().toLowerCase();
      const param = emotionParam.trim();
      setSettings((prev) => {
        const prevAll = normalizeVoicepeakEmotionTagMap(
          prev.tts.voicepeakEmotionTagMapByNarrator,
        );
        const nextInner = { ...(prevAll[nid] ?? {}) };
        if (!tag) {
          return prev;
        }
        if (!param) {
          delete nextInner[tag];
        } else {
          nextInner[tag] = param;
        }
        const nextAll = { ...prevAll };
        if (Object.keys(nextInner).length === 0) {
          delete nextAll[nid];
        } else {
          nextAll[nid] = nextInner;
        }
        return {
          ...prev,
          tts: {
            ...prev.tts,
            voicepeakEmotionTagMapByNarrator: nextAll,
          },
        };
      });
    },
    [],
  );

  const updateAivisSpeechApiUrl = useCallback((url: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, aivisSpeechApiUrl: url },
    }));
  }, []);

  const updateAivisCloudApiKey = useCallback((key: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, aivisCloudApiKey: key },
    }));
  }, []);

  const updateAivisCloudModelUuid = useCallback((modelUuid: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, aivisCloudModelUuid: modelUuid },
    }));
  }, []);

  const updateAivisCloudSpeakerUuid = useCallback((speakerUuid: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, aivisCloudSpeakerUuid: speakerUuid },
    }));
  }, []);

  const updateAivisCloudStyleId = useCallback((styleId: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, aivisCloudStyleId: styleId },
    }));
  }, []);

  const updateMinimaxApiKey = useCallback((key: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, minimaxApiKey: key },
    }));
  }, []);

  const updateMinimaxGroupId = useCallback((groupId: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, minimaxGroupId: groupId },
    }));
  }, []);

  const updateXaiLanguage = useCallback((language: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, xaiLanguage: language },
    }));
  }, []);

  const updateXaiCodec = useCallback((codec: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, xaiCodec: codec },
    }));
  }, []);

  const updateXaiSampleRate = useCallback((sampleRate: number) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, xaiSampleRate: sampleRate },
    }));
  }, []);

  const updateXaiBitRate = useCallback((bitRate: number) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, xaiBitRate: bitRate },
    }));
  }, []);

  const updateTtsField = useCallback(
    <TKey extends keyof AppSettings['tts']>(
      key: TKey,
      value: AppSettings['tts'][TKey],
    ) => {
      setSettings((prev) => ({
        ...prev,
        tts: { ...prev.tts, [key]: value },
      }));
    },
    [],
  );

  const updatePiperPlusBasePath = useCallback((basePath: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, piperPlusBasePath: basePath },
    }));
  }, []);

  const updatePiperPlusModelConfigFile = useCallback(
    (modelConfigFile: string) => {
      setSettings((prev) => ({
        ...prev,
        tts: { ...prev.tts, piperPlusModelConfigFile: modelConfigFile },
      }));
    },
    [],
  );

  const updatePiperPlusModelFile = useCallback((modelFile: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, piperPlusModelFile: modelFile },
    }));
  }, []);

  const updatePiperPlusVoiceFile = useCallback((voiceFile: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, piperPlusVoiceFile: voiceFile },
    }));
  }, []);

  const updatePiperPlusSpeed = useCallback((speed: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, piperPlusSpeed: speed },
    }));
  }, []);

  const updatePiperPlusNoiseScale = useCallback((noiseScale: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, piperPlusNoiseScale: noiseScale },
    }));
  }, []);

  const updateStreamPlatform = useCallback(
    (platform: StreamingPlatformOption) => {
      setSettings((prev) => ({
        ...prev,
        stream: { ...prev.stream, platform },
      }));
    },
    [],
  );

  const updateYoutubeApiKey = useCallback((youtubeApiKey: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, youtubeApiKey },
    }));
  }, []);

  const updateYoutubeLiveId = useCallback((youtubeLiveId: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, youtubeLiveId },
    }));
  }, []);

  const updateYoutubeEnabled = useCallback((youtubeEnabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, youtubeEnabled },
    }));
  }, []);

  const updateYoutubeCommentIntervalMs = useCallback(
    (youtubeCommentIntervalMs: number) => {
      setSettings((prev) => ({
        ...prev,
        stream: { ...prev.stream, youtubeCommentIntervalMs },
      }));
    },
    [],
  );

  const updateTwitchClientId = useCallback((twitchClientId: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, twitchClientId },
    }));
  }, []);

  const updateTwitchAccessToken = useCallback((twitchAccessToken: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, twitchAccessToken },
    }));
  }, []);

  const updateTwitchChannel = useCallback((twitchChannel: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, twitchChannel },
    }));
  }, []);

  const updateTwitchEnabled = useCallback((twitchEnabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, twitchEnabled },
    }));
  }, []);

  const updateTwitchCommentIntervalMs = useCallback(
    (twitchCommentIntervalMs: number) => {
      setSettings((prev) => ({
        ...prev,
        stream: { ...prev.stream, twitchCommentIntervalMs },
      }));
    },
    [],
  );

  const updateJikkyoTcpEnabled = useCallback((jikkyoTcpEnabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, jikkyoTcpEnabled },
    }));
  }, []);

  const updateJikkyoListenPort = useCallback((jikkyoListenPort: number) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, jikkyoListenPort },
    }));
  }, []);

  const updateJikkyoBouyomiPort = useCallback((jikkyoBouyomiPort: number) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, jikkyoBouyomiPort },
    }));
  }, []);

  const updateJikkyoForwardToBouyomi = useCallback(
    (jikkyoForwardToBouyomi: boolean) => {
      setSettings((prev) => ({
        ...prev,
        stream: { ...prev.stream, jikkyoForwardToBouyomi },
      }));
    },
    [],
  );

  const updateJikkyoSendToAi = useCallback((jikkyoSendToAi: boolean) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, jikkyoSendToAi },
    }));
  }, []);

  const updateJikkyoAiHeaderEnabled = useCallback(
    (jikkyoAiHeaderEnabled: boolean) => {
      setSettings((prev) => ({
        ...prev,
        stream: { ...prev.stream, jikkyoAiHeaderEnabled },
      }));
    },
    [],
  );

  const updateJikkyoAiHeaderText = useCallback((jikkyoAiHeaderText: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, jikkyoAiHeaderText },
    }));
  }, []);

  const updateVrmChromaBg = useCallback((vrmChromaBg: VrmChromaBgMode) => {
    setSettings((prev) => ({
      ...prev,
      visual: { ...prev.visual, vrmChromaBg },
    }));
  }, []);

  const updateVrmLighting = useCallback(
    (patch: Partial<VrmLightingSettings>) => {
      setSettings((prev) => ({
        ...prev,
        visual: {
          ...prev.visual,
          vrmLighting: normalizeVrmLighting({
            ...prev.visual.vrmLighting,
            ...patch,
          }),
        },
      }));
    },
    [],
  );

  const updateVrmExpressionBlend = useCallback(
    (patch: Partial<VrmExpressionBlendSettings>) => {
      setSettings((prev) => ({
        ...prev,
        visual: {
          ...prev.visual,
          vrmExpressionBlend: normalizeVrmExpressionBlend({
            ...prev.visual.vrmExpressionBlend,
            ...patch,
          }),
        },
      }));
    },
    [],
  );

  const updateVrmEmotionTune = useCallback(
    (emotion: VrmTuneEmotionId, patch: Partial<VrmPerEmotionTune>) => {
      setSettings((prev) => ({
        ...prev,
        visual: {
          ...prev.visual,
          vrmEmotionTunes: normalizeVrmEmotionTunes({
            ...prev.visual.vrmEmotionTunes,
            [emotion]: {
              ...prev.visual.vrmEmotionTunes[emotion],
              ...patch,
            },
          }),
        },
      }));
    },
    [],
  );

  const updateVrmExpressionNames = useCallback(
    (patch: Partial<VrmExpressionNameOverrides>) => {
      setSettings((prev) => ({
        ...prev,
        visual: {
          ...prev.visual,
          vrmExpressionNames: normalizeVrmExpressionNameOverrides({
            ...prev.visual.vrmExpressionNames,
            ...patch,
          }),
        },
      }));
    },
    [],
  );

  const updateVrmLegacyExpression = useCallback(
    (patch: Partial<VrmLegacyExpressionSettings>) => {
      setSettings((prev) => ({
        ...prev,
        visual: {
          ...prev.visual,
          vrmLegacyExpression: normalizeVrmLegacyExpression({
            ...prev.visual.vrmLegacyExpression,
            ...patch,
          }),
        },
      }));
    },
    [],
  );

  const getApiKeyForProvider = useCallback(
    (provider: ChatProviderOption): string => {
      if (provider === 'gemini-nano') {
        return '';
      }
      return settings.llm.apiKeys[provider as ApiKeyProvider] || '';
    },
    [settings.llm.apiKeys],
  );

  return {
    settings,
    applySettingsFromBackup,
    availableModels,
    updateLLMProvider,
    updateLLMModel,
    updateLLMApiKey,
    updateLLMEndpoint,
    updateSystemPrompt,
    addSystemPromptPreset,
    applySystemPromptPreset,
    removeSystemPromptPreset,
    refreshOpenRouterDynamicFreeModels,
    isRefreshingOpenRouterFreeModels,
    openRouterRefreshError,
    updateOpenRouterMaxCandidates,
    updateTTSEngine,
    updateTTSSpeaker,
    updateOpenAiCompatibleApiKey,
    updateOpenAiCompatibleApiUrl,
    updateOpenAiCompatibleModel,
    updateOpenAiCompatibleSpeed,
    updateGeminiTtsModel,
    updateGeminiTtsLanguageCode,
    updateGeminiTtsPrompt,
    updateVoicevoxApiUrl,
    updateVoicepeakApiUrl,
    updateVoicepeakEmotionTagMapEntry,
    updateAivisSpeechApiUrl,
    updateAivisCloudApiKey,
    updateAivisCloudModelUuid,
    updateAivisCloudSpeakerUuid,
    updateAivisCloudStyleId,
    updateMinimaxApiKey,
    updateMinimaxGroupId,
    updateXaiLanguage,
    updateXaiCodec,
    updateXaiSampleRate,
    updateXaiBitRate,
    updateTtsField,
    updatePiperPlusBasePath,
    updatePiperPlusModelConfigFile,
    updatePiperPlusModelFile,
    updatePiperPlusVoiceFile,
    updatePiperPlusSpeed,
    updatePiperPlusNoiseScale,
    updateStreamPlatform,
    updateYoutubeApiKey,
    updateYoutubeLiveId,
    updateYoutubeEnabled,
    updateYoutubeCommentIntervalMs,
    updateTwitchClientId,
    updateTwitchAccessToken,
    updateTwitchChannel,
    updateTwitchEnabled,
    updateTwitchCommentIntervalMs,
    updateJikkyoTcpEnabled,
    updateJikkyoListenPort,
    updateJikkyoBouyomiPort,
    updateJikkyoForwardToBouyomi,
    updateJikkyoSendToAi,
    updateJikkyoAiHeaderEnabled,
    updateJikkyoAiHeaderText,
    updateVrmChromaBg,
    updateVrmLighting,
    updateVrmExpressionBlend,
    updateVrmEmotionTune,
    updateVrmExpressionNames,
    updateVrmLegacyExpression,
    getApiKeyForProvider,
  };
}
