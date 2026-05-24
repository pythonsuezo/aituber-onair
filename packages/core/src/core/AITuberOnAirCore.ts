import { EventEmitter } from './EventEmitter';
import { ChatProcessor, ChatProcessorOptions } from './ChatProcessor';
import { MemoryManager, MemoryOptions, Summarizer } from './MemoryManager';
import {
  ChatService,
  ChatServiceFactory,
  ChatProviderName,
  ChatServiceOptionsByProvider,
  OpenAIChatServiceOptions,
  OpenAICompatibleChatServiceOptions,
  OpenRouterChatServiceOptions,
  GeminiChatServiceOptions,
  GeminiNanoChatServiceOptions,
  ClaudeChatServiceOptions,
  ZAIChatServiceOptions,
  KimiChatServiceOptions,
  XAIChatServiceOptions,
} from '@aituber-onair/chat';
import { OpenAISummarizer } from '../services/chat/providers/openai/OpenAISummarizer';
import { GeminiSummarizer } from '../services/chat/providers/gemini/GeminiSummarizer';
import { ClaudeSummarizer } from '../services/chat/providers/claude/ClaudeSummarizer';
import {
  VoiceService,
  VoiceServiceOptions,
  VoiceServiceOptionsUpdate,
  AudioPlayOptions,
  VoiceEngineAdapter,
} from '@aituber-onair/voice';
import {
  Message,
  MessageWithVision,
  ToolDefinition,
  ToolUseBlock,
  ToolResultBlock,
  textToScreenplay,
  screenplayToText,
  MCPServerConfig,
  MODEL_GPT_4O_MINI,
  MODEL_GEMINI_DEFAULT_LITE,
  normalizeGeminiModelId,
  MODEL_CLAUDE_4_5_HAIKU,
} from '@aituber-onair/chat';
import { MemoryStorage } from '../types';
import { ToolExecutor } from './ToolExecutor';

function sanitizeSpeechText(text: string): string {
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u2028|\u2029/g, '\n')
    .trim();
}

function isVoicePeakCliCrashError(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : error);
  return /0xc0000005|voicepeak CLI failed|status=500/i.test(msg);
}

function bisectSpeechChunk(text: string): [string, string] | null {
  const trimmed = sanitizeSpeechText(text);
  if (trimmed.length < 2) {
    return null;
  }
  const mid = Math.floor(trimmed.length / 2);
  let cut = -1;
  for (const sep of ['。', '！', '？', '\n', '、', '，'] as const) {
    const left = trimmed.lastIndexOf(sep, mid);
    const right = trimmed.indexOf(sep, mid);
    const candidates = [left, right].filter((i) => i >= 0);
    if (candidates.length === 0) continue;
    const pick = candidates.reduce((best, i) =>
      Math.abs(i - mid) < Math.abs(best - mid) ? i : best,
    );
    if (cut < 0 || Math.abs(pick - mid) < Math.abs(cut - mid)) {
      cut = pick + sep.length;
    }
  }
  if (cut <= 0 || cut >= trimmed.length) {
    cut = mid;
  }
  const a = trimmed.slice(0, cut).trim();
  const b = trimmed.slice(cut).trim();
  if (!a || !b || a === trimmed || b === trimmed) {
    return null;
  }
  return [a, b];
}

type SpeechChunkLocalePreset = Exclude<SpeechChunkLocale, 'all'>;

const SPEECH_CHUNK_SEPARATOR_PRESETS_BASE: Record<
  SpeechChunkLocalePreset,
  string[]
> = {
  ja: ['。', '！', '？', '、', '，', '…'],
  en: ['.', '!', '?'],
  ko: ['.', '!', '?', '。', '！', '？'],
  zh: ['。', '！', '？', '，', '、'],
};

const SPEECH_CHUNK_SEPARATOR_PRESETS: Record<SpeechChunkLocale, string[]> = {
  ...SPEECH_CHUNK_SEPARATOR_PRESETS_BASE,
  all: Array.from(
    new Set(Object.values(SPEECH_CHUNK_SEPARATOR_PRESETS_BASE).flat()),
  ),
};

const FALLBACK_SEPARATORS = ['.', '!', '?', '。', '！', '？'];
const ALWAYS_SPLIT_CHARACTERS = ['\n', '\r'];

/**
 * Setting options for AITuberOnAirCore
 */
export type SpeechChunkLocale = 'ja' | 'en' | 'ko' | 'zh' | 'all';

export interface SpeechChunkingOptions {
  /** Enable or disable speech chunking. Defaults to false (disabled). */
  enabled?: boolean;
  /** Minimum words (approx.) per speech chunk. Set to 0 or omit to disable merging. */
  minWords?: number;
  /** Locale preset used to decide punctuation delimiters. */
  locale?: SpeechChunkLocale;
  /** Custom separator characters (overrides locale preset). */
  separators?: string[];
  /**
   * 1 リクエストあたりの最大文字数。
   * 句読点で区切ったあと、上限に近づくまで文を結合し、それでも超える塊だけ細分化する。
   * VoicePeak など（仕様上 141 文字未満、例: 140）。
   */
  maxCharsPerChunk?: number;
}

/**
 * 長期記憶用の要約 API。指定するとメインのチャット LLM とは別のキー／モデルで要約する。
 */
export type MemorySummarizerOverride =
  | { provider: 'gemini'; apiKey: string; model?: string }
  | { provider: 'openai'; apiKey: string; model?: string }
  | { provider: 'claude'; apiKey: string; model?: string }
  | {
      provider: 'openai-compatible';
      apiKey: string;
      endpoint: string;
      model?: string;
    };

export interface AITuberOnAirCoreOptions {
  /** AI provider name */
  chatProvider?: ChatProviderName;
  /** AI API key */
  apiKey: string;
  /** AI model name (default is provider's default model) */
  model?: string;
  /** ChatProcessor options */
  chatOptions: Omit<ChatProcessorOptions, 'useMemory'>;
  /** Memory options (disabled by default) */
  memoryOptions?: MemoryOptions;
  /** Memory storage for persistence (optional) */
  memoryStorage?: MemoryStorage;
  /**
   * 要約専用の API（任意）。`apiKey` が空でないとき、メインの `chatProvider` ではなく
   * ここで指定したプロバイダで会話要約を行う。
   */
  memorySummarizer?: MemorySummarizerOverride;
  /** Voice service options */
  voiceOptions?: VoiceServiceOptions;
  /** Speech chunking behaviour */
  speechChunking?: SpeechChunkingOptions;
  /** Debug mode */
  debug?: boolean;
  /** ChatService provider-specific options (optional) */
  providerOptions?: Omit<
    ChatServiceOptionsByProvider[ChatProviderName],
    'apiKey' | 'model' | 'tools'
  >;
  /** Tools */
  tools?: {
    definition: ToolDefinition;
    handler: (input: any) => Promise<any>;
  }[];
  /** MCP servers configuration (OpenAI, Claude, and Gemini) */
  mcpServers?: MCPServerConfig[];
}

type ProviderOptionsByName<TProvider extends ChatProviderName> = Omit<
  ChatServiceOptionsByProvider[TProvider],
  'apiKey' | 'model' | 'tools'
>;

/**
 * Event types for AITuberOnAirCore
 */
export enum AITuberOnAirCoreEvent {
  /** Processing started */
  PROCESSING_START = 'processingStart',
  /** Processing ended */
  PROCESSING_END = 'processingEnd',
  /** Assistant (partial) response */
  ASSISTANT_PARTIAL = 'assistantPartial',
  /** Assistant response completed */
  ASSISTANT_RESPONSE = 'assistantResponse',
  /** Assistant response was truncated by the model/token budget */
  ASSISTANT_RESPONSE_TRUNCATED = 'assistantResponseTruncated',
  /** Speech started */
  SPEECH_START = 'speechStart',
  /** Speech ended */
  SPEECH_END = 'speechEnd',
  /** Error occurred */
  ERROR = 'error',
  /** Tool use */
  TOOL_USE = 'toolUse',
  /** Tool result */
  TOOL_RESULT = 'toolResult',
  /** Chat history set */
  CHAT_HISTORY_SET = 'chatHistorySet',
  /** Chat history cleared */
  CHAT_HISTORY_CLEARED = 'chatHistoryCleared',
  /** Memory created */
  MEMORY_CREATED = 'memoryCreated',
  /** Memory removed */
  MEMORY_REMOVED = 'memoryRemoved',
  /** Memory loaded */
  MEMORY_LOADED = 'memoryLoaded',
  /** Memory saved */
  MEMORY_SAVED = 'memorySaved',
  /** Storage cleared */
  STORAGE_CLEARED = 'storageCleared',
}

/**
 * AITuberOnAirCore is a core class that integrates the main features of AITuber
 * - Chat processing (ChatService, ChatProcessor)
 * - Speech synthesis (VoiceService)
 * - Memory management (MemoryManager)
 */
export class AITuberOnAirCore extends EventEmitter {
  private chatService: ChatService;
  private chatProcessor: ChatProcessor;
  private memoryManager?: MemoryManager;
  private voiceService?: VoiceService;
  private isProcessing: boolean = false;
  private debug: boolean;
  private toolExecutor: ToolExecutor = new ToolExecutor();
  private speechChunkEnabled: boolean;
  private speechChunkMinWords: number;
  private speechChunkLocale: SpeechChunkLocale;
  private speechChunkSeparators?: string[];
  private speechChunkMaxChars: number;
  /**
   * Constructor
   * @param options Configuration options
   */
  constructor(options: AITuberOnAirCoreOptions) {
    super();
    this.debug = options.debug || false;
    const speechChunkingOptions = options.speechChunking ?? {};
    this.speechChunkEnabled = speechChunkingOptions.enabled ?? false;
    this.speechChunkMinWords = Math.max(0, speechChunkingOptions.minWords ?? 0);
    this.speechChunkLocale = speechChunkingOptions.locale ?? 'ja';
    this.speechChunkSeparators = speechChunkingOptions.separators;
    this.speechChunkMaxChars = Math.max(
      0,
      speechChunkingOptions.maxCharsPerChunk ?? 0,
    );

    // Determine provider name (default is 'openai')
    const providerName: ChatProviderName = options.chatProvider || 'openai';

    // Register tools
    options.tools?.forEach((t) =>
      this.toolExecutor.register(t.definition, t.handler),
    );

    // Build chat service options
    const baseOptions = {
      apiKey: options.apiKey,
      model: options.model,
      tools: this.toolExecutor.listDefinitions(),
    };

    const chatServiceOptions = this.buildChatServiceOptions(
      providerName,
      baseOptions,
      options.providerOptions,
    );

    // Add MCP servers for providers that support remote MCP
    if (
      (providerName === 'claude' ||
        providerName === 'openai' ||
        providerName === 'gemini') &&
      options.mcpServers
    ) {
      (
        chatServiceOptions as ChatServiceOptionsByProvider[
          | 'claude'
          | 'openai'
          | 'gemini']
      ).mcpServers = options.mcpServers;
      // Also set MCP servers in ToolExecutor for handling MCP tool calls
      this.toolExecutor.setMCPServers(options.mcpServers);
    }

    // Initialize ChatService
    this.chatService = ChatServiceFactory.createChatService(
      providerName,
      chatServiceOptions,
    );

    // Initialize MemoryManager (optional)
    if (options.memoryOptions?.enableSummarization) {
      let summarizer: Summarizer;
      const tmpl = options.memoryOptions.summaryPromptTemplate;
      const ms = options.memorySummarizer;
      const overrideReady =
        ms &&
        (ms.provider === 'openai-compatible'
          ? typeof ms.endpoint === 'string' && ms.endpoint.trim().length > 0
          : typeof ms.apiKey === 'string' &&
            ms.apiKey.trim().length > 0 &&
            (ms.provider === 'gemini' ||
              ms.provider === 'openai' ||
              ms.provider === 'claude'));

      if (overrideReady && ms) {
        const key = ms.apiKey.trim();
        const resolvedModel =
          typeof ms.model === 'string' && ms.model.trim()
            ? ms.model.trim()
            : undefined;
        if (ms.provider === 'gemini') {
          summarizer = new GeminiSummarizer(
            key,
            normalizeGeminiModelId(
              resolvedModel,
              MODEL_GEMINI_DEFAULT_LITE,
            ),
            tmpl,
          );
        } else if (ms.provider === 'claude') {
          summarizer = new ClaudeSummarizer(
            key,
            resolvedModel ?? MODEL_CLAUDE_4_5_HAIKU,
            tmpl,
          );
        } else if (ms.provider === 'openai-compatible') {
          summarizer = new OpenAISummarizer(
            key,
            resolvedModel ?? options.model ?? 'local-model',
            tmpl,
            { endpoint: ms.endpoint.trim() },
          );
        } else {
          summarizer = new OpenAISummarizer(
            key,
            resolvedModel ?? MODEL_GPT_4O_MINI,
            tmpl,
          );
        }
      } else if (providerName === 'openai-compatible') {
        const compatibleOpts = options.providerOptions as
          | { endpoint?: string }
          | undefined;
        const endpoint = compatibleOpts?.endpoint?.trim() ?? '';
        if (!endpoint) {
          throw new Error(
            'openai-compatible memory summarization requires providerOptions.endpoint',
          );
        }
        summarizer = new OpenAISummarizer(
          options.apiKey,
          options.model?.trim() || 'local-model',
          tmpl,
          { endpoint },
        );
      } else if (providerName === 'gemini') {
        summarizer = new GeminiSummarizer(
          options.apiKey,
          options.model,
          tmpl,
        );
      } else if (providerName === 'claude') {
        summarizer = new ClaudeSummarizer(
          options.apiKey,
          options.model,
          tmpl,
        );
      } else {
        summarizer = new OpenAISummarizer(
          options.apiKey,
          options.model,
          tmpl,
        );
      }

      this.memoryManager = new MemoryManager(
        options.memoryOptions,
        summarizer,
        options.memoryStorage,
      );
    }

    // Initialize ChatProcessor
    this.chatProcessor = new ChatProcessor(
      this.chatService,
      {
        ...options.chatOptions,
        useMemory: !!this.memoryManager,
      },
      this.memoryManager,
      this.handleToolUse.bind(this),
    );

    // Forward events
    this.setupEventForwarding();

    // Initialize VoiceService (optional)
    if (options.voiceOptions) {
      this.voiceService = new VoiceEngineAdapter(options.voiceOptions);
    }

    this.log('AITuberOnAirCore initialized');
  }

  private buildChatServiceOptions(
    providerName: ChatProviderName,
    baseOptions: {
      apiKey: string;
      model?: string;
      tools: ToolDefinition[];
    },
    providerOptions?: AITuberOnAirCoreOptions['providerOptions'],
  ): ChatServiceOptionsByProvider[ChatProviderName] {
    switch (providerName) {
      case 'openai': {
        return {
          ...baseOptions,
          ...(providerOptions as ProviderOptionsByName<'openai'> | undefined),
        } as OpenAIChatServiceOptions;
      }
      case 'openai-compatible': {
        return {
          ...baseOptions,
          ...(providerOptions as
            | ProviderOptionsByName<'openai-compatible'>
            | undefined),
        } as OpenAICompatibleChatServiceOptions;
      }
      case 'openrouter': {
        return {
          ...baseOptions,
          ...(providerOptions as
            | ProviderOptionsByName<'openrouter'>
            | undefined),
        } as OpenRouterChatServiceOptions;
      }
      case 'gemini': {
        return {
          ...baseOptions,
          ...(providerOptions as ProviderOptionsByName<'gemini'> | undefined),
        } as GeminiChatServiceOptions;
      }
      case 'gemini-nano': {
        const geminiNanoOptions = providerOptions as
          | ProviderOptionsByName<'gemini-nano'>
          | undefined;

        return {
          ...(baseOptions.model ? { model: baseOptions.model } : {}),
          ...geminiNanoOptions,
        } as GeminiNanoChatServiceOptions;
      }
      case 'claude': {
        return {
          ...baseOptions,
          ...(providerOptions as ProviderOptionsByName<'claude'> | undefined),
        } as ClaudeChatServiceOptions;
      }
      case 'zai': {
        return {
          ...baseOptions,
          ...(providerOptions as ProviderOptionsByName<'zai'> | undefined),
        } as ZAIChatServiceOptions;
      }
      case 'kimi': {
        return {
          ...baseOptions,
          ...(providerOptions as ProviderOptionsByName<'kimi'> | undefined),
        } as KimiChatServiceOptions;
      }
      case 'xai': {
        return {
          ...baseOptions,
          ...(providerOptions as ProviderOptionsByName<'xai'> | undefined),
        } as XAIChatServiceOptions;
      }
      default:
        return baseOptions as ChatServiceOptionsByProvider['openai'];
    }
  }

  /**
   * Process text chat
   * @param text User input text
   * @returns Success or failure of processing
   */
  async processChat(text: string): Promise<boolean> {
    return this.withProcessing(
      { text },
      async () => {
        await this.chatProcessor.processTextChat(text);
      },
      'Error in processChat:',
    );
  }

  /**
   * Process image-based chat
   * @param imageDataUrl Image data URL
   * @param visionPrompt Custom prompt for describing the image (optional)
   * @returns Success or failure of processing
   */
  async processVisionChat(
    imageDataUrl: string,
    visionPrompt?: string,
  ): Promise<boolean> {
    return this.withProcessing(
      { type: 'vision' },
      async () => {
        // Update vision prompt if provided
        if (visionPrompt) {
          this.chatProcessor.updateOptions({ visionPrompt });
        }

        // Process image in ChatProcessor
        await this.chatProcessor.processVisionChat(imageDataUrl);
      },
      'Error in processVisionChat:',
    );
  }

  /**
   * True while a chat or vision request is running inside the internal
   * processing guard (text chat or vision API call in progress).
   */
  isChatBusy(): boolean {
    return this.isProcessing;
  }

  private async withProcessing(
    startPayload: Record<string, unknown>,
    action: () => Promise<void>,
    errorMessage: string,
  ): Promise<boolean> {
    if (this.isProcessing) {
      this.log('Already processing another chat');
      return false;
    }

    try {
      this.isProcessing = true;
      this.emit(AITuberOnAirCoreEvent.PROCESSING_START, startPayload);
      await action();
      return true;
    } catch (error) {
      this.log(errorMessage, error);
      this.emit(AITuberOnAirCoreEvent.ERROR, error);
      return false;
    } finally {
      this.isProcessing = false;
      this.emit(AITuberOnAirCoreEvent.PROCESSING_END);
    }
  }

  /**
   * Stop speech playback
   */
  stopSpeech(): void {
    if (this.voiceService) {
      this.voiceService.stop();
      this.emit(AITuberOnAirCoreEvent.SPEECH_END);
    }
  }

  /**
   * Get chat history
   */
  getChatHistory(): (Message | MessageWithVision)[] {
    return this.chatProcessor.getChatLog();
  }

  /**
   * Set chat history from external source
   * @param messages Message array to set as chat history
   */
  setChatHistory(messages: (Message | MessageWithVision)[]): void {
    this.chatProcessor.setChatLog(messages);
    this.emit(AITuberOnAirCoreEvent.CHAT_HISTORY_SET, messages);
  }

  /**
   * Clear chat history
   */
  clearChatHistory(): void {
    this.chatProcessor.clearChatLog();
    this.emit(AITuberOnAirCoreEvent.CHAT_HISTORY_CLEARED);
    if (this.memoryManager) {
      this.memoryManager.clearAllMemories();
    }
  }

  /**
   * Update voice service
   * @param options New voice service options
   */
  updateVoiceService(options: VoiceServiceOptions): void {
    if (this.voiceService) {
      if (this.voiceService.switchEngine) {
        this.voiceService.switchEngine(options);
      } else {
        this.voiceService.updateOptions(options);
      }
    } else {
      this.voiceService = new VoiceEngineAdapter(options);
    }
  }

  /**
   * Update speech chunking behaviour
   */
  updateSpeechChunking(options: SpeechChunkingOptions): void {
    if (options.enabled !== undefined) {
      this.speechChunkEnabled = options.enabled;
    }
    if (options.minWords !== undefined) {
      this.speechChunkMinWords = Math.max(0, options.minWords);
    }
    if (options.locale) {
      this.speechChunkLocale = options.locale;
    }
    if ('separators' in options) {
      this.speechChunkSeparators = options.separators;
    }
    if (options.maxCharsPerChunk !== undefined) {
      this.speechChunkMaxChars = Math.max(0, options.maxCharsPerChunk);
    }
  }

  /**
   * Speak text with custom voice options
   * @param text Text to speak
   * @param options Speech options
   * @returns Promise that resolves when speech is complete
   */
  async speakTextWithOptions(
    text: string,
    options?: {
      enableAnimation?: boolean;
      temporaryVoiceOptions?: VoiceServiceOptionsUpdate;
      audioElementId?: string;
    },
  ): Promise<void> {
    if (!this.voiceService) {
      this.log('Voice service is not initialized');
      return;
    }

    this.log(`Speaking text with options: ${JSON.stringify(options)}`);

    // Store the original voice options
    let originalVoiceOptions: VoiceServiceOptionsUpdate | undefined;
    let temporaryVoiceOptionKeys: string[] | undefined;

    try {
      // Apply temporary voice options if provided
      if (options?.temporaryVoiceOptions) {
        const currentOptions =
          this.voiceService.getOptions() as unknown as Record<string, unknown>;

        const temporaryVoiceOptionsRecord =
          options.temporaryVoiceOptions as Record<string, unknown>;

        // Save only the keys being overridden for restoration
        originalVoiceOptions = Object.fromEntries(
          Object.keys(temporaryVoiceOptionsRecord).map((key) => [
            key,
            currentOptions[key],
          ]),
        ) as VoiceServiceOptionsUpdate;

        // Track which keys are newly introduced so we can remove them later
        temporaryVoiceOptionKeys = Object.keys(
          temporaryVoiceOptionsRecord,
        ).filter((key) => !(key in currentOptions));

        this.voiceService.updateOptions(options.temporaryVoiceOptions);
      }

      // Set up audio options
      const audioOptions: AudioPlayOptions = {
        enableAnimation: options?.enableAnimation,
        audioElementId: options?.audioElementId,
      };

      const screenplay = textToScreenplay(text);

      // generate raw text(text with emotion tags)
      const rawText = screenplayToText(screenplay);

      // pass screenplay object as event data
      this.emit(AITuberOnAirCoreEvent.SPEECH_START, { screenplay, rawText });

      // Play the audio
      await this.voiceService.speakText(rawText, audioOptions);

      // Speech end event
      this.emit(AITuberOnAirCoreEvent.SPEECH_END);
    } catch (error) {
      this.log('Error in speakTextWithOptions:', error);
      this.emit(AITuberOnAirCoreEvent.ERROR, error);
    } finally {
      // Restore original options if they were changed
      if (this.voiceService) {
        const resetOptions: VoiceServiceOptionsUpdate = {
          ...(originalVoiceOptions ?? {}),
        };

        if (temporaryVoiceOptionKeys) {
          for (const key of temporaryVoiceOptionKeys) {
            (resetOptions as Record<string, unknown>)[key] = undefined;
          }
        }

        this.voiceService.updateOptions(resetOptions);
      }
    }
  }

  /**
   * Setup forwarding of ChatProcessor events
   */
  private setupEventForwarding(): void {
    this.chatProcessor.on('processingStart', (data) => {
      this.emit(AITuberOnAirCoreEvent.PROCESSING_START, data);
    });

    this.chatProcessor.on('processingEnd', () => {
      this.emit(AITuberOnAirCoreEvent.PROCESSING_END);
    });

    this.chatProcessor.on('assistantPartialResponse', (text) => {
      this.emit(AITuberOnAirCoreEvent.ASSISTANT_PARTIAL, text);
    });

    this.chatProcessor.on('assistantResponse', async (data) => {
      const { message, screenplay, ...metadata } = data;

      // Generate the raw text with emotion tags using utility function
      const rawText = screenplayToText(screenplay);

      // Fire assistant response event
      this.emit(AITuberOnAirCoreEvent.ASSISTANT_RESPONSE, {
        message,
        screenplay,
        rawText,
        ...metadata,
      });

      // Speech synthesis and playback (if VoiceService exists)
      if (this.voiceService) {
        try {
          this.emit(AITuberOnAirCoreEvent.SPEECH_START, screenplay);

          const chunks = this.splitTextForSpeech(screenplay.text).filter(
            (chunk) => chunk,
          );
          const emotion = screenplay.emotion;

          // 全チャンクを先にキューへ入れる。1つずつ await すると次の speak が
          // 再生後まで来ず、VoiceEngineAdapter の「再生中プリフェッチ」が動かない。
          const speakOneChunk = async (
            chunkText: string,
            label: string,
          ): Promise<boolean> => {
            const chunkScreenplay = emotion
              ? { emotion, text: chunkText }
              : { text: chunkText };
            try {
              await this.voiceService!.speak(chunkScreenplay, {
                enableAnimation: true,
              });
              return true;
            } catch (chunkError) {
              console.warn(
                `[AITuberOnAirCore] TTS skipped ${label}:`,
                chunkError,
              );
              if (
                chunkText.length <= 40 ||
                !isVoicePeakCliCrashError(chunkError)
              ) {
                return false;
              }
              const parts = bisectSpeechChunk(chunkText);
              if (!parts) {
                return false;
              }
              console.info(
                `[AITuberOnAirCore] Retrying VoicePeak chunk in 2 parts (${chunkText.length} chars)`,
              );
              let ok = false;
              for (let p = 0; p < parts.length; p += 1) {
                if (
                  await speakOneChunk(parts[p]!, `${label} part ${p + 1}/2`)
                ) {
                  ok = true;
                }
              }
              return ok;
            }
          };

          const speakResults = await Promise.allSettled(
            chunks.map((chunk, i) =>
              speakOneChunk(chunk, `chunk ${i + 1}/${chunks.length}`),
            ),
          );
          let spoken = speakResults.filter((r) => r.status === 'fulfilled' && r.value === true).length;

          if (spoken === 0 && chunks.length > 0) {
            throw new Error(
              'All TTS chunks failed (VoicePeak may have crashed on long text).',
            );
          }

          this.emit(AITuberOnAirCoreEvent.SPEECH_END);
        } catch (error) {
          // 吹き出しは ASSISTANT_RESPONSE 済み。読み上げ失敗だけで ERROR にしない（UI が異常に見えやすい）
          console.warn('[AITuberOnAirCore] Speech synthesis failed:', error);
          this.emit(AITuberOnAirCoreEvent.SPEECH_END);
        }
      }
    });

    this.chatProcessor.on('assistantResponseTruncated', (data) => {
      const { message, screenplay, ...metadata } = data;
      const rawText = screenplayToText(screenplay);
      this.emit(AITuberOnAirCoreEvent.ASSISTANT_RESPONSE_TRUNCATED, {
        message,
        screenplay,
        rawText,
        ...metadata,
      });
    });

    this.chatProcessor.on('error', (error) => {
      this.emit(AITuberOnAirCoreEvent.ERROR, error);
    });

    if (this.memoryManager) {
      this.memoryManager.on('error', (error) => {
        this.emit(AITuberOnAirCoreEvent.ERROR, error);
      });
    }
  }

  /**
   * Handle tool use
   * @param blocks Tool use blocks
   * @returns Tool result blocks
   */
  private async handleToolUse(
    blocks: ToolUseBlock[],
  ): Promise<ToolResultBlock[]> {
    this.emit(AITuberOnAirCoreEvent.TOOL_USE, blocks);

    const results = await this.toolExecutor.run(blocks);

    this.emit(AITuberOnAirCoreEvent.TOOL_RESULT, results);
    return results;
  }

  /**
   * Split screenplay text into smaller chunks for sequential speech synthesis.
   * Falls back to the original text when no delimiters are present.
   */
  private splitTextForSpeech(text?: string): string[] {
    const normalized = sanitizeSpeechText(text ?? '');
    if (!normalized) {
      return [];
    }

    if (!this.speechChunkEnabled) {
      return [normalized];
    }

    const activeSeparators = this.getActiveSpeechSeparators();
    const baseChunks = this.segmentTextBySeparators(
      normalized,
      activeSeparators,
    );

    if (baseChunks.length === 0) {
      return [normalized];
    }

    if (this.speechChunkMaxChars > 0) {
      const packed = this.mergeChunksUpToMaxChars(
        baseChunks,
        this.speechChunkMaxChars,
      );
      return this.splitChunksByMaxChars(packed, this.speechChunkMaxChars);
    }

    const minWords = this.speechChunkMinWords;
    if (minWords <= 1) {
      return baseChunks;
    }

    const merged: string[] = [];
    let buffer = '';

    const pushBuffer = () => {
      const trimmed = buffer.trim();
      if (trimmed.length > 0) {
        merged.push(trimmed);
      }
      buffer = '';
    };

    baseChunks.forEach((chunk, index) => {
      if (!buffer) {
        if (this.countApproxWords(chunk) >= minWords) {
          merged.push(chunk);
        } else {
          buffer = chunk;
        }
        return;
      }

      const candidate = `${buffer}${chunk}`;
      if (
        this.countApproxWords(candidate) >= minWords ||
        index === baseChunks.length - 1
      ) {
        buffer = candidate;
        pushBuffer();
      } else {
        buffer = candidate;
      }
    });

    pushBuffer();

    return merged.length > 0 ? merged : [normalized];
  }

  /**
   * 句読点単位の塊を、maxChars を超えない範囲でできるだけ結合する（短い文の連打を防ぐ）。
   */
  private mergeChunksUpToMaxChars(chunks: string[], maxChars: number): string[] {
    const merged: string[] = [];
    let buffer = '';

    const flush = () => {
      const trimmed = buffer.trim();
      if (trimmed.length > 0) {
        merged.push(trimmed);
      }
      buffer = '';
    };

    for (const chunk of chunks) {
      const part = chunk.trim();
      if (!part) {
        continue;
      }

      if (!buffer) {
        if (part.length > maxChars) {
          merged.push(part);
        } else {
          buffer = part;
        }
        continue;
      }

      const candidate = `${buffer}${part}`;
      if (candidate.length <= maxChars) {
        buffer = candidate;
      } else {
        flush();
        if (part.length > maxChars) {
          merged.push(part);
        } else {
          buffer = part;
        }
      }
    }

    flush();
    return merged.length > 0 ? merged : chunks;
  }

  /** 1 塊が上限を超えるときだけ、句点優先で分割 */
  private splitChunksByMaxChars(chunks: string[], maxChars: number): string[] {
    const out: string[] = [];
    for (const chunk of chunks) {
      let rest = chunk.trim();
      if (!rest) continue;
      while (rest.length > maxChars) {
        const slice = rest.slice(0, maxChars);
        let cut = maxChars;
        const punctAt = Math.max(
          slice.lastIndexOf('。'),
          slice.lastIndexOf('！'),
          slice.lastIndexOf('？'),
          slice.lastIndexOf('\n'),
        );
        if (punctAt >= Math.floor(maxChars * 0.35)) {
          cut = punctAt + 1;
        } else {
          const spaceAt = slice.lastIndexOf(' ');
          if (spaceAt >= Math.floor(maxChars * 0.35)) {
            cut = spaceAt + 1;
          }
        }
        const piece = rest.slice(0, cut).trim();
        if (piece) out.push(piece);
        rest = rest.slice(cut).trim();
      }
      if (rest) out.push(rest);
    }
    return out.length > 0 ? out : chunks;
  }

  private getActiveSpeechSeparators(): string[] {
    const baseSeparators =
      this.speechChunkSeparators && this.speechChunkSeparators.length > 0
        ? this.speechChunkSeparators
        : SPEECH_CHUNK_SEPARATOR_PRESETS[this.speechChunkLocale] ||
          FALLBACK_SEPARATORS;

    const unique = new Set<string>();
    [...baseSeparators, ...ALWAYS_SPLIT_CHARACTERS].forEach((char) => {
      if (char && char.length > 0) {
        unique.add(char);
      }
    });
    return Array.from(unique);
  }

  private segmentTextBySeparators(
    text: string,
    separators: string[],
  ): string[] {
    if (separators.length === 0) {
      return [text];
    }

    const separatorSet = new Set(separators);
    const chunks: string[] = [];
    let buffer = '';

    for (const char of text) {
      buffer += char;
      if (separatorSet.has(char)) {
        const trimmed = buffer.trim();
        if (trimmed.length > 0) {
          chunks.push(trimmed);
        }
        buffer = '';
      }
    }

    const tail = buffer.trim();
    if (tail.length > 0) {
      chunks.push(tail);
    }

    return chunks.length > 0 ? chunks : [text];
  }

  private countApproxWords(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) {
      return 0;
    }

    const spaceSeparated = trimmed.split(/\s+/u).filter(Boolean);
    if (spaceSeparated.length > 1) {
      return spaceSeparated.length;
    }

    return trimmed.length;
  }

  /**
   * Output debug log (only in debug mode)
   */
  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[AITuberOnAirCore]', ...args);
    }
  }

  /**
   * Generate new content based on the system prompt and the provided message history (one-shot).
   * The provided message history is used only for this generation and does not affect the internal chat history.
   * This is ideal for generating standalone content like blog posts, reports, or summaries from existing conversations.
   *
   * @param prompt The system prompt to guide the content generation
   * @param messageHistory The message history to use as context
   * @returns The generated content as a string
   */
  async generateOneShotContentFromHistory(
    prompt: string,
    messageHistory: Message[],
  ): Promise<string> {
    const messages: Message[] = [{ role: 'system', content: prompt }];
    messages.push(...messageHistory);

    const result = await this.chatService.chatOnce(messages, false, () => {});
    return result.blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  /**
   * Check if memory functionality is enabled
   */
  isMemoryEnabled(): boolean {
    return !!this.memoryManager;
  }

  /**
   * Remove all event listeners
   */
  offAll(): void {
    this.removeAllListeners();
  }

  /**
   * Get current provider information
   * @returns Provider information object
   */
  getProviderInfo(): { name: string; model?: string } {
    return {
      name: this.chatService.provider || 'unknown',
      model: this.chatService.getModel(),
    };
  }

  /**
   * Get list of available providers
   * @returns Array of available provider names
   */
  static getAvailableProviders(): string[] {
    return ChatServiceFactory.getAvailableProviders();
  }

  /**
   * Get list of models supported by the specified provider
   * @param providerName Provider name
   * @returns Array of supported models
   */
  static getSupportedModels(providerName: string): string[] {
    return ChatServiceFactory.getSupportedModels(providerName);
  }
}
