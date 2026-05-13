export type ChatProviderOption =
  | 'openai'
  | 'openai-compatible'
  | 'openrouter'
  | 'gemini'
  | 'gemini-nano'
  | 'claude'
  | 'zai'
  | 'kimi'
  | 'xai';
export type TTSEngineOption =
  | 'openai'
  | 'geminiTts'
  | 'openaiCompatible'
  | 'voicevox'
  | 'voicepeak'
  | 'aivisSpeech'
  | 'aivisCloud'
  | 'minimax'
  | 'xai'
  | 'unrealSpeech'
  | 'elevenLabs'
  | 'piperPlus'
  | 'none';
export type StreamingPlatformOption = 'none' | 'youtube' | 'twitch';

/** VRM シーンのクロマキー背景（PCチャット・ステージ窓。スマホチャットは暗色固定） */
export type VrmChromaBgMode = 'green' | 'blue' | 'purple';

/** VRM シーンのライト（Three.js の Ambient / Directional） */
export interface VrmLightingSettings {
  ambientIntensity: number;
  directionalIntensity: number;
  /** 指向光の位置（ワールド座標）。`target` は原点固定で、ここから原点へ向かう平行光 */
  directionalLightX: number;
  directionalLightY: number;
  directionalLightZ: number;
}

/**
 * 感情プリセット・口パク・アイドル由来のまばたきの干渉を抑えるためのブレンド係数。
 */
export interface VrmExpressionBlendSettings {
  /** 感情プリセットが取りうる最大ウェイト（0〜1）。低くすると口・まばたきとぶつかりにくい */
  moodMaxWeight: number;
  /** 発話中のみ感情ウェイトに掛ける倍率（0〜1）。口パクを優先したいときに下げる */
  moodScaleWhileSpeaking: number;
  /** 感情の変化速度（0.05〜1）。小さいほど滑らかで、一瞬の崩れを目立たせにくい */
  moodBlendSpeed: number;
  /** 口（Aa）の追従速度（0.05〜1） */
  mouthBlendSpeed: number;
  /** まばたき（Blink）が強いとき感情を弱める量（0〜1）。0でオフ */
  reduceMoodDuringBlink: number;
}

/** `[neutral]` 等のヘッダと対応するチューニングキー */
export const VRM_TUNE_EMOTION_IDS = [
  'neutral',
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
] as const;

export type VrmTuneEmotionId = (typeof VRM_TUNE_EMOTION_IDS)[number];

/** 感情ごとのまばたき・口パク・ニュートラル復帰 */
export interface VrmPerEmotionTune {
  /** まばたき検出に掛ける係数（0〜2）。大きいほど Blink が表情抑え込みに効く */
  blinkIntensity: number;
  /** 口パク（Aa）に掛ける係数（0〜2） */
  mouthIntensity: number;
  /** この感情をやめたあとニュートラルへ戻る目安の秒（指数減衰の時定数） */
  neutralRecoverSec: number;
}

export type VrmEmotionTuneMap = Record<VrmTuneEmotionId, VrmPerEmotionTune>;

/** `expressionManager` に渡す名前のスロット（感情タグ・口・まばたき検出） */
export const VRM_EXPRESSION_NAME_SLOT_IDS = [
  'happy',
  'angry',
  'sad',
  'surprised',
  'relaxed',
  'aa',
  'blink',
] as const;

export type VrmExpressionNameSlotId =
  (typeof VRM_EXPRESSION_NAME_SLOT_IDS)[number];

/**
 * VRM 0.x 等でシェイプ名が `happy` / `aa` と一致しないときの上書き。
 * 空（未設定）は three-vrm のプリセット名（小文字）をそのまま使う。
 */
export type VrmExpressionNameOverrides = Partial<
  Record<VrmExpressionNameSlotId, string>
>;

/**
 * 旧 react-vrm-app 相当の表情制御（手動まばたき・感情オンオフ・一定秒後ニュートラル）。
 * `vrmExpressionBlend` の口ブレンド速度（mouthBlendSpeed）も併用する。
 */
export interface VrmLegacyExpressionSettings {
  /** 口パク入力に掛ける感度（0.1〜2 程度）。大きいほど口が開きやすい */
  mouthSensitivity: number;
  /** 0 で無効。それ以外は秒後にニュートラル表情へ戻す（プレビュー中は無効） */
  emotionAutoNeutralSeconds: number;
  blinkWhileNeutral: boolean;
  blinkWhileHappy: boolean;
  blinkWhileSad: boolean;
  blinkWhileAngry: boolean;
  blinkWhileSurprised: boolean;
  blinkWhileRelaxed: boolean;
  blinkIntensityNeutral: number;
  blinkIntensityHappy: number;
  blinkIntensitySad: number;
  blinkIntensityAngry: number;
  blinkIntensitySurprised: number;
  blinkIntensityRelaxed: number;
}

export interface VisualSettings {
  vrmChromaBg: VrmChromaBgMode;
  vrmLighting: VrmLightingSettings;
  vrmExpressionBlend: VrmExpressionBlendSettings;
  vrmEmotionTunes: VrmEmotionTuneMap;
  vrmExpressionNames: VrmExpressionNameOverrides;
  vrmLegacyExpression: VrmLegacyExpressionSettings;
}

export interface ProviderApiKeys {
  openai?: string;
  'openai-compatible'?: string;
  openrouter?: string;
  gemini?: string;
  claude?: string;
  zai?: string;
  kimi?: string;
  xai?: string;
}

export interface SystemPromptPreset {
  id: string;
  name: string;
  text: string;
}

export interface LLMSettings {
  provider: ChatProviderOption;
  model: string;
  endpoint?: string;
  /** 会話のシステムメッセージ */
  systemPrompt: string;
  /** 保存したシステムプロンプトのプリセット */
  systemPromptPresets: SystemPromptPreset[];
  apiKeys: ProviderApiKeys;
  openRouterDynamicFreeModels?: {
    models: string[];
    fetchedAt: number;
    maxCandidates: number;
  };
}

export interface TTSSettings {
  engine: TTSEngineOption;
  speaker: string;
  openAiCompatibleApiKey?: string;
  openAiCompatibleApiUrl?: string;
  openAiCompatibleModel?: string;
  openAiCompatibleSpeed?: string;
  geminiTtsModel?: string;
  geminiTtsLanguageCode?: string;
  geminiTtsPrompt?: string;
  voicevoxApiUrl?: string;
  voicepeakApiUrl?: string;
  aivisSpeechApiUrl?: string;
  aivisCloudApiKey?: string;
  aivisCloudModelUuid?: string;
  aivisCloudSpeakerUuid?: string;
  aivisCloudStyleId?: string;
  minimaxApiKey?: string;
  minimaxGroupId?: string;
  xaiLanguage?: string;
  xaiCodec?: string;
  xaiSampleRate?: number;
  xaiBitRate?: number;
  unrealSpeechApiKey?: string;
  unrealSpeechApiUrl?: string;
  unrealSpeechBitrate?: string;
  unrealSpeechSpeed?: string;
  unrealSpeechPitch?: string;
  unrealSpeechCodec?: string;
  unrealSpeechTemperature?: string;
  elevenLabsApiKey?: string;
  elevenLabsApiUrl?: string;
  elevenLabsModel?: string;
  elevenLabsOutputFormat?: string;
  elevenLabsLanguageCode?: string;
  elevenLabsStability?: string;
  elevenLabsSimilarityBoost?: string;
  elevenLabsStyle?: string;
  elevenLabsUseSpeakerBoost?: 'default' | 'true' | 'false';
  elevenLabsSpeed?: string;
  elevenLabsSeed?: string;
  elevenLabsApplyTextNormalization?: 'default' | 'auto' | 'on' | 'off';
  piperPlusBasePath?: string;
  piperPlusModelConfigFile?: string;
  piperPlusModelFile?: string;
  piperPlusVoiceFile?: string;
  piperPlusSpeed?: string;
  piperPlusNoiseScale?: string;
}

export interface StreamSettings {
  platform: StreamingPlatformOption;
  youtubeApiKey: string;
  youtubeLiveId: string;
  youtubeEnabled: boolean;
  youtubeCommentIntervalMs: number;
  twitchClientId: string;
  twitchAccessToken: string;
  twitchChannel: string;
  twitchEnabled: boolean;
  twitchCommentIntervalMs: number;
  jikkyoTcpEnabled: boolean;
  jikkyoListenPort: number;
  jikkyoBouyomiPort: number;
  jikkyoForwardToBouyomi: boolean;
  jikkyoSendToAi: boolean;
  jikkyoAiHeaderEnabled: boolean;
  jikkyoAiHeaderText: string;
}

export interface AppSettings {
  llm: LLMSettings;
  tts: TTSSettings;
  stream: StreamSettings;
  visual: VisualSettings;
}
