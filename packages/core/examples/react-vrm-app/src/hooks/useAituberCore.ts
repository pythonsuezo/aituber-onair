import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AITuberOnAirCore,
  AITuberOnAirCoreEvent,
  textToScreenplay,
} from '@aituber-onair/core';
import type {
  VoiceServiceOptions,
  ElevenLabsApplyTextNormalization,
  UnrealSpeechCodec,
  XaiBitRate,
  XaiCodec,
  XaiSampleRate,
} from '@aituber-onair/core';
import type { ChatMessage } from '../types/chat';
import type { AppSettings, ChatProviderOption } from '../types/settings';
import {
  DEFAULT_AITUBER_SYSTEM_PROMPT,
  LEGACY_VRM_SYSTEM_PROMPT_MARKER,
} from '../constants/defaultAituberSystemPrompt';
import {
  VOICEPEAK_EMOTION_BY_NARRATOR,
  VOICEPEAK_NARRATOR_TAG_REFERENCE,
  mergeVoicepeakEmotionTagMaps,
} from '../constants/voicepeakNarratorEmotions';

interface UseAituberCoreOptions {
  onAudioPlay: (arrayBuffer: ArrayBuffer) => Promise<void>;
  settings: AppSettings;
  getApiKeyForProvider: (provider: ChatProviderOption) => string;
}

const DEFAULT_SYSTEM_PROMPT = DEFAULT_AITUBER_SYSTEM_PROMPT;

/** 設定欄に保存された全文既定などを、固定ブロックの「追記分」だけに正規化する。 */
function normalizeUserSystemPromptExtra(raw: string): string {
  let t = raw.trim();
  if (!t) return '';
  if (t === DEFAULT_AITUBER_SYSTEM_PROMPT.trim()) return '';
  if (t.includes(LEGACY_VRM_SYSTEM_PROMPT_MARKER)) {
    t = (t.split(LEGACY_VRM_SYSTEM_PROMPT_MARKER)[0] ?? '').trim();
  }
  return t;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * スマホで `http://<PCのLAN-IP>:5173` を開いたとき、VOICEPEAK の URL が `localhost` のままだと
 * スマホ自身の localhost を指してしまう。設定が空なら「今のページと同じホストの 20202」を使う。
 */
function resolveVoicepeakApiUrl(
  configured: string | undefined,
): string | undefined {
  const trimmed = configured?.trim();
  if (trimmed) return trimmed;
  if (typeof window === 'undefined') return undefined;
  const { protocol, hostname } = window.location;
  if (
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1' &&
    hostname !== '[::1]'
  ) {
    return `${protocol}//${hostname}:20202`;
  }
  return undefined;
}

function extractEmotionFromSpeechStart(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const o = data as Record<string, unknown>;
  const screenplay = o.screenplay;
  if (screenplay && typeof screenplay === 'object') {
    const em = (screenplay as { emotion?: string }).emotion;
    if (typeof em === 'string' && em.trim()) {
      return em.trim().toLowerCase();
    }
    return undefined;
  }
  const direct = (o as { emotion?: string }).emotion;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim().toLowerCase();
  }
  return undefined;
}

function extractEmotionFromScreenplayPayload(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const screenplay = (data as { screenplay?: { emotion?: string } }).screenplay;
  const em = screenplay?.emotion;
  if (typeof em === 'string' && em.trim()) {
    return em.trim().toLowerCase();
  }
  return undefined;
}

function getTtsApiKey(
  settings: AppSettings,
  getApiKeyForProvider: (provider: ChatProviderOption) => string,
): string {
  if (settings.tts.engine === 'openai') {
    return getApiKeyForProvider('openai');
  }
  if (settings.tts.engine === 'geminiTts') {
    return getApiKeyForProvider('gemini');
  }
  if (settings.tts.engine === 'openaiCompatible') {
    return settings.tts.openAiCompatibleApiKey || '';
  }
  if (settings.tts.engine === 'aivisCloud') {
    return settings.tts.aivisCloudApiKey || '';
  }
  if (settings.tts.engine === 'minimax') {
    return settings.tts.minimaxApiKey || '';
  }
  if (settings.tts.engine === 'xai') {
    return getApiKeyForProvider('xai');
  }
  if (settings.tts.engine === 'unrealSpeech') {
    return settings.tts.unrealSpeechApiKey || '';
  }
  if (settings.tts.engine === 'elevenLabs') {
    return settings.tts.elevenLabsApiKey || '';
  }
  return getApiKeyForProvider(settings.llm.provider);
}

function buildVoiceOptions(
  tts: AppSettings['tts'],
  apiKey: string,
  onPlay: (audioBuffer: ArrayBuffer) => Promise<void>,
): VoiceServiceOptions {
  const parsedAivisCloudStyleId = Number.parseInt(
    tts.aivisCloudStyleId || '',
    10,
  );
  const parsedOpenAiCompatibleSpeed = Number.parseFloat(
    tts.openAiCompatibleSpeed || '',
  );
  const parsedXaiSampleRate = Number.parseInt(
    String(tts.xaiSampleRate || ''),
    10,
  );
  const parsedXaiBitRate = Number.parseInt(String(tts.xaiBitRate || ''), 10);
  const parsedUnrealSpeechSpeed = Number.parseFloat(
    tts.unrealSpeechSpeed || '',
  );
  const parsedUnrealSpeechPitch = Number.parseFloat(
    tts.unrealSpeechPitch || '',
  );
  const parsedUnrealSpeechTemperature = Number.parseFloat(
    tts.unrealSpeechTemperature || '',
  );
  const parsedElevenLabsStability = Number.parseFloat(
    tts.elevenLabsStability || '',
  );
  const parsedElevenLabsSimilarityBoost = Number.parseFloat(
    tts.elevenLabsSimilarityBoost || '',
  );
  const parsedElevenLabsStyle = Number.parseFloat(tts.elevenLabsStyle || '');
  const parsedElevenLabsSpeed = Number.parseFloat(tts.elevenLabsSpeed || '');
  const parsedElevenLabsSeed = Number.parseInt(tts.elevenLabsSeed || '', 10);
  const parsedPiperPlusSpeed = Number.parseFloat(tts.piperPlusSpeed || '');
  const parsedPiperPlusNoiseScale = Number.parseFloat(
    tts.piperPlusNoiseScale || '',
  );
  const trimmedSpeaker = tts.speaker.trim();

  return {
    engineType: tts.engine,
    speaker:
      tts.engine === 'openaiCompatible' && !trimmedSpeaker
        ? undefined
        : trimmedSpeaker,
    apiKey,
    openAiCompatibleApiUrl: tts.openAiCompatibleApiUrl,
    openAiCompatibleModel: tts.openAiCompatibleModel,
    openAiCompatibleSpeed: Number.isNaN(parsedOpenAiCompatibleSpeed)
      ? undefined
      : parsedOpenAiCompatibleSpeed,
    geminiTtsModel: tts.geminiTtsModel,
    geminiTtsLanguageCode: tts.geminiTtsLanguageCode?.trim() || undefined,
    geminiTtsPrompt: tts.geminiTtsPrompt?.trim() || undefined,
    voicevoxApiUrl: tts.voicevoxApiUrl,
    voicepeakApiUrl: resolveVoicepeakApiUrl(tts.voicepeakApiUrl),
    aivisSpeechApiUrl: tts.aivisSpeechApiUrl,
    groupId: tts.minimaxGroupId,
    endpoint: tts.engine === 'minimax' ? 'global' : undefined,
    aivisCloudModelUuid: tts.aivisCloudModelUuid,
    aivisCloudSpeakerUuid: tts.aivisCloudSpeakerUuid,
    aivisCloudStyleId: Number.isNaN(parsedAivisCloudStyleId)
      ? undefined
      : parsedAivisCloudStyleId,
    xaiLanguage: tts.xaiLanguage?.trim() || undefined,
    xaiCodec: tts.xaiCodec as XaiCodec | undefined,
    xaiSampleRate: Number.isNaN(parsedXaiSampleRate)
      ? undefined
      : (parsedXaiSampleRate as XaiSampleRate),
    xaiBitRate:
      tts.xaiCodec === 'mp3' && !Number.isNaN(parsedXaiBitRate)
        ? (parsedXaiBitRate as XaiBitRate)
        : undefined,
    unrealSpeechApiUrl: tts.unrealSpeechApiUrl?.trim() || undefined,
    unrealSpeechBitrate: tts.unrealSpeechBitrate?.trim() || undefined,
    unrealSpeechSpeed: Number.isNaN(parsedUnrealSpeechSpeed)
      ? undefined
      : parsedUnrealSpeechSpeed,
    unrealSpeechPitch: Number.isNaN(parsedUnrealSpeechPitch)
      ? undefined
      : parsedUnrealSpeechPitch,
    unrealSpeechCodec:
      (tts.unrealSpeechCodec as UnrealSpeechCodec | undefined) || undefined,
    unrealSpeechTemperature: Number.isNaN(parsedUnrealSpeechTemperature)
      ? undefined
      : parsedUnrealSpeechTemperature,
    elevenLabsApiUrl: tts.elevenLabsApiUrl?.trim() || undefined,
    elevenLabsModel: tts.elevenLabsModel?.trim() || undefined,
    elevenLabsOutputFormat: tts.elevenLabsOutputFormat?.trim() || undefined,
    elevenLabsLanguageCode: tts.elevenLabsLanguageCode?.trim() || undefined,
    elevenLabsStability: Number.isNaN(parsedElevenLabsStability)
      ? undefined
      : parsedElevenLabsStability,
    elevenLabsSimilarityBoost: Number.isNaN(parsedElevenLabsSimilarityBoost)
      ? undefined
      : parsedElevenLabsSimilarityBoost,
    elevenLabsStyle: Number.isNaN(parsedElevenLabsStyle)
      ? undefined
      : parsedElevenLabsStyle,
    elevenLabsUseSpeakerBoost:
      tts.elevenLabsUseSpeakerBoost &&
      tts.elevenLabsUseSpeakerBoost !== 'default'
        ? tts.elevenLabsUseSpeakerBoost === 'true'
        : undefined,
    elevenLabsSpeed: Number.isNaN(parsedElevenLabsSpeed)
      ? undefined
      : parsedElevenLabsSpeed,
    elevenLabsSeed: Number.isNaN(parsedElevenLabsSeed)
      ? undefined
      : parsedElevenLabsSeed,
    elevenLabsApplyTextNormalization:
      tts.elevenLabsApplyTextNormalization &&
      tts.elevenLabsApplyTextNormalization !== 'default'
        ? (tts.elevenLabsApplyTextNormalization as ElevenLabsApplyTextNormalization)
        : undefined,
    piperPlusBasePath: tts.piperPlusBasePath?.trim() || undefined,
    piperPlusModelConfigFile: tts.piperPlusModelConfigFile?.trim() || undefined,
    piperPlusModelFile: tts.piperPlusModelFile?.trim() || undefined,
    piperPlusVoiceFile: tts.piperPlusVoiceFile?.trim() || undefined,
    piperPlusSpeed: Number.isNaN(parsedPiperPlusSpeed)
      ? undefined
      : parsedPiperPlusSpeed,
    piperPlusNoiseScale: Number.isNaN(parsedPiperPlusNoiseScale)
      ? undefined
      : parsedPiperPlusNoiseScale,
    ...(tts.engine === 'voicepeak'
      ? {
          voicepeakEmotionByNarrator: VOICEPEAK_EMOTION_BY_NARRATOR,
          voicepeakEmotionTagMapByNarrator: mergeVoicepeakEmotionTagMaps(
            VOICEPEAK_NARRATOR_TAG_REFERENCE,
            tts.voicepeakEmotionTagMapByNarrator,
          ),
        }
      : {}),
    onPlay,
  } as VoiceServiceOptions;
}

export function useAituberCore({
  onAudioPlay,
  settings,
  getApiKeyForProvider,
}: UseAituberCoreOptions) {
  const coreRef = useRef<AITuberOnAirCore | null>(null);
  const messageIdSequenceRef = useRef(0);
  /** Current processing cycle ID to avoid losing final bubbles. */
  const processingCycleIdRef = useRef(0);
  /** Cycle ID that already emitted assistant final text. */
  const assistantFinalCycleIdRef = useRef(0);
  /** Last partial text received in current cycle. */
  const latestPartialRef = useRef('');
  /** 同時送信: 次のビジョン1回分のチャット本文（バブル表示用） */
  const pendingVisionUserTextRef = useRef<string | null>(null);
  /** 連続のビジョン送信を直列化（二重 postMessage 等の競合防止） */
  const visionSendChainRef = useRef<Promise<void>>(Promise.resolve());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [partialResponse, setPartialResponse] = useState('');
  const [assistantEmotion, setAssistantEmotion] = useState<string | undefined>(
    undefined,
  );

  // Keep the latest onAudioPlay callback in a ref
  const onAudioPlayRef = useRef(onAudioPlay);
  onAudioPlayRef.current = onAudioPlay;

  const llmApiKey = getApiKeyForProvider(settings.llm.provider);
  const ttsApiKey = getTtsApiKey(settings, getApiKeyForProvider);
  const isOpenAICompatibleProvider =
    settings.llm.provider === 'openai-compatible';
  const isApiKeyOptionalProvider =
    isOpenAICompatibleProvider || settings.llm.provider === 'gemini-nano';
  const openAICompatibleEndpoint = settings.llm.endpoint?.trim() || '';
  const resolvedModel =
    settings.llm.provider === 'openai-compatible'
      ? settings.llm.model.trim() || 'local-model'
      : settings.llm.model;
  const userSystemPromptExtra = normalizeUserSystemPromptExtra(
    settings.llm.systemPrompt ?? '',
  );
  const effectiveSystemPrompt = userSystemPromptExtra
    ? `${DEFAULT_SYSTEM_PROMPT}\n\n${userSystemPromptExtra}`
    : DEFAULT_SYSTEM_PROMPT;
  const createMessageId = useCallback(() => {
    messageIdSequenceRef.current += 1;
    return `${Date.now()}-${messageIdSequenceRef.current}`;
  }, []);

  // Effect 1: Recreate core when LLM settings change
  useEffect(() => {
    if (!isApiKeyOptionalProvider && !llmApiKey) {
      coreRef.current?.offAll();
      coreRef.current = null;
      console.error(
        `API key is not set for provider: ${settings.llm.provider}`,
      );
      return;
    }

    if (isOpenAICompatibleProvider && !openAICompatibleEndpoint) {
      coreRef.current?.offAll();
      coreRef.current = null;
      console.error('Endpoint URL is required for openai-compatible provider');
      return;
    }

    const core = new AITuberOnAirCore({
      apiKey: llmApiKey.trim(),
      chatProvider: settings.llm.provider,
      model: resolvedModel,
      providerOptions: isOpenAICompatibleProvider
        ? { endpoint: openAICompatibleEndpoint }
        : undefined,
      chatOptions: {
        systemPrompt: effectiveSystemPrompt,
      },
      voiceOptions: buildVoiceOptions(
        settings.tts,
        ttsApiKey,
        async (audioBuffer: ArrayBuffer) => {
          await onAudioPlayRef.current(audioBuffer);
        },
      ),
      debug: false,
    } as ConstructorParameters<typeof AITuberOnAirCore>[0]);

    // Subscribe to core events
    core.on(AITuberOnAirCoreEvent.PROCESSING_START, () => {
      processingCycleIdRef.current += 1;
      latestPartialRef.current = '';
      setIsProcessing(true);
      setPartialResponse('');
      setAssistantEmotion(undefined);
    });

    core.on(AITuberOnAirCoreEvent.PROCESSING_END, () => {
      const cycleId = processingCycleIdRef.current;
      const partial = latestPartialRef.current.trim();
      if (
        partial &&
        assistantFinalCycleIdRef.current !== cycleId
      ) {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            role: 'assistant',
            content: partial,
            timestamp: Date.now(),
          },
        ]);
      }
      latestPartialRef.current = '';
      setIsProcessing(false);
      setPartialResponse('');
    });

    core.on(AITuberOnAirCoreEvent.ASSISTANT_PARTIAL, (data: unknown) => {
      const text =
        typeof data === 'string'
          ? data
          : ((data as { message?: string; rawText?: string })?.message ??
            (data as { rawText?: string })?.rawText ??
            String(data));
      latestPartialRef.current = text;
      setPartialResponse(text);
      const partialEmotion = textToScreenplay(text).emotion;
      if (partialEmotion) {
        setAssistantEmotion(partialEmotion.toLowerCase());
      }
    });

    core.on(AITuberOnAirCoreEvent.ASSISTANT_RESPONSE, (data: unknown) => {
      let content: string;
      if (typeof data === 'string') {
        content = data;
      } else {
        const d = data as {
          message?: { content?: string } | string;
          rawText?: string;
        };
        const msg = d?.message;
        content =
          (typeof msg === 'string' ? msg : msg?.content) ??
          d?.rawText ??
          String(data);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: 'assistant',
          content,
          timestamp: Date.now(),
        },
      ]);
      assistantFinalCycleIdRef.current = processingCycleIdRef.current;
      latestPartialRef.current = '';
      setPartialResponse('');
      const fromScreenplay = extractEmotionFromScreenplayPayload(data);
      if (fromScreenplay) {
        setAssistantEmotion(fromScreenplay);
      }
    });

    core.on(AITuberOnAirCoreEvent.SPEECH_START, (payload: unknown) => {
      const em = extractEmotionFromSpeechStart(payload);
      if (em) {
        setAssistantEmotion(em);
      }
    });

    core.on(AITuberOnAirCoreEvent.SPEECH_END, () => {
      setAssistantEmotion(undefined);
    });

    core.on(AITuberOnAirCoreEvent.ASSISTANT_RESPONSE_TRUNCATED, (data: unknown) => {
      const fromScreenplay = extractEmotionFromScreenplayPayload(data);
      if (fromScreenplay) {
        setAssistantEmotion(fromScreenplay);
      }
    });

    core.on(AITuberOnAirCoreEvent.ERROR, (error: unknown) => {
      console.error('AITuberOnAirCore error:', error);
      setIsProcessing(false);
    });

    coreRef.current = core;

    return () => {
      core.offAll();
      coreRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.llm.provider,
    settings.llm.model,
    settings.llm.endpoint,
    settings.llm.systemPrompt,
    llmApiKey,
    isApiKeyOptionalProvider,
    createMessageId,
  ]);

  // Effect 2: Update voice service when TTS settings change (no core recreation)
  useEffect(() => {
    if (!coreRef.current) return;
    coreRef.current.updateVoiceService(
      buildVoiceOptions(
        settings.tts,
        ttsApiKey,
        async (audioBuffer: ArrayBuffer) => {
          await onAudioPlayRef.current(audioBuffer);
        },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.tts.engine,
    settings.tts.speaker,
    settings.tts.openAiCompatibleApiUrl,
    settings.tts.openAiCompatibleModel,
    settings.tts.openAiCompatibleSpeed,
    settings.tts.voicevoxApiUrl,
    settings.tts.voicepeakApiUrl,
    settings.tts.voicepeakEmotionTagMapByNarrator,
    settings.tts.aivisSpeechApiUrl,
    settings.tts.aivisCloudModelUuid,
    settings.tts.aivisCloudSpeakerUuid,
    settings.tts.aivisCloudStyleId,
    settings.tts.minimaxGroupId,
    settings.tts.xaiLanguage,
    settings.tts.xaiCodec,
    settings.tts.xaiSampleRate,
    settings.tts.xaiBitRate,
    ttsApiKey,
  ]);

  const setPendingVisionPairWithUserText = useCallback((text: string) => {
    pendingVisionUserTextRef.current = text;
  }, []);

  const cancelPendingVisionUserText = useCallback(() => {
    pendingVisionUserTextRef.current = null;
  }, []);

  const processChat = useCallback(
    async (text: string) => {
      if (!coreRef.current || !text.trim()) return;

      // Append the user message to the chat log
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: 'user',
          content: text.trim(),
          timestamp: Date.now(),
        },
      ]);

      try {
        await coreRef.current.processChat(text.trim());
      } catch (err) {
        console.error('processChat error:', err);
        setIsProcessing(false);
      }
    },
    [createMessageId],
  );

  const sendVisionFrame = useCallback(
    async (imageDataUrl: string, visionPrompt: string) => {
      const task = async () => {
        if (!coreRef.current || !imageDataUrl) return;

        const pairedForBubble = pendingVisionUserTextRef.current;
        pendingVisionUserTextRef.current = null;

        const visionInstruction =
          visionPrompt.trim() ||
          'この画像はOBSのプレビューまたはキャプチャボードの映像です。画面上の内容を日本語で簡潔に説明してください。配信に役立つ気づきがあれば述べてください。';

        const bubbleText =
          pairedForBubble?.trim() ||
          (visionPrompt.trim() || '（OBS / キャプチャ画面を送信）');

        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            role: 'user',
            content: bubbleText,
            timestamp: Date.now(),
            imageDataUrl,
          },
        ]);

        const maxWaitMs = 180_000;
        const deadline = Date.now() + maxWaitMs;
        while (coreRef.current?.isChatBusy()) {
          if (Date.now() > deadline) {
            console.warn(
              '[vision] timed out waiting for previous chat to finish; attempting vision anyway',
            );
            break;
          }
          await delay(50);
        }

        const core = coreRef.current;
        if (!core) {
          return;
        }

        try {
          const ok = await core.processVisionChat(
            imageDataUrl,
            visionInstruction,
          );
          if (!ok) {
            console.warn(
              '[vision] processVisionChat was skipped (core still reported busy)',
            );
          }
        } catch (err) {
          console.error('processVisionChat error:', err);
          setIsProcessing(false);
        }
      };

      visionSendChainRef.current = visionSendChainRef.current
        .then(task)
        .catch((err) => {
          console.error('sendVisionFrame chain:', err);
          setIsProcessing(false);
        });
      await visionSendChainRef.current;
    },
    [createMessageId],
  );

  return {
    messages,
    isProcessing,
    partialResponse,
    assistantEmotion,
    processChat,
    sendVisionFrame,
    setPendingVisionPairWithUserText,
    cancelPendingVisionUserText,
  };
}
