import type { VoicepeakEmotionByNarrator } from '@aituber-onair/core';

/**
 * VOICEPEAK ナレーター ID と、`--list-narrator` / vpeak の `emotion` 名の対応。
 * キーは `TalkStyle`（画面の `[emotion]` → VoiceEngineAdapter 経由で渡る値）。
 *
 * 割り当ては好みで調整してください（未指定スタイルは従来の happy / neutral 等にフォールバック）。
 */
export const VOICEPEAK_EMOTION_BY_NARRATOR: VoicepeakEmotionByNarrator = {
  'Kasane Teto': {
    neutral: 'teto-low-key',
    happy: 'teto-overactive=100',
    sad: 'teto-low-key=50,teto-whisper=50',
    angry: 'teto-powerful=100',
    surprised: 'teto-overactive=50,teto-powerful=50',
  },
  Frimomen: {
    neutral: 'happy',
    happy: 'happy',
    sad: 'sad',
    angry: 'angry',
    surprised: 'ochoushimono',
  },
  Jashinchan: {
    neutral: 'happy',
    happy: 'happy',
    sad: 'sad',
    angry: 'enraged',
    surprised: 'fun',
  },
};

/** 設定画面用: ナレーターごとに使える VOICEPEAK `emotion` 名の目安 */
export const VOICEPEAK_NARRATOR_EMOTION_PARAM_HINTS: Record<string, string> = {
  'Kasane Teto':
    'この声で使える emotion の例: teto-overactive, teto-low-key, teto-whisper, teto-powerful, teto-sweet。重み付けは happy=40,fun=60 のように1行で。',
  Frimomen:
    'この声で使える emotion の例: happy, angry, sad, ochoushimono。重み付けは happy=40,fun=60 のように1行で。',
  Jashinchan:
    'この声で使える emotion の例: angry, enraged, fun, happy, sad。重み付けは happy=40,fun=60 のように1行で。',
};

export const VOICEPEAK_NARRATOR_EMOTION_PARAM_HINT_DEFAULT =
  'emotion 名はナレーターごとに異なります。VOICEPEAK / vpeak のドキュメントや CLI（例: voicepeak --list-narrator）で確認してください。';

/**
 * 感情タグごとの emotion 組み込み既定（話者 ID キー）。
 * `mergeVoicepeakEmotionTagMaps` で読み上げ用マップにマージされ、設定の空欄タグへ適用される。
 * 設定 UI のプレースホルダと折りたたみ表にも同じ内容を表示する。
 */
export const VOICEPEAK_NARRATOR_TAG_REFERENCE: Record<
  string,
  Partial<Record<string, string>>
> = {
  'Kasane Teto': {
    neutral: 'teto-low-key',
    happy: 'teto-overactive=100',
    joy: 'teto-overactive=70,teto-powerful=30',
    sad: 'teto-low-key=50,teto-whisper=50',
    angry: 'teto-powerful=100',
    surprised: 'teto-overactive=50,teto-powerful=50',
    relaxed: 'teto-whisper=60,teto-sweet=40',
  },
  Frimomen: {
    neutral: 'happy',
    happy: 'happy',
    joy: 'happy',
    sad: 'sad',
    angry: 'angry',
    surprised: 'ochoushimono',
    relaxed: 'happy',
  },
  Jashinchan: {
    neutral: 'happy',
    happy: 'happy',
    joy: 'fun',
    sad: 'sad',
    angry: 'enraged',
    surprised: 'fun',
    relaxed: 'happy',
  },
};

/**
 * 組み込みのタグ→emotion をベースに、設定に保存した値だけを上書きする。
 * （保存表が空でも、読み上げでは既定の重み付き emotion が使われる）
 */
function trimNarratorRecordKeys<T>(
  m: Record<string, T>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(m)) {
    const nk = k.trim();
    if (nk) {
      out[nk] = v;
    }
  }
  return out;
}

export function mergeVoicepeakEmotionTagMaps(
  defaults: Record<string, Partial<Record<string, string>>>,
  user?: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const defaultsT = trimNarratorRecordKeys(defaults);
  const userT = user ? trimNarratorRecordKeys(user) : {};
  const narratorIds = new Set([
    ...Object.keys(defaultsT),
    ...Object.keys(userT),
  ]);

  for (const nid of narratorIds) {
    const merged: Record<string, string> = {};
    const base = defaultsT[nid] ?? {};
    for (const [tag, val] of Object.entries(base)) {
      const t = tag.trim().toLowerCase();
      const v = String(val ?? '').trim();
      if (t && v) {
        merged[t] = v;
      }
    }
    const over = userT[nid] ?? {};
    for (const [tag, val] of Object.entries(over)) {
      const t = tag.trim().toLowerCase();
      const v = String(val ?? '').trim();
      if (!t) continue;
      if (!v) {
        delete merged[t];
        continue;
      }
      merged[t] = v;
    }
    if (Object.keys(merged).length > 0) {
      out[nid] = merged;
    }
  }
  return out;
}
