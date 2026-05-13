import { VOICEPEAK_API_URL } from '../constants/voiceEngine';
import {
  EmotionTypeForVoicepeak,
  Talk,
  TalkStyle,
  VoicepeakEmotionInput,
  VoicepeakEmotionWeights,
} from '../types/voice';
import { VoiceEngine } from './VoiceEngine';

const VOICEPEAK_EMOTION_KEYS: readonly EmotionTypeForVoicepeak[] = [
  'happy',
  'fun',
  'angry',
  'sad',
  'neutral',
  'surprised',
] as const;

/**
 * VoicePeak voice synthesis engine
 */
export class VoicePeakEngine implements VoiceEngine {
  private apiEndpoint: string = VOICEPEAK_API_URL;
  private emotionOverride?: VoicepeakEmotionInput;
  private speedOverride?: number;
  private pitchOverride?: number;
  private narratorEmotionMap?: Partial<
    Record<string, Partial<Record<TalkStyle, string>>>
  >;
  private narratorTagEmotionMap?: Partial<
    Record<string, Record<string, string>>
  >;

  async fetchAudio(input: Talk, speaker: string): Promise<ArrayBuffer> {
    const talk = input as Talk;
    const resolvedEmotionRaw = this.resolveVoicepeakEmotionForRequest(
      speaker,
      talk,
    );
    const resolvedEmotion = this.normalizeEmotionParam(resolvedEmotionRaw);
    const resolvedSpeed = this.speedOverride;
    const resolvedPitch = this.pitchOverride;

    const ttsQueryUrl = this.buildUrl('/audio_query', {
      speaker,
      text: talk.message,
      emotion: resolvedEmotion,
      speed: resolvedSpeed === undefined ? undefined : String(resolvedSpeed),
      pitch: resolvedPitch === undefined ? undefined : String(resolvedPitch),
    });

    const ttsQueryResponse = await fetch(ttsQueryUrl, { method: 'POST' });

    if (!ttsQueryResponse.ok) {
      const detail = await VoicePeakEngine.readFetchErrorDetail(ttsQueryResponse);
      throw new Error(`Failed to fetch TTS query. ${detail}`);
    }

    const ttsQueryBody = await ttsQueryResponse.text();
    let ttsQueryJson: Record<string, unknown>;
    try {
      ttsQueryJson = JSON.parse(ttsQueryBody) as Record<string, unknown>;
    } catch (parseErr) {
      const clipped =
        ttsQueryBody.length > 400
          ? `${ttsQueryBody.slice(0, 400)}…`
          : ttsQueryBody;
      throw new Error(
        `VoicePeak TTS: audio_query returned invalid JSON (status ${ttsQueryResponse.status}). Parse error: ${String(parseErr)}. Body (clipped): ${JSON.stringify(clipped)}`,
      );
    }

    // set emotion from talk.style
    if (resolvedEmotion !== undefined) {
      ttsQueryJson.emotion = resolvedEmotion;
    }
    if (resolvedSpeed !== undefined) {
      ttsQueryJson.speed = resolvedSpeed;
    }
    if (resolvedPitch !== undefined) {
      ttsQueryJson.pitch = resolvedPitch;
    }
    ttsQueryJson.text = talk.message;
    ttsQueryJson.speaker = speaker;

    const synthesisUrl = this.buildUrl('/synthesis', { speaker });

    let synthesisBody: string;
    try {
      synthesisBody = JSON.stringify(ttsQueryJson);
    } catch (stringifyErr) {
      throw new Error(
        `VoicePeak TTS: failed to serialize synthesis JSON: ${String(stringifyErr)}`,
      );
    }

    const synthesisResponse = await fetch(synthesisUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: synthesisBody,
    });

    if (!synthesisResponse.ok) {
      const detail = await VoicePeakEngine.readFetchErrorDetail(synthesisResponse);
      throw new Error(`Failed to fetch TTS synthesis result. ${detail}`);
    }

    const blob = await synthesisResponse.blob();
    return await blob.arrayBuffer();
  }

  /**
   * ナレーター ID ごとの `emotion` 名（製品・声によって異なる）を登録する。
   */
  setNarratorEmotionMap(
    map?: Partial<Record<string, Partial<Record<TalkStyle, string>>>>,
  ): void {
    this.narratorEmotionMap =
      map === undefined ? undefined : { ...map };
  }

  /**
   * 感情タグ（`[happy]` の `happy`）→ `emotion` 文字列の対応をナレーターごとに登録する。
   */
  setNarratorTagEmotionMap(
    map?: Partial<Record<string, Record<string, string>>>,
  ): void {
    this.narratorTagEmotionMap =
      map === undefined ? undefined : { ...map };
  }

  /**
   * `voicepeakEmotion` が重みマップで、かつシリアライズ結果が空のときは
   * 「上書きなし」と同じにし、`talk.screenplayEmotion` / style から決める。
   * （設定 UI が `{}` を保存すると `[joy]` 等が無視されていた）
   */
  private resolveVoicepeakEmotionForRequest(
    speaker: string,
    talk: Talk,
  ): EmotionTypeForVoicepeak | string | undefined {
    if (typeof this.emotionOverride === 'string') {
      const t = this.emotionOverride.trim();
      if (t === '') {
        return this.resolveStyleToVoicepeakEmotion(speaker, talk);
      }
      return this.emotionOverride;
    }
    if (this.emotionOverride === undefined) {
      return this.resolveStyleToVoicepeakEmotion(speaker, talk);
    }
    const weighted = this.serializeWeights(this.emotionOverride);
    if (weighted !== undefined) {
      return weighted;
    }
    return this.resolveStyleToVoicepeakEmotion(speaker, talk);
  }

  /**
   * `talk.screenplayEmotion`（最優先）→ `talk.style` の順で VOICEPEAK `emotion` を決める。
   */
  private resolveStyleToVoicepeakEmotion(
    speaker: string,
    talk: Talk,
  ): EmotionTypeForVoicepeak | string {
    const style = (talk.style ?? 'talk') as TalkStyle;
    const styleKey: TalkStyle = style === 'talk' ? 'neutral' : style;
    const rawTag = talk.screenplayEmotion?.trim().toLowerCase();

    const tagMap = this.lookupNarratorEntry(this.narratorTagEmotionMap, speaker);
    if (rawTag && tagMap?.[rawTag]) {
      const trimmed = tagMap[rawTag].trim();
      if (trimmed !== '') {
        return trimmed;
      }
    }

    const perSpeaker = this.lookupNarratorEntry(
      this.narratorEmotionMap,
      speaker,
    );
    if (perSpeaker) {
      const mapped = perSpeaker[styleKey];
      if (mapped !== undefined) {
        const trimmed = mapped.trim();
        if (trimmed !== '') {
          return trimmed;
        }
      }
    }
    return this.mapEmotionStyle(style);
  }

  private lookupNarratorEntry<T>(
    map: Partial<Record<string, T>> | undefined,
    speaker: string,
  ): T | undefined {
    if (!map) {
      return undefined;
    }
    const sp = speaker.trim();
    if (!sp) {
      return undefined;
    }
    if (map[sp] !== undefined) {
      return map[sp];
    }
    const lower = sp.toLowerCase();
    for (const [k, v] of Object.entries(map)) {
      if (k.trim().toLowerCase() === lower) {
        return v;
      }
    }
    return undefined;
  }

  /**
   * Map emotion style to VoicePeak's emotion parameters
   */
  private mapEmotionStyle(style: string): EmotionTypeForVoicepeak {
    switch (style.toLowerCase()) {
      case 'happy':
      case 'fun':
        return 'happy';
      case 'angry':
        return 'angry';
      case 'sad':
        return 'sad';
      case 'surprised':
        return 'surprised';
      default:
        return 'neutral';
    }
  }

  getTestMessage(textVoiceText?: string): string {
    return textVoiceText || 'ボイスピークを使用します';
  }

  /**
   * Set custom API endpoint URL
   * @param apiUrl custom API endpoint URL
   */
  setApiEndpoint(apiUrl: string): void {
    this.apiEndpoint = apiUrl;
  }

  setEmotion(emotion?: VoicepeakEmotionInput): void {
    if (emotion === undefined) {
      this.emotionOverride = undefined;
      return;
    }

    if (typeof emotion === 'string') {
      this.emotionOverride = emotion;
      return;
    }

    if (emotion === null || Array.isArray(emotion)) {
      throw new Error(
        'VoicePeak emotion override must be a string or a weight map.',
      );
    }

    let sum = 0;
    for (const [key, value] of Object.entries(emotion)) {
      if (!VOICEPEAK_EMOTION_KEYS.includes(key as EmotionTypeForVoicepeak)) {
        throw new Error(
          `VoicePeak emotion weights contain an unknown key "${key}". Valid keys: happy, fun, angry, sad, neutral, surprised.`,
        );
      }

      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error(
          `VoicePeak emotion weight for "${key}" must be an integer, got ${value}.`,
        );
      }

      if (value < 0 || value > 100) {
        throw new Error(
          `VoicePeak emotion weight for "${key}" must be between 0 and 100, got ${value}.`,
        );
      }

      if (key !== 'neutral') {
        sum += value;
      }
    }

    if (sum > 100) {
      throw new Error(
        `VoicePeak emotion weights must sum to 100 or less (neutral excluded), got ${sum}.`,
      );
    }

    this.emotionOverride = { ...emotion };
  }

  setSpeed(speed?: number): void {
    this.speedOverride = this.normalizeInteger(speed, 50, 200);
  }

  setPitch(pitch?: number): void {
    this.pitchOverride = this.normalizeInteger(pitch, -300, 300);
  }

  private normalizeInteger(
    value: number | null | undefined,
    min: number,
    max: number,
  ): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (!Number.isFinite(value)) {
      return undefined;
    }
    const rounded = Math.round(value);
    if (rounded < min) {
      return min;
    }
    if (rounded > max) {
      return max;
    }
    return rounded;
  }

  private serializeWeights(
    weights: VoicepeakEmotionWeights,
  ): string | undefined {
    const serialized = Object.entries(weights)
      .filter(
        ([key, value]) =>
          key !== 'neutral' && value !== undefined && value !== 0,
      )
      .map(([key, value]) => `${key}=${value}`)
      .join(',');

    return serialized.length > 0 ? serialized : undefined;
  }

  private normalizeEmotionParam(
    emotion: EmotionTypeForVoicepeak | string | undefined,
  ): string | undefined {
    if (emotion === undefined || emotion === '') {
      return undefined;
    }
    return emotion === 'neutral' ? undefined : emotion;
  }

  private static async readFetchErrorDetail(res: Response): Promise<string> {
    const text = await res.text().catch(() => '');
    const clipped = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    return `status=${res.status} body=${JSON.stringify(clipped)}`;
  }

  private buildUrl(
    path: string,
    params: Record<string, string | undefined>,
  ): string {
    const base = this.apiEndpoint.replace(/\/$/, '');
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }
}
