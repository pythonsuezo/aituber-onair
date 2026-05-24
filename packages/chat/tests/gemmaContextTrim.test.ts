import { describe, expect, it } from 'vitest';
import {
  estimateMessageTokens,
  estimateTextTokens,
  isJikkyoBoardUserMessage,
  truncateTextForGemma4UserTurn,
  trimJikkyoMessagesForTokenBudget,
} from '../src/utils/gemmaContextTrim';

describe('gemmaContextTrim', () => {
  it('detects jikkyo header prefix', () => {
    expect(
      isJikkyoBoardUserMessage(
        { role: 'user', content: '掲示板：こんにちは' },
        '掲示板：',
      ),
    ).toBe(true);
    expect(
      isJikkyoBoardUserMessage({ role: 'user', content: '通常の発言' }, '掲示板：'),
    ).toBe(false);
  });

  it('truncates long user turns for Gemma 4', () => {
    const long = 'あ'.repeat(800);
    const out = truncateTextForGemma4UserTurn(long, 600);
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out).toContain('省略');
  });

  it('estimates vision image blocks with a large token cost', () => {
    const textOnly = estimateMessageTokens({
      role: 'user',
      content: '短い',
    });
    const withImage = estimateMessageTokens({
      role: 'user',
      content: [
        { type: 'text', text: '短い' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
      ],
    });
    expect(withImage).toBeGreaterThan(textOnly + 500);
  });

  it('drops oldest jikkyo messages when over budget', () => {
    const header = '掲示板：';
    const messages = [
      { role: 'system' as const, content: 'x'.repeat(2000) },
      { role: 'user' as const, content: `${header}古い` },
      { role: 'user' as const, content: `${header}新しい` },
      { role: 'user' as const, content: 'マイク発言' },
    ];
    const max = estimateTextTokens(messages[0]!.content) + 50;
    const { messages: trimmed, removedCount } = trimJikkyoMessagesForTokenBudget(
      messages,
      header,
      max,
    );
    expect(removedCount).toBeGreaterThan(0);
    expect(trimmed.some((m) => m.content === `${header}古い`)).toBe(false);
    expect(trimmed.some((m) => m.content === 'マイク発言')).toBe(true);
  });
});
