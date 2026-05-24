/** VOICEPEAK 公式上限 141 未満。vpeakserver / CLI はもう少し短い方が安定しやすい */
export const VOICEPEAK_SAFE_MAX_SPEAK_CHARS = 120;

/**
 * 読み上げ用テキストの整形（制御文字・ゼロ幅などで CLI が落ちるのを避ける）
 */
export function sanitizeVoicePeakSpeakText(text: string): string {
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u2028|\u2029/g, '\n')
    .trim();
}

export function isVoicePeakCliCrashError(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : error);
  return /0xc0000005|voicepeak CLI failed|status=500/i.test(msg);
}

/**
 * 失敗したチャンクを2つに分割（句点優先、なければ中央で切る）
 */
export function bisectVoicePeakSpeakChunk(text: string): [string, string] | null {
  const trimmed = sanitizeVoicePeakSpeakText(text);
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
