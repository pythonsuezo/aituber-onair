import type { Message, MessageWithVision } from '../types';

/** トークン見積もり・掲示板判定用（テキスト / ビジョン混在） */
export type MessageRoleContent = {
  role: Message['role'];
  content: Message['content'] | MessageWithVision['content'];
};

/** Gemma 4 系の入力コンテキスト上限（プロンプト＋履歴の目安・待ち行列用） */
export const GEMMA_4_INPUT_TOKEN_BUDGET = 4000;

/**
 * llama-server ctx 4096 向けの送信プロンプト予算（返答分を残す）。
 * useAituberCore の gemma4InputTokenBudget と揃える。
 */
export const GEMMA_4_DEFAULT_PROMPT_TOKEN_BUDGET = 2600;

/** 1 回の user 発話の最大文字数（掲示板の長文で ctx を食い潰さない） */
export const GEMMA_4_USER_MESSAGE_MAX_CHARS = 600;

const USER_TRUNC_SUFFIX = '…（長文のため省略）';

export function truncateTextForGemma4UserTurn(
  text: string,
  maxChars: number = GEMMA_4_USER_MESSAGE_MAX_CHARS,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  const keep = Math.max(32, maxChars - USER_TRUNC_SUFFIX.length);
  return `${trimmed.slice(0, keep)}${USER_TRUNC_SUFFIX}`;
}

const MESSAGE_OVERHEAD_TOKENS = 4;
/** 履歴内の base64 画像1枚あたりの見積もり（実際の VLM 投入はこれより大きい） */
const VISION_IMAGE_BLOCK_ESTIMATE_TOKENS = 768;

export function isGemma4ModelId(modelId: string | undefined): boolean {
  const m = (modelId ?? '').trim().replace(/^models\//, '');
  return /^gemma-4-/.test(m);
}

/**
 * 簡易トークン見積もり（日本語多め: 全角≈1、ASCII≈0.25）。
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let score = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0x2e7f) {
      score += 1;
    } else {
      score += 0.25;
    }
  }
  return Math.max(0, Math.ceil(score));
}

export function messageContentToPlainText(
  content: Message['content'] | MessageWithVision['content'],
): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'image_url') return '[画像]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function estimateVisionImageBlocksInMessage(
  content: Message['content'] | MessageWithVision['content'],
): number {
  if (!Array.isArray(content)) {
    return 0;
  }
  return content.filter((b) => b.type === 'image_url').length;
}

export function estimateMessageTokens(message: MessageRoleContent): number {
  const imageBlocks = estimateVisionImageBlocksInMessage(message.content);
  const textEstimate = estimateTextTokens(
    messageContentToPlainText(message.content),
  );
  const imageEstimate =
    imageBlocks > 0
      ? imageBlocks * VISION_IMAGE_BLOCK_ESTIMATE_TOKENS
      : 0;
  return MESSAGE_OVERHEAD_TOKENS + textEstimate + imageEstimate;
}

export function estimateMessagesTokens(messages: MessageRoleContent[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

export function isJikkyoBoardUserMessage(
  message: MessageRoleContent,
  headerPrefix: string,
): boolean {
  if (message.role !== 'user') {
    return false;
  }
  const prefix = headerPrefix.trim();
  if (!prefix) {
    return false;
  }
  const text = messageContentToPlainText(message.content).trim();
  return text.startsWith(prefix);
}

/**
 * 掲示板コメント（先頭一致）だけを古い順に削除し、トークン見積もりが上限以下になるまで間引く。
 * @returns 間引き後の配列（元配列は変更しない）
 */
export function trimJikkyoMessagesForTokenBudget<
  T extends MessageRoleContent,
>(
  messages: T[],
  headerPrefix: string,
  maxTokens: number,
  options?: {
    /** 掲示板以外は削除しない（true 推奨） */
    jikkyoOnly?: boolean;
  },
): { messages: T[]; removedCount: number; estimatedTokens: number } {
  const jikkyoOnly = options?.jikkyoOnly !== false;
  let working = [...messages];
  let removed = 0;

  const countTokens = () => estimateMessagesTokens(working);

  while (countTokens() > maxTokens) {
    const idx = working.findIndex((m) =>
      isJikkyoBoardUserMessage(m, headerPrefix),
    );
    if (idx < 0) {
      break;
    }
    if (jikkyoOnly && !isJikkyoBoardUserMessage(working[idx]!, headerPrefix)) {
      break;
    }
    working.splice(idx, 1);
    removed += 1;
  }

  return {
    messages: working,
    removedCount: removed,
    estimatedTokens: countTokens(),
  };
}

/**
 * 文字列キュー（掲示板待ち行列）を古い順に捨ててトークン上限内に収める。
 */
export function trimJikkyoStringQueueForTokenBudget(
  queue: string[],
  reservedTokens: number,
  maxTokens: number = GEMMA_4_INPUT_TOKEN_BUDGET,
): { queue: string[]; removedCount: number } {
  const next = [...queue];
  let removed = 0;
  const totalTokens = () =>
    reservedTokens +
    next.reduce((sum, line) => sum + estimateTextTokens(line), 0);

  while (next.length > 0 && totalTokens() > maxTokens) {
    next.shift();
    removed += 1;
  }

  return { queue: next, removedCount: removed };
}
