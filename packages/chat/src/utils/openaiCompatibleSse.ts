import { ToolChatBlock, ToolChatCompletion } from '../types';
import { StreamTextAccumulator } from './streamTextAccumulator';

type SseParseOptions = {
  onJsonError?: (payload: string, error: unknown) => void;
  appendTextBlock?: (blocks: ToolChatBlock[], text: string) => void;
};

/** OpenAI / llama.cpp: content が string または [{ type:'text', text }] の配列 */
function extractContentString(content: unknown): string {
  if (typeof content === 'string' && content.length > 0) {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string' && part.length > 0) {
      parts.push(part);
      continue;
    }
    if (!part || typeof part !== 'object') {
      continue;
    }
    const p = part as Record<string, unknown>;
    if (p.type === 'text' && typeof p.text === 'string' && p.text.length > 0) {
      parts.push(p.text);
    }
  }
  return parts.join('');
}

/** llama.cpp / LM Studio など delta 以外に本文が載る形式も拾う */
function extractStreamingTextFromChoice(choice: unknown): string {
  if (!choice || typeof choice !== 'object') {
    return '';
  }
  const c = choice as Record<string, unknown>;
  const delta = c.delta;
  if (delta && typeof delta === 'object') {
    const fromDelta = extractContentString(
      (delta as { content?: unknown }).content,
    );
    if (fromDelta) {
      return fromDelta;
    }
  }
  const message = c.message;
  if (message && typeof message === 'object') {
    const fromMessage = extractContentString(
      (message as { content?: unknown }).content,
    );
    if (fromMessage) {
      return fromMessage;
    }
  }
  if (typeof c.text === 'string' && c.text.length > 0) {
    return c.text;
  }
  return '';
}

/** Ollama / 一部 llama-server が choices 外に載せる本文 */
function extractStreamingTextFromRoot(json: unknown): string {
  if (!json || typeof json !== 'object') {
    return '';
  }
  const root = json as Record<string, unknown>;
  const choices = root.choices;
  const firstChoice =
    Array.isArray(choices) && choices.length > 0 ? choices[0] : undefined;
  const fromChoice = extractStreamingTextFromChoice(firstChoice);
  if (fromChoice) {
    return fromChoice;
  }
  if (root.message && typeof root.message === 'object') {
    const fromMessage = extractContentString(
      (root.message as { content?: unknown }).content,
    );
    if (fromMessage) {
      return fromMessage;
    }
  }
  if (typeof root.response === 'string' && root.response.length > 0) {
    return root.response;
  }
  const delta = root.delta;
  if (delta && typeof delta === 'object') {
    const fromDelta = extractContentString(
      (delta as { content?: unknown }).content,
    );
    if (fromDelta) {
      return fromDelta;
    }
  }
  return '';
}

const parseJsonPayload = (
  payload: string,
  onJsonError?: (payload: string, error: unknown) => void,
): any | undefined => {
  try {
    return JSON.parse(payload);
  } catch (error) {
    if (onJsonError) {
      onJsonError(payload, error);
      return undefined;
    }
    throw error;
  }
};

const forEachSsePayload = async (
  res: Response,
  onPayload: (payload: string) => void,
): Promise<void> => {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Response body is null.');
  }

  const dec = new TextDecoder();
  let buf = '';
  let shouldStop = false;

  while (!shouldStop) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith(':')) continue;
      if (!trimmedLine.startsWith('data:')) continue;

      const payload = trimmedLine.slice(5).trim();
      if (payload === '[DONE]') {
        shouldStop = true;
        break;
      }

      onPayload(payload);
    }
  }
};

export async function parseOpenAICompatibleTextStream(
  res: Response,
  onPartial: (text: string) => void,
  options: SseParseOptions = {},
): Promise<string> {
  let full = '';

  await forEachSsePayload(res, (payload) => {
    const json = parseJsonPayload(payload, options.onJsonError);
    if (!json) return;

    const content = extractStreamingTextFromRoot(json);
    if (content) {
      onPartial(content);
      full += content;
    }
  });

  return full;
}

export async function parseOpenAICompatibleToolStream(
  res: Response,
  onPartial: (text: string) => void,
  options: SseParseOptions = {},
): Promise<ToolChatCompletion> {
  const textBlocks: ToolChatBlock[] = [];
  const toolCallsMap = new Map<number, any>();
  let finishReason: string | undefined;
  let usage: Record<string, any> | undefined;
  const appendTextBlock =
    options.appendTextBlock ?? StreamTextAccumulator.append;

  await forEachSsePayload(res, (payload) => {
    const json = parseJsonPayload(payload, options.onJsonError);
    if (!json) return;

    const choice = json.choices?.[0];
    if (typeof choice?.finish_reason === 'string') {
      finishReason = choice.finish_reason;
    }
    if (json.usage) {
      usage = json.usage;
    }

    const streamedText = extractStreamingTextFromRoot(json);
    if (streamedText) {
      onPartial(streamedText);
      appendTextBlock(textBlocks, streamedText);
    }

    const delta = choice?.delta;
    if (delta?.tool_calls) {
      delta.tool_calls.forEach((c: any) => {
        const entry = toolCallsMap.get(c.index) ?? {
          id: c.id,
          name: c.function?.name,
          args: '',
        };
        entry.args += c.function?.arguments || '';
        toolCallsMap.set(c.index, entry);
      });
    }
  });

  const toolBlocks: ToolChatBlock[] = Array.from(toolCallsMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([_, e]) => ({
      type: 'tool_use',
      id: e.id,
      name: e.name,
      input: JSON.parse(e.args || '{}'),
    }));

  const blocks = [...textBlocks, ...toolBlocks];

  return {
    blocks,
    stop_reason: toolBlocks.length ? 'tool_use' : 'end',
    truncated: finishReason === 'length',
    finish_reason: finishReason,
    usage,
  };
}

export function parseOpenAICompatibleOneShot(data: any): ToolChatCompletion {
  const choice = data?.choices?.[0];
  const blocks: ToolChatBlock[] = [];

  if (choice?.message?.tool_calls?.length) {
    choice.message.tool_calls.forEach((c: any) =>
      blocks.push({
        type: 'tool_use',
        id: c.id,
        name: c.function?.name,
        input: JSON.parse(c.function?.arguments || '{}'),
      }),
    );
  } else {
    const text = extractContentString(choice?.message?.content);
    if (text) {
      blocks.push({ type: 'text', text });
    }
  }

  return {
    blocks,
    stop_reason:
      choice?.finish_reason === 'tool_calls' ||
      blocks.some((b) => b.type === 'tool_use')
        ? 'tool_use'
        : 'end',
    truncated: choice?.finish_reason === 'length',
    finish_reason: choice?.finish_reason,
    usage: data?.usage,
  };
}
