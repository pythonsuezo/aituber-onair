import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StreamSettings } from './StreamSettings';
import { useGeminiNanoStatus } from '../hooks/useGeminiNanoStatus';
import {
  type ChatProviderOption,
  type TTSEngineOption,
  type VrmTuneEmotionId,
  VRM_TUNE_EMOTION_IDS,
} from '../types/settings';
import type { useSettings } from '../hooks/useSettings';
import {
  clampChangeThreshold,
  clampCaptureMaxHeight,
  clampCaptureMaxWidth,
  clampJpegQuality,
  clampPreviewMaxHeightPx,
  clampVisionIntervalSec,
  loadVisionSettings,
  saveVisionSettings,
  type VisionSettingsV1,
} from '../visionSettings';
import {
  buildAppBackupFileV1,
  downloadAppBackupJson,
  restoreAppBackupFromJson,
  restoreAppBackupFromObject,
} from '../utils/appBackup';
import {
  deleteRestorePoint,
  listRestorePoints,
  saveRestorePoint,
  type RestorePointRecord,
} from '../utils/restorePointsStorage';
import { clearStoredVrm, saveVrmBuffer } from '../utils/vrmBlobStorage';
import { publishVrmControl, publishVrmEmotionPreview } from '../windowMode';
import {
  VOICEPEAK_EMOTION_BY_NARRATOR,
  VOICEPEAK_NARRATOR_EMOTION_PARAM_HINT_DEFAULT,
  VOICEPEAK_NARRATOR_EMOTION_PARAM_HINTS,
  VOICEPEAK_NARRATOR_TAG_REFERENCE,
} from '../constants/voicepeakNarratorEmotions';

type SettingsHook = ReturnType<typeof useSettings>;

interface SettingsPanelProps extends SettingsHook {
  isProcessing: boolean;
  backgroundImageUrl: string | null;
  streamErrorMessage?: string;
  onBackgroundImageChange: (file: File | null) => void;
}

const PROVIDERS: { value: ChatProviderOption; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI-Compatible' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'gemini-nano', label: 'Gemini Nano' },
  { value: 'claude', label: 'Claude' },
  { value: 'xai', label: 'xAI' },
  { value: 'zai', label: 'Z.ai' },
  { value: 'kimi', label: 'Kimi' },
];

const TTS_ENGINES: { value: TTSEngineOption; label: string }[] = [
  { value: 'openai', label: 'OpenAI TTS' },
  { value: 'geminiTts', label: 'Gemini TTS' },
  { value: 'openaiCompatible', label: 'OpenAI-Compatible TTS' },
  { value: 'voicevox', label: 'VOICEVOX' },
  { value: 'voicepeak', label: 'VOICEPEAK' },
  { value: 'aivisSpeech', label: 'AivisSpeech' },
  { value: 'aivisCloud', label: 'Aivis Cloud' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'xai', label: 'xAI TTS' },
  { value: 'unrealSpeech', label: 'Unreal Speech' },
  { value: 'elevenLabs', label: 'ElevenLabs' },
  { value: 'piperPlus', label: 'Piper Plus' },
  { value: 'none', label: 'None' },
];

const OPENAI_SPEAKERS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const GEMINI_TTS_MODELS = [
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
] as const;
const GEMINI_TTS_SPEAKERS = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
] as const;
const XAI_SPEAKERS = ['ara', 'eve', 'leo', 'rex', 'sal'];
const XAI_CODECS = ['mp3', 'wav', 'pcm', 'mulaw', 'alaw'] as const;
const XAI_SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000] as const;
const XAI_BIT_RATES = [32000, 64000, 96000, 128000, 192000] as const;
const UNREAL_SPEECH_SPEAKERS = [
  'af_bella',
  'af_sarah',
  'am_adam',
  'am_michael',
] as const;
const UNREAL_SPEECH_CODECS = ['libmp3lame', 'pcm_mulaw', 'pcm_s16le'] as const;
const ELEVENLABS_MODELS = [
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
] as const;
const ELEVENLABS_OUTPUT_FORMATS = [
  'mp3_44100_128',
  'mp3_22050_32',
  'pcm_16000',
  'ulaw_8000',
] as const;

const VRM_EMOTION_TUNING_LABELS: Record<VrmTuneEmotionId, string> = {
  neutral: 'ニュートラル [neutral]',
  happy: '喜び [happy]',
  angry: '怒り [angry]',
  sad: '悲しみ [sad]',
  relaxed: 'リラックス [relaxed]',
  surprised: '驚き [surprised]',
};

const VRM_EMOTION_FACE_HINTS: Record<VrmTuneEmotionId, string> = {
  neutral:
    '喜び・怒りなどの感情モーフを抑えたベースの顔（VRM のプリセット「neutral」相当）',
  happy: '笑顔・口角・目元が明るくなる系のモーフ',
  angry: '眉寄り・口元が強くなる怒り系モーフ',
  sad: '眉の外側が下がりやすい、しおれた印象のモーフ',
  relaxed: '口角が緩み、落ち着いた印象のモーフ',
  surprised: '眉上がり・目開き・口が開きやすいびっくり系モーフ',
};

function dispatchVrmEmotionPreview(
  emotion: VrmTuneEmotionId | null,
  durationMs = 15_000,
) {
  publishVrmEmotionPreview(
    emotion === null ? { emotion: null } : { emotion, durationMs },
  );
}

/** VOICEPEAK のナレーター ID（`voicepeak --list-narrator` と一致させる） */
const VOICEPEAK_SPEAKERS = [
  { id: 'Kasane Teto', name: '重音テト' },
  { id: 'Frimomen', name: 'フリモメン' },
  { id: 'Jashinchan', name: '邪神ちゃん' },
];

/** VOICEPEAK 設定: 会話の感情タグ（小文字）ごとの `emotion` パラメータ */
const VOICEPEAK_EMOTION_TAG_ROWS: { tag: string; label: string }[] = [
  { tag: 'neutral', label: '[neutral]' },
  { tag: 'happy', label: '[happy]' },
  { tag: 'joy', label: '[joy]' },
  { tag: 'sad', label: '[sad]' },
  { tag: 'angry', label: '[angry]' },
  { tag: 'surprised', label: '[surprised]' },
  { tag: 'relaxed', label: '[relaxed]' },
];

const AIVIS_CLOUD_PRESETS = [
  {
    id: 'kohaku',
    label: 'コハク',
    modelUuid: '22e8ed77-94fe-4ef2-871f-a86f94e9a579',
    speakerUuid: '',
    styleId: '',
  },
  {
    id: 'mao',
    label: 'まお',
    modelUuid: 'a59cb814-0083-4369-8542-f51a29e72af7',
    speakerUuid: '',
    styleId: '',
  },
] as const;

interface VoiceSpeaker {
  name: string;
  speaker_uuid: string;
  styles: { name: string; id: number }[];
}

interface MinimaxVoice {
  voice_id: string;
  voice_name: string;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
}

type SectionKey = 'vision' | 'llm' | 'tts' | 'visual' | 'stream';

export function SettingsPanel({
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
  updateVrmLegacyExpression,
  updateVrmEmotionTune,
  getApiKeyForProvider,
  isProcessing,
  backgroundImageUrl,
  streamErrorMessage,
  onBackgroundImageChange,
}: SettingsPanelProps) {
  const disabled = isProcessing;
  const [systemPromptPresetName, setSystemPromptPresetName] = useState('');
  const [voicepeakCustomTagDraft, setVoicepeakCustomTagDraft] = useState({
    tag: '',
    param: '',
  });
  const openRouterApiKey = getApiKeyForProvider('openrouter').trim();
  const openRouterDynamicFreeModels =
    settings.llm.openRouterDynamicFreeModels?.models || [];
  const openRouterFetchedAt =
    settings.llm.openRouterDynamicFreeModels?.fetchedAt || 0;
  const openRouterMaxCandidates =
    settings.llm.openRouterDynamicFreeModels?.maxCandidates || 1;
  const geminiNano = useGeminiNanoStatus(
    settings.llm.provider === 'gemini-nano',
  );

  const [voicevoxSpeakers, setVoicevoxSpeakers] = useState<VoiceSpeaker[]>([]);
  const [aivisSpeakers, setAivisSpeakers] = useState<VoiceSpeaker[]>([]);
  const [minimaxVoices, setMinimaxVoices] = useState<MinimaxVoice[]>([]);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>(
    [],
  );
  const [fetchError, setFetchError] = useState('');
  const [isFetchingMinimaxVoices, setIsFetchingMinimaxVoices] = useState(false);
  const [isFetchingElevenLabsVoices, setIsFetchingElevenLabsVoices] =
    useState(false);
  const speakerRef = useRef(settings.tts.speaker);
  const voicepeakExtraTagEntries = useMemo(() => {
    if (settings.tts.engine !== 'voicepeak') return [];
    const preset = new Set(VOICEPEAK_EMOTION_TAG_ROWS.map((r) => r.tag));
    const m =
      settings.tts.voicepeakEmotionTagMapByNarrator?.[settings.tts.speaker] ??
      {};
    return Object.entries(m).filter(([k]) => !preset.has(k));
  }, [
    settings.tts.engine,
    settings.tts.speaker,
    settings.tts.voicepeakEmotionTagMapByNarrator,
  ]);

  const voicepeakStyleFallbackLine = useMemo(() => {
    if (settings.tts.engine !== 'voicepeak') return null;
    const row = VOICEPEAK_EMOTION_BY_NARRATOR[
      settings.tts.speaker as keyof typeof VOICEPEAK_EMOTION_BY_NARRATOR
    ] as Record<string, string> | undefined;
    if (!row) return null;
    const text = Object.entries(row)
      .map(([k, v]) => `${k}→${v}`)
      .join(' · ');
    return (
      <p className="settings-field-hint">
        タグ欄が空のときのフォールバック（会話スタイル→emotion）: {text}
      </p>
    );
  }, [settings.tts.engine, settings.tts.speaker]);

  const voicepeakTagReference = useMemo(() => {
    return VOICEPEAK_NARRATOR_TAG_REFERENCE[settings.tts.speaker];
  }, [settings.tts.speaker]);
  const backupRestoreInputRef = useRef<HTMLInputElement | null>(null);
  const [backupRestoreHint, setBackupRestoreHint] = useState<string | null>(
    null,
  );
  const [backupRestoreError, setBackupRestoreError] = useState<string | null>(
    null,
  );
  const [restorePointLabel, setRestorePointLabel] = useState('作業前');
  const [restorePointsList, setRestorePointsList] = useState<
    RestorePointRecord[]
  >([]);
  const [expandedSections, setExpandedSections] = useState<
    Record<SectionKey, boolean>
  >({
    vision: true,
    llm: true,
    tts: true,
    visual: true,
    stream: true,
  });

  const [visionSettings, setVisionSettings] = useState<VisionSettingsV1>(() =>
    loadVisionSettings(),
  );

  const updateVisionSettings = (next: VisionSettingsV1) => {
    setVisionSettings(next);
    saveVisionSettings(next);
  };

  useEffect(() => {
    speakerRef.current = settings.tts.speaker;
  }, [settings.tts.speaker]);

  const refreshRestorePointsList = useCallback(async () => {
    try {
      setRestorePointsList(await listRestorePoints());
    } catch {
      setRestorePointsList([]);
    }
  }, []);

  useEffect(() => {
    if (!expandedSections.visual) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const rows = await listRestorePoints();
      if (!cancelled) {
        setRestorePointsList(rows);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedSections.visual]);

  const selectedAivisCloudPresetId = useMemo(() => {
    const matched = AIVIS_CLOUD_PRESETS.find(
      (preset) =>
        preset.modelUuid === (settings.tts.aivisCloudModelUuid || '') &&
        preset.speakerUuid === (settings.tts.aivisCloudSpeakerUuid || '') &&
        preset.styleId === (settings.tts.aivisCloudStyleId || ''),
    );
    return matched?.id || AIVIS_CLOUD_PRESETS[0].id;
  }, [
    settings.tts.aivisCloudModelUuid,
    settings.tts.aivisCloudSpeakerUuid,
    settings.tts.aivisCloudStyleId,
  ]);

  // Fetch speaker list for VOICEVOX / AivisSpeech
  useEffect(() => {
    if (
      settings.tts.engine !== 'voicevox' &&
      settings.tts.engine !== 'aivisSpeech'
    ) {
      return;
    }

    const controller = new AbortController();

    const fetchSpeakers = async () => {
      const isVoicevox = settings.tts.engine === 'voicevox';
      const baseUrl = isVoicevox
        ? settings.tts.voicevoxApiUrl || 'http://localhost:50021'
        : settings.tts.aivisSpeechApiUrl || 'http://localhost:10101';

      try {
        const response = await fetch(`${baseUrl}/speakers`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const speakers = (await response.json()) as VoiceSpeaker[];
        if (controller.signal.aborted) return;

        if (isVoicevox) {
          setVoicevoxSpeakers(speakers);
        } else {
          setAivisSpeakers(speakers);
        }
        setFetchError('');

        if (!speakerRef.current && speakers.length > 0) {
          const firstId = speakers[0]?.styles?.[0]?.id;
          if (firstId != null) updateTTSSpeaker(String(firstId));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (isVoicevox) {
          setVoicevoxSpeakers([]);
          setFetchError(`VOICEVOX接続エラー: ${message}`);
        } else {
          setAivisSpeakers([]);
          setFetchError(`AivisSpeech接続エラー: ${message}`);
        }
      }
    };

    void fetchSpeakers();

    return () => {
      controller.abort();
    };
  }, [
    settings.tts.engine,
    settings.tts.voicevoxApiUrl,
    settings.tts.aivisSpeechApiUrl,
    updateTTSSpeaker,
  ]);

  // Fetch MiniMax speaker list after API key is entered
  useEffect(() => {
    if (settings.tts.engine !== 'minimax') {
      return;
    }

    const apiKey = settings.tts.minimaxApiKey?.trim();
    if (!apiKey) {
      setMinimaxVoices([]);
      return;
    }

    const controller = new AbortController();

    const fetchMinimaxVoices = async () => {
      setIsFetchingMinimaxVoices(true);
      try {
        const response = await fetch(
          'https://api.minimax.io/v1/query/tts_speakers',
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          base_resp?: { status_code?: number; status_msg?: string };
          data?: { speakers?: MinimaxVoice[] };
        };
        if (controller.signal.aborted) return;

        if (payload.base_resp && payload.base_resp.status_code !== 0) {
          throw new Error(payload.base_resp.status_msg || 'MiniMax API error');
        }

        const voices = payload.data?.speakers || [];
        setMinimaxVoices(voices);
        setFetchError('');

        if (
          voices.length > 0 &&
          !voices.some((voice) => voice.voice_id === speakerRef.current)
        ) {
          updateTTSSpeaker(voices[0].voice_id);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setMinimaxVoices([]);
        setFetchError(`MiniMax接続エラー: ${message}`);
      } finally {
        if (!controller.signal.aborted) {
          setIsFetchingMinimaxVoices(false);
        }
      }
    };

    void fetchMinimaxVoices();

    return () => {
      controller.abort();
    };
  }, [settings.tts.engine, settings.tts.minimaxApiKey, updateTTSSpeaker]);

  // Fetch ElevenLabs voice list after API key is entered
  useEffect(() => {
    if (settings.tts.engine !== 'elevenLabs') {
      return;
    }

    const apiKey = settings.tts.elevenLabsApiKey?.trim();
    if (!apiKey) {
      queueMicrotask(() => {
        setElevenLabsVoices([]);
      });
      return;
    }

    const controller = new AbortController();

    const fetchElevenLabsVoices = async () => {
      setIsFetchingElevenLabsVoices(true);
      try {
        const response = await fetch(
          'https://api.elevenlabs.io/v2/voices?page_size=100',
          {
            method: 'GET',
            headers: {
              'xi-api-key': apiKey,
            },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          voices?: ElevenLabsVoice[];
        };
        if (controller.signal.aborted) return;

        const voices = payload.voices || [];
        setElevenLabsVoices(voices);
        setFetchError('');

        if (
          voices.length > 0 &&
          !voices.some((voice) => voice.voice_id === speakerRef.current)
        ) {
          updateTTSSpeaker(voices[0].voice_id);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setElevenLabsVoices([]);
        setFetchError(`ElevenLabs接続エラー: ${message}`);
      } finally {
        if (!controller.signal.aborted) {
          setIsFetchingElevenLabsVoices(false);
        }
      }
    };

    void fetchElevenLabsVoices();

    return () => {
      controller.abort();
    };
  }, [settings.tts.engine, settings.tts.elevenLabsApiKey, updateTTSSpeaker]);

  const handleAivisCloudPresetChange = (presetId: string) => {
    const preset = AIVIS_CLOUD_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    updateAivisCloudModelUuid(preset.modelUuid);
    updateAivisCloudSpeakerUuid(preset.speakerUuid);
    updateAivisCloudStyleId(preset.styleId);
    updateTTSSpeaker(preset.modelUuid);
  };

  const toggleSection = (section: SectionKey) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <div className="settings-panel">
      {/* Vision Section */}
      <div className="settings-section">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSection('vision')}
          aria-expanded={expandedSections.vision}
        >
          <h3>Vision</h3>
          <span
            className={`settings-section-chevron${
              expandedSections.vision ? ' is-open' : ''
            }`}
          >
            ⌄
          </span>
        </button>

        {expandedSections.vision && (
          <>
            <div className="settings-field">
              <label>
                <input
                  type="checkbox"
                  checked={visionSettings.enabled}
                  onChange={(e) =>
                    updateVisionSettings({
                      ...visionSettings,
                      enabled: e.target.checked,
                    })
                  }
                  disabled={disabled}
                />
                定期的にビジョンを送る
              </label>
            </div>

            <div className="settings-field">
              <label htmlFor="vision-interval">
                送信間隔（秒）: {clampVisionIntervalSec(visionSettings.intervalSec)}
              </label>
              <input
                id="vision-interval"
                type="range"
                min={5}
                max={180}
                value={clampVisionIntervalSec(visionSettings.intervalSec)}
                onChange={(e) =>
                  updateVisionSettings({
                    ...visionSettings,
                    intervalSec: clampVisionIntervalSec(Number(e.target.value)),
                  })
                }
                disabled={disabled}
              />
            </div>

            <div className="settings-field">
              <label>
                <input
                  type="checkbox"
                  checked={visionSettings.skipIfUnchanged}
                  onChange={(e) =>
                    updateVisionSettings({
                      ...visionSettings,
                      skipIfUnchanged: e.target.checked,
                    })
                  }
                  disabled={disabled}
                />
                映像が変わらなければ送らない
              </label>
            </div>

            <div className="settings-field">
              <label htmlFor="vision-change-threshold">
                変化しきい値（簡易）: {clampChangeThreshold(visionSettings.changeThreshold).toFixed(3)}
              </label>
              <input
                id="vision-change-threshold"
                type="range"
                min={0}
                max={0.2}
                step={0.005}
                value={clampChangeThreshold(visionSettings.changeThreshold)}
                onChange={(e) =>
                  updateVisionSettings({
                    ...visionSettings,
                    changeThreshold: clampChangeThreshold(Number(e.target.value)),
                  })
                }
                disabled={disabled}
              />
            </div>

            <div className="settings-field">
              <label htmlFor="vision-capture-w">
                AIへ送る画像の最大幅: {clampCaptureMaxWidth(visionSettings.captureMaxWidth)} px
              </label>
              <input
                id="vision-capture-w"
                type="range"
                min={320}
                max={1920}
                step={16}
                value={clampCaptureMaxWidth(visionSettings.captureMaxWidth)}
                onChange={(e) =>
                  updateVisionSettings({
                    ...visionSettings,
                    captureMaxWidth: clampCaptureMaxWidth(Number(e.target.value)),
                  })
                }
                disabled={disabled}
              />
            </div>

            <div className="settings-field">
              <label htmlFor="vision-capture-h">
                AIへ送る画像の最大高さ: {clampCaptureMaxHeight(visionSettings.captureMaxHeight)} px
              </label>
              <input
                id="vision-capture-h"
                type="range"
                min={180}
                max={1080}
                step={16}
                value={clampCaptureMaxHeight(visionSettings.captureMaxHeight)}
                onChange={(e) =>
                  updateVisionSettings({
                    ...visionSettings,
                    captureMaxHeight: clampCaptureMaxHeight(Number(e.target.value)),
                  })
                }
                disabled={disabled}
              />
            </div>

            <div className="settings-field">
              <label htmlFor="vision-jpeg-q">
                JPEG品質: {clampJpegQuality(visionSettings.jpegQuality).toFixed(2)}
              </label>
              <input
                id="vision-jpeg-q"
                type="range"
                min={0.35}
                max={0.95}
                step={0.01}
                value={clampJpegQuality(visionSettings.jpegQuality)}
                onChange={(e) =>
                  updateVisionSettings({
                    ...visionSettings,
                    jpegQuality: clampJpegQuality(Number(e.target.value)),
                  })
                }
                disabled={disabled}
              />
            </div>

            <div className="settings-field">
              <label htmlFor="vision-preview-h">
                プレビュー枠の高さ: {clampPreviewMaxHeightPx(visionSettings.previewMaxHeightPx)} px
              </label>
              <input
                id="vision-preview-h"
                type="range"
                min={120}
                max={520}
                step={10}
                value={clampPreviewMaxHeightPx(visionSettings.previewMaxHeightPx)}
                onChange={(e) =>
                  updateVisionSettings({
                    ...visionSettings,
                    previewMaxHeightPx: clampPreviewMaxHeightPx(Number(e.target.value)),
                  })
                }
                disabled={disabled}
              />
            </div>

            <div className="settings-field">
              <label>
                <input
                  type="checkbox"
                  checked={visionSettings.sendWithUserMessage}
                  onChange={(e) =>
                    updateVisionSettings({
                      ...visionSettings,
                      sendWithUserMessage: e.target.checked,
                    })
                  }
                  disabled={disabled}
                />
                自分の発言と同時にビジョンも送る（ビジョン窓が必要）
              </label>
            </div>

            <div className="settings-field">
              <label htmlFor="vision-prompt">ビジョン指示文（任意）</label>
              <textarea
                id="vision-prompt"
                value={visionSettings.prompt}
                onChange={(e) =>
                  updateVisionSettings({
                    ...visionSettings,
                    prompt: e.target.value,
                  })
                }
                disabled={disabled}
                rows={3}
                placeholder="例: 画面の状況を短く実況して。重要な変化があれば指摘して。"
              />
            </div>
          </>
        )}
      </div>

      {/* LLM Section */}
      <div className="settings-section">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSection('llm')}
          aria-expanded={expandedSections.llm}
        >
          <h3>LLM</h3>
          <span
            className={`settings-section-chevron${expandedSections.llm ? ' is-open' : ''}`}
          >
            ⌄
          </span>
        </button>

        {expandedSections.llm && (
          <>
            <div className="settings-field">
              <label htmlFor="llm-provider">Provider</label>
              <select
                id="llm-provider"
                value={settings.llm.provider}
                onChange={(e) =>
                  updateLLMProvider(e.target.value as ChatProviderOption)
                }
                disabled={disabled}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {settings.llm.provider === 'openai-compatible' ? (
              <div className="settings-field">
                <label htmlFor="llm-model">Model</label>
                <input
                  id="llm-model"
                  type="text"
                  value={settings.llm.model}
                  onChange={(e) => updateLLMModel(e.target.value)}
                  placeholder="local-model"
                  disabled={disabled}
                />
              </div>
            ) : (
              <div className="settings-field">
                <label htmlFor="llm-model">Model</label>
                <select
                  id="llm-model"
                  value={settings.llm.model}
                  onChange={(e) => updateLLMModel(e.target.value)}
                  disabled={disabled}
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {settings.llm.provider === 'openrouter' && (
              <div className="settings-field">
                <label htmlFor="llm-apikey">
                  API Key ({settings.llm.provider})
                </label>
                <input
                  id="llm-apikey"
                  type="password"
                  value={getApiKeyForProvider(settings.llm.provider)}
                  onChange={(e) =>
                    updateLLMApiKey(settings.llm.provider, e.target.value)
                  }
                  placeholder="XXX-..."
                  disabled={disabled}
                />
              </div>
            )}

            {settings.llm.provider === 'openrouter' && (
              <>
                <div className="settings-field">
                  <label htmlFor="openrouter-max-candidates">
                    Max candidates
                  </label>
                  <input
                    id="openrouter-max-candidates"
                    type="number"
                    min={1}
                    value={openRouterMaxCandidates}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      updateOpenRouterMaxCandidates(
                        Number.isFinite(parsed) ? parsed : 1,
                      );
                    }}
                    disabled={disabled || isRefreshingOpenRouterFreeModels}
                  />
                </div>
                <div className="settings-field">
                  <button
                    type="button"
                    className="settings-action-button"
                    onClick={() => {
                      void refreshOpenRouterDynamicFreeModels();
                    }}
                    disabled={
                      disabled ||
                      isRefreshingOpenRouterFreeModels ||
                      !openRouterApiKey
                    }
                  >
                    {isRefreshingOpenRouterFreeModels
                      ? 'Fetching...'
                      : 'Fetch free models'}
                  </button>
                  {!openRouterApiKey && (
                    <p className="settings-field-hint">
                      Set OpenRouter API key to fetch free models.
                    </p>
                  )}
                  {openRouterRefreshError && (
                    <p className="settings-field-error">
                      {openRouterRefreshError}
                    </p>
                  )}
                  <p className="settings-field-hint">
                    Dynamic free models: {openRouterDynamicFreeModels.length}
                  </p>
                  {openRouterFetchedAt > 0 && (
                    <p className="settings-field-hint">
                      Last fetched:{' '}
                      {new Date(openRouterFetchedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </>
            )}

            {settings.llm.provider === 'openai-compatible' && (
              <div className="settings-field">
                <label htmlFor="llm-endpoint">Endpoint URL</label>
                <input
                  id="llm-endpoint"
                  type="text"
                  value={settings.llm.endpoint || ''}
                  onChange={(e) => updateLLMEndpoint(e.target.value)}
                  placeholder="http://localhost:11434/v1/chat/completions"
                  disabled={disabled}
                />
              </div>
            )}

            {settings.llm.provider === 'gemini-nano' && (
              <>
                <div className="settings-field">
                  <small>
                    Gemini Nano はブラウザ内蔵 AI を使うため API Key
                    は不要です。
                  </small>
                </div>
                <div className="settings-field">
                  <small>{geminiNano.statusText}</small>
                  {geminiNano.downloadProgress != null && (
                    <small>{geminiNano.downloadProgress}%</small>
                  )}
                  {geminiNano.status === 'downloadable' && (
                    <button
                      type="button"
                      className="settings-action-button"
                      onClick={() => geminiNano.prepareModel()}
                      disabled={disabled || geminiNano.isPreparing}
                    >
                      {geminiNano.isPreparing
                        ? 'Preparing...'
                        : 'Prepare Model'}
                    </button>
                  )}
                  <small>
                    Chrome 138+ が必要です。`chrome://flags` を開き、
                    `#optimization-guide-on-device-model` と
                    `#prompt-api-for-gemini-nano` を `Enabled` に設定してから
                    Chrome を再起動してください。
                  </small>
                  <small>
                    フラグ有効化後に上の `Prepare Model` を押すとモデルの
                    ダウンロードが始まります。初回ダウンロードには数分かかる
                    場合があります。
                  </small>
                </div>
              </>
            )}

            {settings.llm.provider !== 'openrouter' &&
              settings.llm.provider !== 'gemini-nano' && (
                <div className="settings-field">
                  <label htmlFor="llm-apikey">
                    API Key ({settings.llm.provider})
                    {settings.llm.provider === 'openai-compatible'
                      ? ' (任意)'
                      : ''}
                  </label>
                  <input
                    id="llm-apikey"
                    type="password"
                    value={getApiKeyForProvider(settings.llm.provider)}
                    onChange={(e) =>
                      updateLLMApiKey(settings.llm.provider, e.target.value)
                    }
                    placeholder={
                      settings.llm.provider === 'openai-compatible'
                        ? '必要な場合のみ入力'
                        : 'XXX-...'
                    }
                    disabled={disabled}
                  />
                </div>
              )}

            <div className="settings-field">
              <label htmlFor="llm-system-prompt">
                追加システムプロンプト（任意）
              </label>
              <textarea
                id="llm-system-prompt"
                rows={5}
                value={settings.llm.systemPrompt}
                onChange={(e) => updateSystemPrompt(e.target.value)}
                disabled={disabled}
                placeholder="VRM の表情ルールはアプリが常に先頭に付けます。ここには役割・口調・禁止事項など追記したい分だけ書けます。"
              />
              <p className="settings-field-hint">
                固定の VRM 表情ルールはコード側の既定が常に先頭に付き、その下にここで書いた内容が続きます。変更後は次のメッセージから適用されます（会話履歴はそのまま）。
              </p>
              <div className="settings-system-preset-save">
                <input
                  type="text"
                  value={systemPromptPresetName}
                  onChange={(e) => setSystemPromptPresetName(e.target.value)}
                  placeholder="プリセット名（未入力なら自動）"
                  disabled={disabled}
                  aria-label="プリセット名"
                />
                <button
                  type="button"
                  className="settings-action-button"
                  disabled={disabled}
                  onClick={() => {
                    addSystemPromptPreset(systemPromptPresetName);
                    setSystemPromptPresetName('');
                  }}
                >
                  現在の内容をプリセットに保存
                </button>
              </div>
              {settings.llm.systemPromptPresets.length > 0 && (
                <ul
                  className="settings-system-preset-list"
                  aria-label="保存したプリセット"
                >
                  {settings.llm.systemPromptPresets.map((p) => (
                    <li key={p.id}>
                      <span className="settings-system-preset-name">{p.name}</span>
                      <button
                        type="button"
                        className="settings-clear-button"
                        disabled={disabled}
                        onClick={() => applySystemPromptPreset(p.id)}
                      >
                        読み込み
                      </button>
                      <button
                        type="button"
                        className="settings-clear-button"
                        disabled={disabled}
                        onClick={() => removeSystemPromptPreset(p.id)}
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {/* TTS Section */}
      <div className="settings-section">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSection('tts')}
          aria-expanded={expandedSections.tts}
        >
          <h3>TTS</h3>
          <span
            className={`settings-section-chevron${expandedSections.tts ? ' is-open' : ''}`}
          >
            ⌄
          </span>
        </button>

        {expandedSections.tts && (
          <>
            <div className="settings-field">
              <label htmlFor="tts-engine">Engine</label>
              <select
                id="tts-engine"
                value={settings.tts.engine}
                onChange={(e) =>
                  updateTTSEngine(e.target.value as TTSEngineOption)
                }
                disabled={disabled}
              >
                {TTS_ENGINES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {settings.tts.engine === 'openai' && (
              <div className="settings-field">
                <label htmlFor="tts-speaker">Speaker</label>
                <select
                  id="tts-speaker"
                  value={settings.tts.speaker}
                  onChange={(e) => updateTTSSpeaker(e.target.value)}
                  disabled={disabled}
                >
                  {OPENAI_SPEAKERS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {settings.tts.engine === 'geminiTts' && (
              <>
                {settings.llm.provider !== 'gemini' && (
                  <div className="settings-field">
                    <label htmlFor="tts-gemini-apikey">API Key (Gemini)</label>
                    <input
                      id="tts-gemini-apikey"
                      type="password"
                      value={getApiKeyForProvider('gemini')}
                      onChange={(e) =>
                        updateLLMApiKey('gemini', e.target.value)
                      }
                      placeholder="Google API key"
                      disabled={disabled}
                    />
                  </div>
                )}
                <div className="settings-field">
                  <label htmlFor="tts-gemini-speaker">Voice</label>
                  <select
                    id="tts-gemini-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {GEMINI_TTS_SPEAKERS.map((speaker) => (
                      <option key={speaker} value={speaker}>
                        {speaker}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gemini-model">Model</label>
                  <select
                    id="tts-gemini-model"
                    value={settings.tts.geminiTtsModel || GEMINI_TTS_MODELS[0]}
                    onChange={(e) => updateGeminiTtsModel(e.target.value)}
                    disabled={disabled}
                  >
                    {GEMINI_TTS_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gemini-language">Language Code</label>
                  <input
                    id="tts-gemini-language"
                    type="text"
                    value={settings.tts.geminiTtsLanguageCode || ''}
                    onChange={(e) =>
                      updateGeminiTtsLanguageCode(e.target.value)
                    }
                    placeholder="ja-JP"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gemini-prompt">
                    Style / Audio-tag Prompt
                  </label>
                  <input
                    id="tts-gemini-prompt"
                    type="text"
                    value={settings.tts.geminiTtsPrompt || ''}
                    onChange={(e) => updateGeminiTtsPrompt(e.target.value)}
                    placeholder="明るく元気な声で話してください"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'xai' && (
              <>
                {settings.llm.provider !== 'xai' && (
                  <div className="settings-field">
                    <label htmlFor="tts-xai-apikey">API Key (xAI)</label>
                    <input
                      id="tts-xai-apikey"
                      type="password"
                      value={getApiKeyForProvider('xai')}
                      onChange={(e) => updateLLMApiKey('xai', e.target.value)}
                      placeholder="xai-..."
                      disabled={disabled}
                    />
                  </div>
                )}
                <div className="settings-field">
                  <label htmlFor="tts-xai-speaker">Speaker</label>
                  <select
                    id="tts-xai-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {XAI_SPEAKERS.map((speaker) => (
                      <option key={speaker} value={speaker}>
                        {speaker}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-xai-language">Language</label>
                  <input
                    id="tts-xai-language"
                    type="text"
                    value={settings.tts.xaiLanguage || ''}
                    onChange={(e) => updateXaiLanguage(e.target.value)}
                    placeholder="auto"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-xai-codec">Codec</label>
                  <select
                    id="tts-xai-codec"
                    value={settings.tts.xaiCodec || 'mp3'}
                    onChange={(e) => updateXaiCodec(e.target.value)}
                    disabled={disabled}
                  >
                    {XAI_CODECS.map((codec) => (
                      <option key={codec} value={codec}>
                        {codec}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-xai-sample-rate">Sample Rate</label>
                  <select
                    id="tts-xai-sample-rate"
                    value={String(settings.tts.xaiSampleRate || 24000)}
                    onChange={(e) =>
                      updateXaiSampleRate(Number.parseInt(e.target.value, 10))
                    }
                    disabled={disabled}
                  >
                    {XAI_SAMPLE_RATES.map((sampleRate) => (
                      <option key={sampleRate} value={sampleRate}>
                        {sampleRate}
                      </option>
                    ))}
                  </select>
                </div>
                {(settings.tts.xaiCodec || 'mp3') === 'mp3' && (
                  <div className="settings-field">
                    <label htmlFor="tts-xai-bit-rate">Bit Rate</label>
                    <select
                      id="tts-xai-bit-rate"
                      value={String(settings.tts.xaiBitRate || 128000)}
                      onChange={(e) =>
                        updateXaiBitRate(Number.parseInt(e.target.value, 10))
                      }
                      disabled={disabled}
                    >
                      {XAI_BIT_RATES.map((bitRate) => (
                        <option key={bitRate} value={bitRate}>
                          {bitRate}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {settings.tts.engine === 'unrealSpeech' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-apikey">API Key</label>
                  <input
                    id="tts-unreal-apikey"
                    type="password"
                    value={settings.tts.unrealSpeechApiKey || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechApiKey', e.target.value)
                    }
                    placeholder="Unreal Speech API key"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-speaker">Speaker</label>
                  <select
                    id="tts-unreal-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {UNREAL_SPEECH_SPEAKERS.map((speaker) => (
                      <option key={speaker} value={speaker}>
                        {speaker}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-url">API URL</label>
                  <input
                    id="tts-unreal-url"
                    type="text"
                    value={settings.tts.unrealSpeechApiUrl || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechApiUrl', e.target.value)
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-codec">Codec</label>
                  <select
                    id="tts-unreal-codec"
                    value={settings.tts.unrealSpeechCodec || 'libmp3lame'}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechCodec', e.target.value)
                    }
                    disabled={disabled}
                  >
                    {UNREAL_SPEECH_CODECS.map((codec) => (
                      <option key={codec} value={codec}>
                        {codec}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-bitrate">Bitrate</label>
                  <input
                    id="tts-unreal-bitrate"
                    type="text"
                    value={settings.tts.unrealSpeechBitrate || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechBitrate', e.target.value)
                    }
                    placeholder="192k"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-speed">Speed</label>
                  <input
                    id="tts-unreal-speed"
                    type="number"
                    step="0.05"
                    value={settings.tts.unrealSpeechSpeed || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechSpeed', e.target.value)
                    }
                    placeholder="default"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-pitch">Pitch</label>
                  <input
                    id="tts-unreal-pitch"
                    type="number"
                    step="0.05"
                    value={settings.tts.unrealSpeechPitch || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechPitch', e.target.value)
                    }
                    placeholder="default"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-temperature">Temperature</label>
                  <input
                    id="tts-unreal-temperature"
                    type="number"
                    step="0.05"
                    value={settings.tts.unrealSpeechTemperature || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechTemperature', e.target.value)
                    }
                    placeholder="default"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'elevenLabs' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-apikey">API Key</label>
                  <input
                    id="tts-eleven-apikey"
                    type="password"
                    value={settings.tts.elevenLabsApiKey || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsApiKey', e.target.value)
                    }
                    placeholder="ElevenLabs API key"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-speaker">Voice</label>
                  <select
                    id="tts-eleven-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={
                      disabled ||
                      !settings.tts.elevenLabsApiKey ||
                      isFetchingElevenLabsVoices ||
                      elevenLabsVoices.length === 0
                    }
                  >
                    {!settings.tts.elevenLabsApiKey && (
                      <option value="">API Keyを入力してください</option>
                    )}
                    {settings.tts.elevenLabsApiKey &&
                      isFetchingElevenLabsVoices && (
                        <option value="">取得中...</option>
                      )}
                    {settings.tts.elevenLabsApiKey &&
                      !isFetchingElevenLabsVoices &&
                      elevenLabsVoices.length === 0 && (
                        <option value="">音声一覧を取得できませんでした</option>
                      )}
                    {elevenLabsVoices.map((voice) => (
                      <option key={voice.voice_id} value={voice.voice_id}>
                        {voice.category
                          ? `${voice.name} (${voice.category})`
                          : voice.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-url">API URL</label>
                  <input
                    id="tts-eleven-url"
                    type="text"
                    value={settings.tts.elevenLabsApiUrl || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsApiUrl', e.target.value)
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-model">Model</label>
                  <select
                    id="tts-eleven-model"
                    value={settings.tts.elevenLabsModel || ELEVENLABS_MODELS[0]}
                    onChange={(e) =>
                      updateTtsField('elevenLabsModel', e.target.value)
                    }
                    disabled={disabled}
                  >
                    {ELEVENLABS_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-format">Output Format</label>
                  <select
                    id="tts-eleven-format"
                    value={
                      settings.tts.elevenLabsOutputFormat ||
                      ELEVENLABS_OUTPUT_FORMATS[0]
                    }
                    onChange={(e) =>
                      updateTtsField('elevenLabsOutputFormat', e.target.value)
                    }
                    disabled={disabled}
                  >
                    {ELEVENLABS_OUTPUT_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {format}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-language">Language Code</label>
                  <input
                    id="tts-eleven-language"
                    type="text"
                    value={settings.tts.elevenLabsLanguageCode || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsLanguageCode', e.target.value)
                    }
                    placeholder="ja"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-stability">Stability</label>
                  <input
                    id="tts-eleven-stability"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.tts.elevenLabsStability || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsStability', e.target.value)
                    }
                    placeholder="0.5"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-similarity">
                    Similarity Boost
                  </label>
                  <input
                    id="tts-eleven-similarity"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.tts.elevenLabsSimilarityBoost || ''}
                    onChange={(e) =>
                      updateTtsField(
                        'elevenLabsSimilarityBoost',
                        e.target.value,
                      )
                    }
                    placeholder="0.75"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-style">Style</label>
                  <input
                    id="tts-eleven-style"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.tts.elevenLabsStyle || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsStyle', e.target.value)
                    }
                    placeholder="0"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-speed">Speed</label>
                  <input
                    id="tts-eleven-speed"
                    type="number"
                    min="0.7"
                    max="1.2"
                    step="0.01"
                    value={settings.tts.elevenLabsSpeed || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsSpeed', e.target.value)
                    }
                    placeholder="1.0"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-seed">Seed</label>
                  <input
                    id="tts-eleven-seed"
                    type="number"
                    value={settings.tts.elevenLabsSeed || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsSeed', e.target.value)
                    }
                    placeholder="optional"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-speaker-boost">
                    Speaker Boost
                  </label>
                  <select
                    id="tts-eleven-speaker-boost"
                    value={settings.tts.elevenLabsUseSpeakerBoost || 'default'}
                    onChange={(e) =>
                      updateTtsField(
                        'elevenLabsUseSpeakerBoost',
                        e.target.value as 'default' | 'true' | 'false',
                      )
                    }
                    disabled={disabled}
                  >
                    <option value="default">Default</option>
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-normalization">
                    Text Normalization
                  </label>
                  <select
                    id="tts-eleven-normalization"
                    value={
                      settings.tts.elevenLabsApplyTextNormalization || 'default'
                    }
                    onChange={(e) =>
                      updateTtsField(
                        'elevenLabsApplyTextNormalization',
                        e.target.value as 'default' | 'auto' | 'on' | 'off',
                      )
                    }
                    disabled={disabled}
                  >
                    <option value="default">Default</option>
                    <option value="auto">auto</option>
                    <option value="on">on</option>
                    <option value="off">off</option>
                  </select>
                </div>
              </>
            )}

            {settings.tts.engine === 'piperPlus' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-piper-base-path">Assets Base Path</label>
                  <input
                    id="tts-piper-base-path"
                    type="text"
                    value={settings.tts.piperPlusBasePath || ''}
                    onChange={(e) => updatePiperPlusBasePath(e.target.value)}
                    placeholder="/piper/"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-piper-config">Model Config File</label>
                  <input
                    id="tts-piper-config"
                    type="text"
                    value={settings.tts.piperPlusModelConfigFile || ''}
                    onChange={(e) =>
                      updatePiperPlusModelConfigFile(e.target.value)
                    }
                    placeholder="tsukuyomi-config.json"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-piper-model">Model File</label>
                  <input
                    id="tts-piper-model"
                    type="text"
                    value={settings.tts.piperPlusModelFile || ''}
                    onChange={(e) => updatePiperPlusModelFile(e.target.value)}
                    placeholder="tsukuyomi-wavlm-300epoch.onnx"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-piper-voice">HTS Voice File</label>
                  <input
                    id="tts-piper-voice"
                    type="text"
                    value={settings.tts.piperPlusVoiceFile || ''}
                    onChange={(e) => updatePiperPlusVoiceFile(e.target.value)}
                    placeholder="mei_normal.htsvoice"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-piper-speed">Speed</label>
                  <input
                    id="tts-piper-speed"
                    type="number"
                    step="0.05"
                    value={settings.tts.piperPlusSpeed || ''}
                    onChange={(e) => updatePiperPlusSpeed(e.target.value)}
                    placeholder="1.0"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-piper-noise-scale">Noise Scale</label>
                  <input
                    id="tts-piper-noise-scale"
                    type="number"
                    step="0.05"
                    value={settings.tts.piperPlusNoiseScale || ''}
                    onChange={(e) => updatePiperPlusNoiseScale(e.target.value)}
                    placeholder="0.667"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <small>
                    Runtime assets はサイズとサードパーティライセンスの都合で
                    同梱していません。README の Piper Plus Setup を参照し、
                    `public/piper/` 配下に `dist/`, `src/`, `assets/`, `models/`
                    を配置してください。
                  </small>
                </div>
              </>
            )}

            {settings.tts.engine === 'openaiCompatible' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-openai-compatible-apikey">
                    API Key (optional)
                  </label>
                  <input
                    id="tts-openai-compatible-apikey"
                    type="password"
                    value={settings.tts.openAiCompatibleApiKey || ''}
                    onChange={(e) =>
                      updateOpenAiCompatibleApiKey(e.target.value)
                    }
                    placeholder="未入力なら Authorization ヘッダーなし"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-openai-compatible-url">
                    Endpoint URL
                  </label>
                  <input
                    id="tts-openai-compatible-url"
                    type="text"
                    value={settings.tts.openAiCompatibleApiUrl || ''}
                    onChange={(e) =>
                      updateOpenAiCompatibleApiUrl(e.target.value)
                    }
                    placeholder="http://localhost:8880/v1/audio/speech"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-openai-compatible-model">Model</label>
                  <input
                    id="tts-openai-compatible-model"
                    type="text"
                    value={settings.tts.openAiCompatibleModel || ''}
                    onChange={(e) =>
                      updateOpenAiCompatibleModel(e.target.value)
                    }
                    placeholder="local-model"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-openai-compatible-speaker">
                    Voice (optional)
                  </label>
                  <input
                    id="tts-openai-compatible-speaker"
                    type="text"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    placeholder="未入力なら voice フィールドを送信しません"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-openai-compatible-speed">
                    Speed (0.25 - 4.0)
                  </label>
                  <input
                    id="tts-openai-compatible-speed"
                    type="number"
                    min="0.25"
                    max="4"
                    step="0.05"
                    value={settings.tts.openAiCompatibleSpeed || ''}
                    onChange={(e) =>
                      updateOpenAiCompatibleSpeed(e.target.value)
                    }
                    placeholder="1.0"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'voicevox' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-voicevox-speaker">Speaker</label>
                  <select
                    id="tts-voicevox-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {voicevoxSpeakers.length > 0 ? (
                      voicevoxSpeakers.flatMap((sp) =>
                        (sp.styles || []).map((style) => (
                          <option
                            key={`${sp.speaker_uuid}-${style.id}`}
                            value={String(style.id)}
                          >
                            {sp.name} - {style.name}
                          </option>
                        )),
                      )
                    ) : (
                      <option value="">サーバーから取得中...</option>
                    )}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-voicevox-url">API URL</label>
                  <input
                    id="tts-voicevox-url"
                    type="text"
                    value={settings.tts.voicevoxApiUrl || ''}
                    onChange={(e) => updateVoicevoxApiUrl(e.target.value)}
                    placeholder="http://localhost:50021"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'voicepeak' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-voicepeak-speaker">Speaker</label>
                  <select
                    id="tts-voicepeak-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {VOICEPEAK_SPEAKERS.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name}
                      </option>
                    ))}
                  </select>
                  <p className="settings-field-hint">
                    {VOICEPEAK_NARRATOR_EMOTION_PARAM_HINTS[settings.tts.speaker] ??
                      VOICEPEAK_NARRATOR_EMOTION_PARAM_HINT_DEFAULT}
                  </p>
                  {voicepeakStyleFallbackLine}
                  <p className="settings-field-hint">
                    下の「感情タグ→emotion」表は{' '}
                    <strong>今選んでいるスピーカー ID ごと</strong>
                    に保存されます。話者を切り替えると、その話者用の別表を編集します。
                  </p>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-voicepeak-url">API URL</label>
                  <input
                    id="tts-voicepeak-url"
                    type="text"
                    value={settings.tts.voicepeakApiUrl || ''}
                    onChange={(e) => updateVoicepeakApiUrl(e.target.value)}
                    placeholder="http://localhost:20202"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <div style={{ marginBottom: '0.35rem' }}>
                    <strong>感情タグ → VOICEPEAK emotion</strong>
                  </div>
                  <p className="settings-field-hint">
                    各タグの入力が空のときは、下の折りたたみの組み込み既定が読み上げに使われ、入力した行だけが上書きされます。
                    重み付きは <code>happy=40,fun=60</code> のように1行で指定できます。
                  </p>
                  {voicepeakTagReference &&
                    Object.keys(voicepeakTagReference).length > 0 && (
                      <details className="settings-voicepeak-reference">
                        <summary>
                          この話者の組み込み既定（空欄タグへ自動適用・上の入力で上書き）
                        </summary>
                        <table className="settings-voicepeak-reference-table">
                          <thead>
                            <tr>
                              <th>感情タグ</th>
                              <th>emotion 参考</th>
                            </tr>
                          </thead>
                          <tbody>
                            {VOICEPEAK_EMOTION_TAG_ROWS.flatMap(
                              ({ tag, label }) => {
                                const ref = voicepeakTagReference[tag];
                                if (!ref) return [];
                                return [
                                  <tr key={tag}>
                                    <td>{label}</td>
                                    <td>
                                      <code>{ref}</code>
                                    </td>
                                  </tr>,
                                ];
                              },
                            )}
                          </tbody>
                        </table>
                      </details>
                    )}
                  <div className="settings-voicepeak-tag-rows">
                    {VOICEPEAK_EMOTION_TAG_ROWS.map(({ tag, label }) => (
                      <div key={tag} className="settings-voicepeak-tag-row">
                        <label htmlFor={`tts-voicepeak-tag-${tag}`}>
                          {label}
                        </label>
                        <input
                          id={`tts-voicepeak-tag-${tag}`}
                          type="text"
                          spellCheck={false}
                          value={
                            settings.tts.voicepeakEmotionTagMapByNarrator?.[
                              settings.tts.speaker
                            ]?.[tag] ?? ''
                          }
                          onChange={(e) =>
                            updateVoicepeakEmotionTagMapEntry(
                              settings.tts.speaker,
                              tag,
                              e.target.value,
                            )
                          }
                          disabled={disabled}
                          placeholder={
                            voicepeakTagReference?.[tag] ??
                            '例: teto-sweet または happy=40,fun=60'
                          }
                        />
                      </div>
                    ))}
                  </div>
                  {voicepeakExtraTagEntries.length > 0 && (
                    <div
                      className="settings-voicepeak-tag-rows"
                      style={{ marginTop: '0.75rem' }}
                    >
                      <div style={{ marginBottom: '0.35rem' }}>
                        <strong>その他のタグ</strong>
                      </div>
                      {voicepeakExtraTagEntries.map(([tag, param]) => (
                        <div key={tag} className="settings-voicepeak-tag-row">
                          <span className="settings-voicepeak-extra-tag">
                            [{tag}]
                          </span>
                          <input
                            type="text"
                            spellCheck={false}
                            value={param}
                            onChange={(e) =>
                              updateVoicepeakEmotionTagMapEntry(
                                settings.tts.speaker,
                                tag,
                                e.target.value,
                              )
                            }
                            disabled={disabled}
                          />
                          <button
                            type="button"
                            className="settings-clear-button"
                            disabled={disabled}
                            onClick={() =>
                              updateVoicepeakEmotionTagMapEntry(
                                settings.tts.speaker,
                                tag,
                                '',
                              )
                            }
                          >
                            削除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div
                    className="settings-voicepeak-tag-row"
                    style={{ marginTop: '0.75rem' }}
                  >
                    <input
                      type="text"
                      spellCheck={false}
                      aria-label="追加する感情タグ（小文字）"
                      placeholder="タグ名（例: custom）"
                      value={voicepeakCustomTagDraft.tag}
                      onChange={(e) =>
                        setVoicepeakCustomTagDraft((d) => ({
                          ...d,
                          tag: e.target.value,
                        }))
                      }
                      disabled={disabled}
                    />
                    <input
                      type="text"
                      spellCheck={false}
                      aria-label="追加する emotion パラメータ"
                      placeholder="emotion 値"
                      value={voicepeakCustomTagDraft.param}
                      onChange={(e) =>
                        setVoicepeakCustomTagDraft((d) => ({
                          ...d,
                          param: e.target.value,
                        }))
                      }
                      disabled={disabled}
                    />
                    <button
                      type="button"
                      className="settings-action-button"
                      disabled={
                        disabled ||
                        !voicepeakCustomTagDraft.tag.trim() ||
                        !voicepeakCustomTagDraft.param.trim()
                      }
                      onClick={() => {
                        updateVoicepeakEmotionTagMapEntry(
                          settings.tts.speaker,
                          voicepeakCustomTagDraft.tag,
                          voicepeakCustomTagDraft.param,
                        );
                        setVoicepeakCustomTagDraft({ tag: '', param: '' });
                      }}
                    >
                      タグ行を追加
                    </button>
                  </div>
                </div>
              </>
            )}

            {settings.tts.engine === 'aivisSpeech' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-aivis-speaker">Speaker</label>
                  <select
                    id="tts-aivis-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {aivisSpeakers.length > 0 ? (
                      aivisSpeakers.flatMap((sp) =>
                        (sp.styles || []).map((style) => (
                          <option
                            key={`${sp.speaker_uuid}-${style.id}`}
                            value={String(style.id)}
                          >
                            {sp.name} - {style.name}
                          </option>
                        )),
                      )
                    ) : (
                      <option value="">サーバーから取得中...</option>
                    )}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-aivis-url">API URL</label>
                  <input
                    id="tts-aivis-url"
                    type="text"
                    value={settings.tts.aivisSpeechApiUrl || ''}
                    onChange={(e) => updateAivisSpeechApiUrl(e.target.value)}
                    placeholder="http://localhost:10101"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'minimax' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-minimax-apikey">API Key</label>
                  <input
                    id="tts-minimax-apikey"
                    type="password"
                    value={settings.tts.minimaxApiKey || ''}
                    onChange={(e) => updateMinimaxApiKey(e.target.value)}
                    placeholder="MiniMax API Key"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-minimax-groupid">Group ID</label>
                  <input
                    id="tts-minimax-groupid"
                    type="text"
                    value={settings.tts.minimaxGroupId || ''}
                    onChange={(e) => updateMinimaxGroupId(e.target.value)}
                    placeholder="MiniMax Group ID"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-minimax-speaker">
                    Speaker (Endpoint: global 固定)
                  </label>
                  <select
                    id="tts-minimax-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={
                      disabled ||
                      !settings.tts.minimaxApiKey ||
                      minimaxVoices.length === 0
                    }
                  >
                    {!settings.tts.minimaxApiKey && (
                      <option value="">
                        APIキーを入力すると一覧を取得します
                      </option>
                    )}
                    {settings.tts.minimaxApiKey && isFetchingMinimaxVoices && (
                      <option value="">スピーカー一覧を取得中...</option>
                    )}
                    {settings.tts.minimaxApiKey &&
                      !isFetchingMinimaxVoices &&
                      minimaxVoices.length === 0 && (
                        <option value="">一覧を取得できませんでした</option>
                      )}
                    {minimaxVoices.map((voice) => (
                      <option key={voice.voice_id} value={voice.voice_id}>
                        {voice.voice_name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {settings.tts.engine === 'aivisCloud' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-aiviscloud-apikey">API Key</label>
                  <input
                    id="tts-aiviscloud-apikey"
                    type="password"
                    value={settings.tts.aivisCloudApiKey || ''}
                    onChange={(e) => updateAivisCloudApiKey(e.target.value)}
                    placeholder="Aivis Cloud API Key"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-aiviscloud-preset">Voice</label>
                  <select
                    id="tts-aiviscloud-preset"
                    value={selectedAivisCloudPresetId}
                    onChange={(e) =>
                      handleAivisCloudPresetChange(e.target.value)
                    }
                    disabled={disabled}
                  >
                    {AIVIS_CLOUD_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {fetchError &&
              (settings.tts.engine === 'voicevox' ||
                settings.tts.engine === 'aivisSpeech' ||
                settings.tts.engine === 'minimax') && (
                <div
                  style={{
                    color: '#e94560',
                    fontSize: '0.75rem',
                    marginTop: 4,
                  }}
                >
                  {fetchError}
                </div>
              )}
          </>
        )}
      </div>

      <div className="settings-section">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSection('visual')}
          aria-expanded={expandedSections.visual}
        >
          <h3>Visual</h3>
          <span
            className={`settings-section-chevron${expandedSections.visual ? ' is-open' : ''}`}
          >
            ⌄
          </span>
        </button>

        {expandedSections.visual && (
          <>
            <div className="settings-field">
              <label htmlFor="background-image">背景画像</label>
              <div className="settings-file-picker-row">
                <input
                  id="background-image"
                  className="settings-file-input-hidden"
                  type="file"
                  accept="image/*"
                  disabled={disabled}
                  onChange={(e) => {
                    onBackgroundImageChange(e.target.files?.[0] ?? null);
                    e.currentTarget.value = '';
                  }}
                />
                <label
                  htmlFor="background-image"
                  className={`settings-file-trigger${disabled ? ' is-disabled' : ''}`}
                >
                  画像を選択
                </label>
                <span className="settings-file-hint">PNG / JPG</span>
              </div>
              <div className="settings-file-actions">
                <span className="settings-file-status">
                  {backgroundImageUrl ? '設定済み' : '未設定'}
                </span>
                {backgroundImageUrl && (
                  <button
                    type="button"
                    className="settings-clear-button"
                    onClick={() => onBackgroundImageChange(null)}
                    disabled={disabled}
                  >
                    クリア
                  </button>
                )}
              </div>
            </div>
            <div className="settings-field">
              <label>VRM背景（クロマキー）</label>
              <p className="settings-field-hint">
                PCのチャット画面・ステージ用ウィンドウのVRM向けです。スマホのチャットVRMは暗色固定です。
                ステージ専用ウィンドウ（?window=stage）では、メイン画面と同期するためリップシンク送信に含めた色が即反映されます。
              </p>
              <div className="vrm-bg-switch vrm-bg-switch--settings" role="group" aria-label="クロマキー色">
                <button
                  type="button"
                  className={settings.visual.vrmChromaBg === 'green' ? 'is-active' : ''}
                  onClick={() => updateVrmChromaBg('green')}
                  disabled={disabled}
                >
                  緑
                </button>
                <button
                  type="button"
                  className={settings.visual.vrmChromaBg === 'blue' ? 'is-active' : ''}
                  onClick={() => updateVrmChromaBg('blue')}
                  disabled={disabled}
                >
                  青
                </button>
                <button
                  type="button"
                  className={settings.visual.vrmChromaBg === 'purple' ? 'is-active' : ''}
                  onClick={() => updateVrmChromaBg('purple')}
                  disabled={disabled}
                >
                  紫
                </button>
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="vrm-ambient-light">VRM 環境光の強さ</label>
              <input
                id="vrm-ambient-light"
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={settings.visual.vrmLighting.ambientIntensity}
                onChange={(e) =>
                  updateVrmLighting({
                    ambientIntensity: Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
              <span className="settings-range-value">
                {settings.visual.vrmLighting.ambientIntensity.toFixed(2)}
              </span>
            </div>
            <div className="settings-field">
              <label htmlFor="vrm-directional-light">VRM 指向光の強さ</label>
              <input
                id="vrm-directional-light"
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={settings.visual.vrmLighting.directionalIntensity}
                onChange={(e) =>
                  updateVrmLighting({
                    directionalIntensity: Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
              <span className="settings-range-value">
                {settings.visual.vrmLighting.directionalIntensity.toFixed(2)}
              </span>
            </div>
            <div className="settings-field">
              <label>指向光の位置（X / Y / Z）</label>
              <p className="settings-field-hint">
                ワールド座標です。光はこの位置から原点（モデル付近）へ向かう平行光として扱われます。顎下の影を弱めたいときは Y を上げる、横から当てたいときは X を動かす、など。
              </p>
              <div className="settings-file-picker-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <label htmlFor="vrm-dir-light-x" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.75rem', color: '#aab8c8' }}>X</span>
                  <input
                    id="vrm-dir-light-x"
                    type="number"
                    step={0.1}
                    min={-50}
                    max={50}
                    value={settings.visual.vrmLighting.directionalLightX}
                    onChange={(e) => {
                      const v = Number.parseFloat(e.target.value);
                      if (!Number.isFinite(v)) return;
                      updateVrmLighting({ directionalLightX: v });
                    }}
                    disabled={disabled}
                  />
                </label>
                <label htmlFor="vrm-dir-light-y" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.75rem', color: '#aab8c8' }}>Y</span>
                  <input
                    id="vrm-dir-light-y"
                    type="number"
                    step={0.1}
                    min={-50}
                    max={50}
                    value={settings.visual.vrmLighting.directionalLightY}
                    onChange={(e) => {
                      const v = Number.parseFloat(e.target.value);
                      if (!Number.isFinite(v)) return;
                      updateVrmLighting({ directionalLightY: v });
                    }}
                    disabled={disabled}
                  />
                </label>
                <label htmlFor="vrm-dir-light-z" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.75rem', color: '#aab8c8' }}>Z</span>
                  <input
                    id="vrm-dir-light-z"
                    type="number"
                    step={0.1}
                    min={-50}
                    max={50}
                    value={settings.visual.vrmLighting.directionalLightZ}
                    onChange={(e) => {
                      const v = Number.parseFloat(e.target.value);
                      if (!Number.isFinite(v)) return;
                      updateVrmLighting({ directionalLightZ: v });
                    }}
                    disabled={disabled}
                  />
                </label>
              </div>
            </div>
            <div className="settings-field">
              <label>旧式 VRM 表情（手動まばたき）</label>
              <p className="settings-field-hint">
                アイドル VRMA の Blink を上書きします。チャットの感情タグ（例: happy）とプレビューで Happy / Sad などのプリセットを 0→1 で切り替え、一定秒後にニュートラルへ戻せます。喜びは <code>joy</code> も喜び扱いです。
              </p>
            </div>
            <div className="settings-field">
              <label htmlFor="vrm-legacy-mouth-sens">口パク感度</label>
              <input
                id="vrm-legacy-mouth-sens"
                type="range"
                min={0.1}
                max={2.5}
                step={0.05}
                value={settings.visual.vrmLegacyExpression.mouthSensitivity}
                onChange={(e) =>
                  updateVrmLegacyExpression({
                    mouthSensitivity: Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
              <span className="settings-range-value">
                {settings.visual.vrmLegacyExpression.mouthSensitivity.toFixed(2)}
              </span>
            </div>
            <div className="settings-field">
              <label htmlFor="vrm-legacy-auto-neutral">感情の自動ニュートラル（秒、0でオフ）</label>
              <input
                id="vrm-legacy-auto-neutral"
                type="range"
                min={0}
                max={120}
                step={1}
                value={settings.visual.vrmLegacyExpression.emotionAutoNeutralSeconds}
                onChange={(e) =>
                  updateVrmLegacyExpression({
                    emotionAutoNeutralSeconds: Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
              <span className="settings-range-value">
                {settings.visual.vrmLegacyExpression.emotionAutoNeutralSeconds}
              </span>
            </div>
            <div className="settings-field">
              <label>感情ごとのまばたきを有効にする</label>
              <div className="settings-file-picker-row" style={{ flexWrap: 'wrap', gap: 12 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.visual.vrmLegacyExpression.blinkWhileNeutral}
                    onChange={(e) =>
                      updateVrmLegacyExpression({ blinkWhileNeutral: e.target.checked })
                    }
                    disabled={disabled}
                  />{' '}
                  ニュートラル
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.visual.vrmLegacyExpression.blinkWhileHappy}
                    onChange={(e) =>
                      updateVrmLegacyExpression({ blinkWhileHappy: e.target.checked })
                    }
                    disabled={disabled}
                  />{' '}
                  喜び
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.visual.vrmLegacyExpression.blinkWhileSad}
                    onChange={(e) =>
                      updateVrmLegacyExpression({ blinkWhileSad: e.target.checked })
                    }
                    disabled={disabled}
                  />{' '}
                  悲しみ
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.visual.vrmLegacyExpression.blinkWhileAngry}
                    onChange={(e) =>
                      updateVrmLegacyExpression({ blinkWhileAngry: e.target.checked })
                    }
                    disabled={disabled}
                  />{' '}
                  怒り
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.visual.vrmLegacyExpression.blinkWhileSurprised}
                    onChange={(e) =>
                      updateVrmLegacyExpression({
                        blinkWhileSurprised: e.target.checked,
                      })
                    }
                    disabled={disabled}
                  />{' '}
                  驚き
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.visual.vrmLegacyExpression.blinkWhileRelaxed}
                    onChange={(e) =>
                      updateVrmLegacyExpression({ blinkWhileRelaxed: e.target.checked })
                    }
                    disabled={disabled}
                  />{' '}
                  リラックス
                </label>
              </div>
            </div>
            <div className="settings-field">
              <label>感情ごとのまばたきの強さ（0〜1）</label>
              <div style={{ display: 'grid', gap: 8 }}>
                {(
                  [
                    ['neutral', 'ニュートラル', 'blinkIntensityNeutral'],
                    ['happy', '喜び', 'blinkIntensityHappy'],
                    ['sad', '悲しみ', 'blinkIntensitySad'],
                    ['angry', '怒り', 'blinkIntensityAngry'],
                    ['surprised', '驚き', 'blinkIntensitySurprised'],
                    ['relaxed', 'リラックス', 'blinkIntensityRelaxed'],
                  ] as const
                ).map(([key, label, field]) => (
                  <div key={key} className="settings-field" style={{ marginBottom: 0 }}>
                    <label htmlFor={`vrm-legacy-bi-${key}`}>{label}</label>
                    <input
                      id={`vrm-legacy-bi-${key}`}
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={
                        settings.visual.vrmLegacyExpression[
                          field as keyof typeof settings.visual.vrmLegacyExpression
                        ] as number
                      }
                      onChange={(e) =>
                        updateVrmLegacyExpression({
                          [field]: Number(e.target.value),
                        } as Parameters<typeof updateVrmLegacyExpression>[0])
                      }
                      disabled={disabled}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="settings-field">
              <label>VRM 表情・口パクの調整</label>
              <p className="settings-field-hint">
                下の「口の追従速度」は旧式表情でも使用します。その他（感情の最大強さなど）は旧式のプリセット制御では使わず、下段の「感情ごとのまばたき・口パク・ニュートラル復帰」はチューニング表示用です。
              </p>
            </div>
            <div className="settings-field">
              <label htmlFor="vrm-mood-max">感情の最大強さ</label>
              <input
                id="vrm-mood-max"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.visual.vrmExpressionBlend.moodMaxWeight}
                onChange={(e) =>
                  updateVrmExpressionBlend({
                    moodMaxWeight: Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
              <span className="settings-range-value">
                {settings.visual.vrmExpressionBlend.moodMaxWeight.toFixed(2)}
              </span>
            </div>
            <div className="settings-field">
              <label htmlFor="vrm-mood-while-speaking">発話中の感情倍率</label>
              <input
                id="vrm-mood-while-speaking"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.visual.vrmExpressionBlend.moodScaleWhileSpeaking}
                onChange={(e) =>
                  updateVrmExpressionBlend({
                    moodScaleWhileSpeaking: Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
              <span className="settings-range-value">
                {settings.visual.vrmExpressionBlend.moodScaleWhileSpeaking.toFixed(
                  2,
                )}
              </span>
            </div>
            <div className="settings-field">
              <label htmlFor="vrm-mood-blend-speed">感情の変化速度</label>
              <input
                id="vrm-mood-blend-speed"
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={settings.visual.vrmExpressionBlend.moodBlendSpeed}
                onChange={(e) =>
                  updateVrmExpressionBlend({
                    moodBlendSpeed: Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
              <span className="settings-range-value">
                {settings.visual.vrmExpressionBlend.moodBlendSpeed.toFixed(2)}
              </span>
            </div>
            <div className="settings-field">
              <label htmlFor="vrm-mouth-blend-speed">口の追従速度</label>
              <input
                id="vrm-mouth-blend-speed"
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={settings.visual.vrmExpressionBlend.mouthBlendSpeed}
                onChange={(e) =>
                  updateVrmExpressionBlend({
                    mouthBlendSpeed: Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
              <span className="settings-range-value">
                {settings.visual.vrmExpressionBlend.mouthBlendSpeed.toFixed(2)}
              </span>
            </div>
            <div className="settings-field">
              <label htmlFor="vrm-blink-reduce-mood">まばたき時の感情弱め</label>
              <input
                id="vrm-blink-reduce-mood"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.visual.vrmExpressionBlend.reduceMoodDuringBlink}
                onChange={(e) =>
                  updateVrmExpressionBlend({
                    reduceMoodDuringBlink: Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
              <span className="settings-range-value">
                {settings.visual.vrmExpressionBlend.reduceMoodDuringBlink.toFixed(
                  2,
                )}
              </span>
              <p className="settings-field-hint">0 でオフ。大きいほど Blink が強いとき感情を抑えます。</p>
            </div>
            <div className="settings-field">
              <label>感情ごとのまばたき・口パク・ニュートラル復帰</label>
              <p className="settings-field-hint">
                [neutral] / [happy] / [angry] / [sad] / [relaxed] / [surprised]
                ごとに調整します。ニュートラル復帰は「その感情をやめたあと」表情が消える目安の秒（指数減衰）です。
                下の「プレビュー」で VRM 上の見え方を確認できます（同一タブ内のモデルはそのまま反応。VRM を <code>?window=stage</code> の別ウィンドウに出しているときは BroadcastChannel で表情プレビューも届きます）。
              </p>
              <div className="settings-file-picker-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className="settings-clear-button"
                  disabled={disabled}
                  onClick={() => dispatchVrmEmotionPreview(null)}
                >
                  表情プレビューを終了
                </button>
              </div>
            </div>
            {VRM_TUNE_EMOTION_IDS.map((emotionId) => {
              const t = settings.visual.vrmEmotionTunes[emotionId];
              return (
                <details key={emotionId} className="settings-field">
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    {VRM_EMOTION_TUNING_LABELS[emotionId]}
                  </summary>
                  <p className="settings-field-hint" style={{ marginTop: 8 }}>
                    {VRM_EMOTION_FACE_HINTS[emotionId]}
                  </p>
                  <div className="settings-file-picker-row" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className={`settings-file-trigger${disabled ? ' is-disabled' : ''}`}
                      disabled={disabled}
                      onClick={() => dispatchVrmEmotionPreview(emotionId)}
                    >
                      この表情をVRMでプレビュー（約15秒）
                    </button>
                  </div>
                  <div className="settings-field" style={{ marginTop: 8 }}>
                    <label htmlFor={`vrm-tune-blink-${emotionId}`}>まばたき強度係数</label>
                    <input
                      id={`vrm-tune-blink-${emotionId}`}
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={t.blinkIntensity}
                      onChange={(e) =>
                        updateVrmEmotionTune(emotionId, {
                          blinkIntensity: Number(e.target.value),
                        })
                      }
                      disabled={disabled}
                    />
                    <span className="settings-range-value">
                      {t.blinkIntensity.toFixed(2)}
                    </span>
                    <p className="settings-field-hint">
                      Blink 検出に掛ける倍率。大きいほどまばたきで感情が抑えられやすいです。
                    </p>
                  </div>
                  <div className="settings-field">
                    <label htmlFor={`vrm-tune-mouth-${emotionId}`}>口パク強度係数</label>
                    <input
                      id={`vrm-tune-mouth-${emotionId}`}
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={t.mouthIntensity}
                      onChange={(e) =>
                        updateVrmEmotionTune(emotionId, {
                          mouthIntensity: Number(e.target.value),
                        })
                      }
                      disabled={disabled}
                    />
                    <span className="settings-range-value">
                      {t.mouthIntensity.toFixed(2)}
                    </span>
                  </div>
                  <div className="settings-field">
                    <label htmlFor={`vrm-tune-recover-${emotionId}`}>
                      ニュートラルへ戻る目安（秒）
                    </label>
                    <input
                      id={`vrm-tune-recover-${emotionId}`}
                      type="range"
                      min={0.05}
                      max={8}
                      step={0.05}
                      value={t.neutralRecoverSec}
                      onChange={(e) =>
                        updateVrmEmotionTune(emotionId, {
                          neutralRecoverSec: Number(e.target.value),
                        })
                      }
                      disabled={disabled}
                    />
                    <span className="settings-range-value">
                      {t.neutralRecoverSec.toFixed(2)}s
                    </span>
                  </div>
                </details>
              );
            })}
            <div className="settings-field">
              <label>アバター（VRM）</label>
              <div className="settings-file-picker-row">
                <input
                  id="avatar-vrm-file"
                  className="settings-file-input-hidden"
                  type="file"
                  accept=".vrm"
                  disabled={disabled}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (!file) return;
                    if (!file.name.toLowerCase().endsWith('.vrm')) return;
                    try {
                      const buf = await file.arrayBuffer();
                      await saveVrmBuffer(buf);
                      publishVrmControl({ action: 'reload' });
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                />
                <label
                  htmlFor="avatar-vrm-file"
                  className={`settings-file-trigger${disabled ? ' is-disabled' : ''}`}
                >
                  VRMを変更
                </label>
                <button
                  type="button"
                  className="settings-clear-button"
                  onClick={async () => {
                    await clearStoredVrm();
                    publishVrmControl({ action: 'bundled' });
                  }}
                  disabled={disabled}
                >
                  同梱モデル
                </button>
              </div>
              <div className="settings-file-actions">
                <span className="settings-file-status">
                  モデルは即時反映されます（VRM を別ウィンドウ表示している場合も BroadcastChannel で同期します）
                </span>
              </div>
            </div>
            <div className="settings-field">
              <label>バックアップ・リストア</label>
              <p className="settings-field-hint">
                この画面の設定（LLM / TTS / ストリーム / ビジュアル）に加え、ビジョン設定・オービットカメラの保存位置・IndexedDB
                のカスタム VRM を1つの JSON ファイルにまとめます。API キー等の秘密が平文で入るため、共有・公開リポジトリに置かないでください。
              </p>
              <div className="settings-file-picker-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className="settings-file-trigger"
                  disabled={disabled}
                  onClick={async () => {
                    setBackupRestoreError(null);
                    setBackupRestoreHint(null);
                    try {
                      const payload = await buildAppBackupFileV1(
                        settings,
                        loadVisionSettings(),
                      );
                      downloadAppBackupJson(payload);
                      setBackupRestoreHint('バックアップをダウンロードしました。');
                    } catch (e) {
                      console.error(e);
                      setBackupRestoreError(
                        'バックアップの作成に失敗しました。コンソールを確認してください。',
                      );
                    }
                  }}
                >
                  バックアップをダウンロード
                </button>
                <input
                  ref={backupRestoreInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="settings-file-input-hidden"
                  disabled={disabled}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (!file) return;
                    setBackupRestoreError(null);
                    setBackupRestoreHint(null);
                    try {
                      const text = await file.text();
                      const result = await restoreAppBackupFromJson(
                        text,
                        applySettingsFromBackup,
                      );
                      if (!result.ok) {
                        setBackupRestoreError(result.message);
                        return;
                      }
                      setBackupRestoreHint(
                        'リストアしました。VRM は再読み込み済みです。別ウィンドウやビジョンUIの表示を揃えるには再読み込みを推奨します。',
                      );
                      if (
                        result.reloadSuggested
                        && typeof window !== 'undefined'
                        && window.confirm(
                          'ページを再読み込みして全タブの表示を揃えますか？（キャンセルでも設定は保存済みです）',
                        )
                      ) {
                        window.location.reload();
                      }
                    } catch (err) {
                      console.error(err);
                      setBackupRestoreError(
                        'リストア処理中にエラーが発生しました。コンソールを確認してください。',
                      );
                    }
                  }}
                />
                <button
                  type="button"
                  className="settings-clear-button"
                  disabled={disabled}
                  onClick={() => backupRestoreInputRef.current?.click()}
                >
                  バックアップからリストア…
                </button>
              </div>
              {backupRestoreHint && (
                <p className="settings-field-hint" style={{ color: '#8bc34a' }}>
                  {backupRestoreHint}
                </p>
              )}
              {backupRestoreError && (
                <p className="settings-field-hint" style={{ color: '#ff8a80' }}>
                  {backupRestoreError}
                </p>
              )}
            </div>
            <div className="settings-field">
              <label>復元ポイント（このブラウザ内）</label>
              <p className="settings-field-hint">
                大きな改修の前に「今の設定＋VRM＋ビジョン＋カメラ」を IndexedDB にスナップショットとして残します。最大
                12 件で、それ以上は古いものから自動で削除されます。コード変更とは無関係で、ブラウザのデータを消すと消えます。
              </p>
              <div className="settings-field" style={{ marginBottom: 8 }}>
                <label htmlFor="restore-point-label">ポイント名</label>
                <input
                  id="restore-point-label"
                  type="text"
                  maxLength={80}
                  value={restorePointLabel}
                  onChange={(e) => setRestorePointLabel(e.target.value)}
                  disabled={disabled}
                  style={{ width: '100%', maxWidth: 360, marginTop: 4 }}
                />
              </div>
              <div className="settings-file-picker-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className="settings-file-trigger"
                  disabled={disabled}
                  onClick={async () => {
                    setBackupRestoreError(null);
                    setBackupRestoreHint(null);
                    try {
                      const snapshot = await buildAppBackupFileV1(
                        settings,
                        loadVisionSettings(),
                      );
                      await saveRestorePoint(restorePointLabel, snapshot);
                      await refreshRestorePointsList();
                      setBackupRestoreHint(
                        '復元ポイントを保存しました。一覧からいつでもこの時点へ戻せます。',
                      );
                    } catch (e) {
                      console.error(e);
                      setBackupRestoreError(
                        '復元ポイントの保存に失敗しました。ストレージ容量やブラウザの制限を確認してください。',
                      );
                    }
                  }}
                >
                  この状態を復元ポイントに保存
                </button>
              </div>
              {restorePointsList.length > 0 ? (
                <ul
                  className="settings-restore-points-list"
                  style={{
                    listStyle: 'none',
                    marginTop: 12,
                    padding: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {restorePointsList.map((rp) => (
                    <li
                      key={rp.id}
                      style={{
                        border: '1px solid #0f3460',
                        borderRadius: 8,
                        padding: '8px 10px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 8,
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{rp.label}</div>
                        <div style={{ fontSize: '0.75rem', color: '#aab8c8' }}>
                          {new Date(rp.createdAt).toLocaleString('ja-JP')}
                        </div>
                      </div>
                      <div className="settings-file-picker-row" style={{ gap: 6 }}>
                        <button
                          type="button"
                          className="settings-file-trigger"
                          disabled={disabled}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                'この復元ポイントの内容で現在の設定・VRM・ビジョン・カメラを上書きします。よろしいですか？',
                              )
                            ) {
                              return;
                            }
                            setBackupRestoreError(null);
                            setBackupRestoreHint(null);
                            const result = await restoreAppBackupFromObject(
                              rp.snapshot,
                              applySettingsFromBackup,
                            );
                            if (!result.ok) {
                              setBackupRestoreError(result.message);
                              return;
                            }
                            setBackupRestoreHint(
                              '復元ポイントの内容を適用しました。別ウィンドウを揃える場合は再読み込みしてください。',
                            );
                            if (
                              result.reloadSuggested
                              && window.confirm(
                                'ページを再読み込みしますか？（キャンセルでも変更は保存済みです）',
                              )
                            ) {
                              window.location.reload();
                            }
                          }}
                        >
                          この時点へ戻す
                        </button>
                        <button
                          type="button"
                          className="settings-clear-button"
                          disabled={disabled}
                          onClick={async () => {
                            if (!window.confirm('この復元ポイントを削除しますか？')) {
                              return;
                            }
                            try {
                              await deleteRestorePoint(rp.id);
                              await refreshRestorePointsList();
                            } catch (err) {
                              console.error(err);
                              setBackupRestoreError('復元ポイントの削除に失敗しました。');
                            }
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="settings-field-hint" style={{ marginTop: 8 }}>
                  保存済みの復元ポイントはまだありません。
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <StreamSettings
        stream={settings.stream}
        disabled={disabled}
        isExpanded={expandedSections.stream}
        onToggleExpand={() => toggleSection('stream')}
        streamErrorMessage={streamErrorMessage}
        updateStreamPlatform={updateStreamPlatform}
        updateYoutubeApiKey={updateYoutubeApiKey}
        updateYoutubeLiveId={updateYoutubeLiveId}
        updateYoutubeEnabled={updateYoutubeEnabled}
        updateYoutubeCommentIntervalMs={updateYoutubeCommentIntervalMs}
        updateTwitchClientId={updateTwitchClientId}
        updateTwitchAccessToken={updateTwitchAccessToken}
        updateTwitchChannel={updateTwitchChannel}
        updateTwitchEnabled={updateTwitchEnabled}
        updateTwitchCommentIntervalMs={updateTwitchCommentIntervalMs}
        updateJikkyoTcpEnabled={updateJikkyoTcpEnabled}
        updateJikkyoListenPort={updateJikkyoListenPort}
        updateJikkyoBouyomiPort={updateJikkyoBouyomiPort}
        updateJikkyoForwardToBouyomi={updateJikkyoForwardToBouyomi}
        updateJikkyoSendToAi={updateJikkyoSendToAi}
        updateJikkyoAiHeaderEnabled={updateJikkyoAiHeaderEnabled}
        updateJikkyoAiHeaderText={updateJikkyoAiHeaderText}
      />
    </div>
  );
}
