import { describe, expect, it } from 'vitest';
import {
  bisectVoicePeakSpeakChunk,
  isVoicePeakCliCrashError,
  sanitizeVoicePeakSpeakText,
} from '../src/utils/voicepeakSpeakText';

describe('voicepeakSpeakText', () => {
  it('sanitizes control characters', () => {
    expect(sanitizeVoicePeakSpeakText('あ\u200bい')).toBe('あい');
  });

  it('detects VoicePeak CLI crash messages', () => {
    expect(
      isVoicePeakCliCrashError(
        new Error('exit status 0xc0000005: voicepeak CLI failed'),
      ),
    ).toBe(true);
    expect(isVoicePeakCliCrashError(new Error('network'))).toBe(false);
  });

  it('bisects long text into two parts', () => {
    const text = 'あ'.repeat(50) + '。' + 'い'.repeat(50);
    const parts = bisectVoicePeakSpeakChunk(text);
    expect(parts).not.toBeNull();
    expect(parts![0].length).toBeGreaterThan(0);
    expect(parts![1].length).toBeGreaterThan(0);
    expect(parts![0].length + parts![1].length).toBeLessThanOrEqual(text.length);
  });
});
