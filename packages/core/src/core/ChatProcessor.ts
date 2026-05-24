import {
  ChatService,
  Message,
  MessageWithVision,
  ChatType,
  ChatResponseLength,
  MAX_TOKENS_BY_LENGTH,
  ToolUseBlock,
  ToolResultBlock,
  ToolChatCompletion,
  ToolChatBlock,
  DEFAULT_VISION_PROMPT,
  textsToScreenplay,
  GEMMA_4_INPUT_TOKEN_BUDGET,
  GEMMA_4_USER_MESSAGE_MAX_CHARS,
  isGemma4ModelId,
  truncateTextForGemma4UserTurn,
  isJikkyoBoardUserMessage,
  estimateMessagesTokens,
  shouldStripPriorVisionImages,
  stripPriorVisionImagesFromMessages,
  stripImageBlocksToTextPlaceholder,
  messageHasImageBlock,
} from '@aituber-onair/chat';
import { MemoryManager } from './MemoryManager';
import { EventEmitter } from './EventEmitter';

type ToolCallback = (blocks: ToolUseBlock[]) => Promise<ToolResultBlock[]>;
/**
 * ChatProcessor options
 */
export interface ChatProcessorOptions {
  /** System prompt */
  systemPrompt: string;
  /** System prompt for vision mode */
  visionSystemPrompt?: string;
  /** Vision prompt for describing the image */
  visionPrompt?: string;
  /** Whether to summarize memory during processing */
  useMemory: boolean;
  /** Memory note (instructions for AI) */
  memoryNote?: string;
  /** Maximum number of tool call iterations allowed (default: 6) */
  maxHops?: number;
  /** Maximum tokens for chat responses (takes precedence over responseLength) */
  maxTokens?: number;
  /** Response length preset for chat (used if maxTokens is not specified) */
  responseLength?: ChatResponseLength;
  /** Maximum tokens for vision responses (takes precedence over visionResponseLength) */
  visionMaxTokens?: number;
  /** Response length preset for vision (used if visionMaxTokens is not specified) */
  visionResponseLength?: ChatResponseLength;
  /** 現行チャットモデル id（Gemma 4 時の掲示板間引きに使用） */
  chatModelId?: string;
  /** 掲示板 AI 送信ヘッダ（例: 掲示板：） */
  jikkyoAiHeaderPrefix?: string;
  /** Gemma 4 入力トークン上限の目安 */
  gemma4InputTokenBudget?: number;
  /**
   * Vision API リクエストに含める画像付きターン数（ローカル LLM 向け）。
   * 既定 1。openai-compatible / Gemma 4 では古い画像はプレースホルダに置換。
   */
  visionHistoryImageKeepCount?: number;
}

/**
 * Core logic for chat processing
 * Combines ChatService and MemoryManager to execute
 * AITuber's main processing (text chat, vision chat)
 */
export class ChatProcessor extends EventEmitter {
  private chatService: ChatService;
  private memoryManager?: MemoryManager;
  private options: ChatProcessorOptions;
  private chatLog: (Message | MessageWithVision)[] = [];
  private chatStartTime: number = 0;
  private processingChat: boolean = false;
  private toolCallback?: ToolCallback;
  private maxHops: number;

  /**
   * Constructor
   * @param chatService Chat service
   * @param options Configuration options
   * @param memoryManager Memory manager (optional)
   */
  constructor(
    chatService: ChatService,
    options: ChatProcessorOptions,
    memoryManager?: MemoryManager,
    toolCallback?: ToolCallback,
  ) {
    super();
    this.chatService = chatService;
    this.options = options;
    this.memoryManager = memoryManager;
    this.toolCallback = toolCallback;

    // Initialize maxHops from options with default value of 6
    this.maxHops = options.maxHops ?? 6;
  }

  /**
   * Add message to chat log
   * @param message Message to add
   */
  addToChatLog(message: Message | MessageWithVision): void {
    this.chatLog.push(message);
    this.emit('chatLogUpdated', this.chatLog);
  }

  /**
   * Get chat log
   */
  getChatLog(): (Message | MessageWithVision)[] {
    return [...this.chatLog];
  }

  /**
   * Clear chat log
   */
  clearChatLog(): void {
    this.chatLog = [];
    this.emit('chatLogUpdated', this.chatLog);
  }

  /**
   * Set chat start time
   * @param time Timestamp
   */
  setChatStartTime(time: number): void {
    this.chatStartTime = time;
  }

  /**
   * Get chat start time
   */
  getChatStartTime(): number {
    return this.chatStartTime;
  }

  /**
   * Get processing status
   */
  isProcessing(): boolean {
    return this.processingChat;
  }

  /**
   * Update options
   * @param newOptions New options to merge with existing ones
   */
  updateOptions(newOptions: Partial<ChatProcessorOptions>): void {
    this.options = { ...this.options, ...newOptions };

    // Update maxHops if maxHops is included in the new options
    if (newOptions.maxHops !== undefined) {
      this.maxHops = newOptions.maxHops;
    }
  }

  /**
   * Process text chat
   * @param text User input text
   * @param chatType Chat type
   */
  async processTextChat(
    text: string,
    chatType: ChatType = 'chatForm',
  ): Promise<void> {
    if (this.processingChat) {
      console.warn('Another chat processing is in progress');
      return;
    }

    try {
      this.processingChat = true;
      this.emit('processingStart', { type: chatType, text });

      // Set chat start time (if first message)
      if (this.chatStartTime === 0) {
        this.chatStartTime = Date.now();
      }

      let userContent = text;
      if (isGemma4ModelId(this.options.chatModelId)) {
        const capped = truncateTextForGemma4UserTurn(
          text,
          GEMMA_4_USER_MESSAGE_MAX_CHARS,
        );
        if (capped.length < text.trim().length) {
          console.info(
            `[ChatProcessor] Gemma 4: user message truncated ${text.trim().length} -> ${capped.length} chars`,
          );
        }
        userContent = capped;
      }

      const userMessage: Message = {
        role: 'user',
        content: userContent,
        timestamp: Date.now(),
      };

      // Add to chat log
      this.addToChatLog(userMessage);

      // Create memory (if needed)
      if (this.options.useMemory && this.memoryManager) {
        await this.memoryManager.createMemoryIfNeeded(
          this.chatLog,
          this.chatStartTime,
        );
      }

      this.trimChatLogForGemma4ContextIfNeeded();

      const initialMsgs = await this.prepareMessagesForAI();

      // Only pass explicit maxTokens.
      // Provider-specific responseLength handling should stay in the provider.
      const maxTokens = this.getExplicitMaxTokensForChat();
      await this.runToolLoop<Message | MessageWithVision>(
        initialMsgs,
        (msgs, stream, cb) =>
          this.chatService.chatOnce(msgs as Message[], stream, cb, maxTokens),
      );
    } catch (error) {
      console.error('Error in text chat processing:', error);
      this.emit('error', error);
    } finally {
      this.processingChat = false;
      this.emit('processingEnd');
    }
  }

  /**
   * Process vision chat
   * @param imageDataUrl Image data URL
   */
  async processVisionChat(imageDataUrl: string): Promise<void> {
    if (this.processingChat) {
      console.warn('Another chat processing is in progress');
      return;
    }

    try {
      this.processingChat = true;
      this.emit('processingStart', { type: 'vision', imageUrl: imageDataUrl });

      // Set chat start time (if first message)
      if (this.chatStartTime === 0) {
        this.chatStartTime = Date.now();
      }

      // Create vision message (same shape as the API request user turn)
      const visionMessage: MessageWithVision = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: this.options.visionPrompt || DEFAULT_VISION_PROMPT,
          },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl,
            },
          },
        ],
      };

      // Persist like text chat so later turns (and multimodal models like Gemini)
      // receive full conversation context including prior image inputs.
      this.addToChatLog(visionMessage);

      // Create memory (if needed)
      if (this.options.useMemory && this.memoryManager) {
        await this.memoryManager.createMemoryIfNeeded(
          this.chatLog,
          this.chatStartTime,
        );
      }

      this.trimChatLogForGemma4ContextIfNeeded();

      let baseMessages = await this.prepareMessagesForAI();

      // Keep vision-specific system instructions immediately before this image turn
      if (this.options.visionSystemPrompt) {
        baseMessages.splice(baseMessages.length - 1, 0, {
          role: 'system',
          content: this.options.visionSystemPrompt,
        });
      }

      // Only pass explicit maxTokens.
      // Provider-specific responseLength handling should stay in the provider.
      const maxTokens = this.getExplicitMaxTokensForVision();
      await this.runToolLoop<Message | MessageWithVision>(
        baseMessages,
        (msgs, _stream, cb) =>
          this.chatService.visionChatOnce(
            msgs as MessageWithVision[],
            false,
            cb,
            maxTokens,
          ),
        imageDataUrl, // visionSource
      );
    } catch (error) {
      console.error('Error in vision chat processing:', error);
      this.emit('error', error);
    } finally {
      this.processingChat = false;
      this.emit('processingEnd');
    }
  }

  /**
   * Gemma 4: プロンプト＋履歴が上限を超える場合、古い掲示板コメントを chatLog から削除。
   */
  private findLongestUserMessageIndex(): number {
    let bestIdx = -1;
    let bestLen = 0;
    for (let i = 0; i < this.chatLog.length; i += 1) {
      const m = this.chatLog[i];
      if (!m || m.role !== 'user' || typeof m.content !== 'string') {
        continue;
      }
      const len = m.content.length;
      if (len > bestLen) {
        bestLen = len;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  private trimChatLogForGemma4ContextIfNeeded(): void {
    const modelId = this.options.chatModelId ?? '';
    if (!isGemma4ModelId(modelId)) {
      return;
    }

    const headerPrefix =
      (this.options.jikkyoAiHeaderPrefix ?? '掲示板：').trim() || '掲示板：';
    const maxTokens =
      this.options.gemma4InputTokenBudget ?? GEMMA_4_INPUT_TOKEN_BUDGET;

    const preamble = this.buildPromptPreambleMessages();
    const combined = [
      ...preamble,
      ...this.chatLog.filter(
        (m) =>
          !(typeof m.content === 'string' && m.content.trim() === '') &&
          !(Array.isArray(m.content) && m.content.length === 0),
      ),
    ];

    const beforeTokens = estimateMessagesTokens(combined);
    if (beforeTokens <= maxTokens) {
      return;
    }

    let removedJikkyo = 0;
    let strippedImages = 0;
    let removedMessages = 0;
    const minPreserveMessages = 4;

    while (estimateMessagesTokens([...preamble, ...this.chatLog]) > maxTokens) {
      const jikkyoIdx = this.chatLog.findIndex((m) =>
        isJikkyoBoardUserMessage(m, headerPrefix),
      );
      if (jikkyoIdx >= 0) {
        this.chatLog.splice(jikkyoIdx, 1);
        removedJikkyo += 1;
        continue;
      }

      const imageIdx = this.chatLog.findIndex((m) => messageHasImageBlock(m));
      if (imageIdx >= 0) {
        this.chatLog[imageIdx] = stripImageBlocksToTextPlaceholder(
          this.chatLog[imageIdx]!,
        );
        strippedImages += 1;
        continue;
      }

      const longUserIdx = this.findLongestUserMessageIndex();
      if (longUserIdx >= 0) {
        const m = this.chatLog[longUserIdx]!;
        if (typeof m.content === 'string' && m.content.length > 400) {
          const before = m.content.length;
          m.content = truncateTextForGemma4UserTurn(m.content, 400);
          console.info(
            `[ChatProcessor] Gemma 4: trimmed long user message in log ${before} -> ${m.content.length} chars`,
          );
          continue;
        }
      }

      if (this.chatLog.length <= minPreserveMessages) {
        break;
      }
      this.chatLog.shift();
      removedMessages += 1;
    }

    const afterTokens = estimateMessagesTokens([...preamble, ...this.chatLog]);
    const didTrim =
      removedJikkyo > 0 || strippedImages > 0 || removedMessages > 0;

    if (didTrim) {
      console.info(
        `[ChatProcessor] Gemma 4 context trim: jikkyo -${removedJikkyo}, ` +
          `images stripped ${strippedImages}, other -${removedMessages}; ` +
          `~${beforeTokens} -> ~${afterTokens} tokens (budget ${maxTokens})`,
      );
      this.emit('chatLogUpdated', this.chatLog);
    }

    if (afterTokens > maxTokens) {
      console.warn(
        `[ChatProcessor] Gemma 4 context still over budget after trim ` +
          `(~${afterTokens} > ${maxTokens}). Model may return empty text; ` +
          `clear chat history or lower vision frequency.`,
      );
    }
  }

  private buildPromptPreambleMessages(): Message[] {
    const messages: Message[] = [];
    if (this.options.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.options.systemPrompt,
      });
    }
    if (this.options.useMemory && this.memoryManager) {
      const memoryText = this.memoryManager.getMemoryForPrompt();
      if (memoryText) {
        const memoryContent =
          memoryText +
          (this.options.memoryNote ? `\n\n${this.options.memoryNote}` : '');
        messages.push({
          role: 'system',
          content: memoryContent,
        });
      }
    }
    return messages;
  }

  /**
   * Prepare messages to send to AI
   * Create an array of messages with system prompt and memory
   */
  private async prepareMessagesForAI(): Promise<(Message | MessageWithVision)[]> {
    const messages: (Message | MessageWithVision)[] = [
      ...this.buildPromptPreambleMessages(),
    ];

    // Add chat log
    messages.push(
      ...this.chatLog.filter(
        (m) =>
          !(typeof m.content === 'string' && m.content.trim() === '') &&
          !(Array.isArray(m.content) && m.content.length === 0),
      ),
    );

    if (
      shouldStripPriorVisionImages(
        this.chatService.provider,
        this.options.chatModelId,
      )
    ) {
      const keep = this.options.visionHistoryImageKeepCount ?? 1;
      const before = messages.filter((m) => messageHasImageBlock(m)).length;
      const trimmed = stripPriorVisionImagesFromMessages(messages, keep);
      const after = trimmed.filter((m) => messageHasImageBlock(m)).length;
      if (before > after) {
        console.info(
          `[ChatProcessor] Vision request trim: ${before} -> ${after} image turn(s) in API payload (keep ${keep})`,
        );
      }
      return trimmed;
    }

    return messages;
  }

  /**
   * Set chat log from external source
   * @param messages Message array to set as chat log
   */
  setChatLog(messages: (Message | MessageWithVision)[]): void {
    this.chatLog = Array.isArray(messages) ? [...messages] : [];
    this.emit('chatLogUpdated', this.chatLog);
  }

  /**
   * Get max tokens for chat responses
   * @returns Maximum tokens for chat
   */
  private getExplicitMaxTokensForChat(): number | undefined {
    return this.options.maxTokens;
  }

  /**
   * Get max tokens for vision responses
   * @returns Maximum tokens for vision
   */
  private getExplicitMaxTokensForVision(): number | undefined {
    if (this.options.visionMaxTokens !== undefined) {
      return this.options.visionMaxTokens;
    }

    if (this.options.visionResponseLength !== undefined) {
      return MAX_TOKENS_BY_LENGTH[this.options.visionResponseLength];
    }

    return this.getExplicitMaxTokensForChat();
  }

  private isClaudeProvider(): boolean {
    return this.chatService.provider === 'claude';
  }

  private getToolUseBlocks(blocks: ToolChatBlock[]): ToolUseBlock[] {
    return blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
  }

  private getToolResultBlocks(blocks: ToolChatBlock[]): ToolResultBlock[] {
    return blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
  }

  private isEmptyClaudeAssistantMessage(
    isClaude: boolean,
    message: Message | MessageWithVision,
  ): boolean {
    if (!isClaude || message.role !== 'assistant') {
      return false;
    }
    const content = (message as { content?: unknown }).content;
    return Array.isArray(content) && content.length === 0;
  }

  private buildAssistantToolCall(
    isClaude: boolean,
    toolUses: ToolUseBlock[],
  ): Message {
    if (isClaude) {
      return {
        role: 'assistant',
        content: toolUses.map((u) => ({
          type: 'tool_use',
          id: u.id,
          name: u.name,
          input: u.input ?? {},
        })),
      } as unknown as Message;
    }

    return {
      role: 'assistant',
      content: [],
      tool_calls: toolUses.map((u) => ({
        id: u.id,
        type: 'function',
        function: {
          name: u.name,
          arguments: JSON.stringify(u.input || {}),
        },
      })),
    } as unknown as Message;
  }

  private buildToolMessages(
    isClaude: boolean,
    toolResults: ToolResultBlock[],
  ): Message[] {
    if (isClaude) {
      return toolResults.map(
        (r) =>
          ({
            role: 'user',
            content: [
              {
                type: r.type,
                tool_use_id: r.tool_use_id,
                content: r.content,
              },
            ],
          }) as unknown as Message,
      );
    }

    return toolResults.map(
      (r) =>
        ({
          role: 'tool',
          tool_call_id: r.tool_use_id,
          content: r.content,
        }) as unknown as Message,
    );
  }

  private buildNextMessages(
    isClaude: boolean,
    currentMessages: (Message | MessageWithVision)[],
    assistantToolCall: Message,
    toolMessages: Message[],
  ): (Message | MessageWithVision)[] {
    const cleaned = currentMessages.filter(
      (m) => !this.isEmptyClaudeAssistantMessage(isClaude, m),
    );

    if (!this.isEmptyClaudeAssistantMessage(isClaude, assistantToolCall)) {
      cleaned.push(assistantToolCall);
    }
    toolMessages.forEach((m) => cleaned.push(m));
    return cleaned;
  }

  private async runToolLoop<T extends Message | MessageWithVision>(
    send: T[],
    once: (
      msgs: T[],
      stream: boolean,
      onPartial: (t: string) => void,
    ) => Promise<ToolChatCompletion>,
    visionSource?: string,
  ): Promise<void> {
    let toSend = send;
    let hops = 0;
    let first = true;

    // check if the chat service is claude
    const isClaude = this.isClaudeProvider();

    while (hops++ < this.maxHops) {
      const {
        blocks,
        stop_reason,
        truncated,
        finish_reason,
        response_status,
        incomplete_details,
        usage,
      } = await once(toSend, first, (t) =>
        this.emit('assistantPartialResponse', t),
      );
      first = false;

      this.getToolResultBlocks(blocks).forEach((b) =>
        this.emit('assistantPartialResponse', b.content),
      );

      if (stop_reason === 'end') {
        const full = blocks
          .map((b) =>
            b.type === 'text'
              ? b.text
              : b.type === 'tool_result'
                ? b.content
                : '',
          )
          .join('');

        const assistantMessage: Message = {
          role: 'assistant',
          content: full,
          timestamp: Date.now(),
        };
        this.addToChatLog(assistantMessage);

        const screenplay = textsToScreenplay([full])[0];
        const responsePayload = {
          message: assistantMessage,
          screenplay,
          visionSource,
          truncated: Boolean(truncated),
          finishReason: finish_reason,
          responseStatus: response_status,
          incompleteDetails: incomplete_details ?? null,
          usage,
        };

        if (responsePayload.truncated) {
          this.emit('assistantResponseTruncated', responsePayload);
        }

        this.emit('assistantResponse', responsePayload);

        if (this.memoryManager) this.memoryManager.cleanupOldMemories();
        return;
      }

      /* ---------- tool_use ---------- */
      if (!this.toolCallback) throw new Error('Tool callback missing');

      const toolUses = this.getToolUseBlocks(blocks);
      const toolResults = await this.toolCallback(toolUses);

      const assistantToolCall = this.buildAssistantToolCall(isClaude, toolUses);
      const toolMsgs = this.buildToolMessages(isClaude, toolResults);

      /* build messages for the next turn */
      const cleaned = this.buildNextMessages(
        isClaude,
        toSend as (Message | MessageWithVision)[],
        assistantToolCall,
        toolMsgs,
      );

      toSend = cleaned as T[];
    }

    // It is rare to reach this point. Just log it.
    console.warn('Tool loop exceeded MAX_HOPS');
  }
}
