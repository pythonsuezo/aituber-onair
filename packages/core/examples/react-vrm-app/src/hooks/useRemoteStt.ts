import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatProviderOption, SttSettings } from '../types/settings';
import {
  OPENAI_DEFAULT_TRANSCRIBE_URL,
  transcribeGeminiAudio,
  transcribeOpenAiCompatible,
} from '../services/sttTranscribe';
import { extractCompleteSentences } from '../utils/sttSentenceSplit';
import { scoreVoiceMatch } from '../services/voiceEmbedding';
import { loadVoiceProfile } from '../utils/voiceProfileStorage';

/**
 * 1 セグメントの長さ（ms）。`start(timeslice)` の dataavailable は 2 本目以降
 * EBML ヘッダ無しの断片になり ffmpeg が読めないため、`start()` のみ + タイマーで
 * `stop()` し、毎回独立した WebM を得る。
 */
const RECORD_SEGMENT_MS = 2500;
/** トレイ非表示時に MediaRecorder / AudioContext を監視する間隔 */
const BACKGROUND_STT_WATCHDOG_MS = 1200;
/** 無音に近いセグメントでも捨てすぎないよう下限を少し下げる */
const MIN_BLOB_BYTES = 300;
/** メーター更新間隔（ms）。`segmentLoudMsRef` の加算に使用 */
const METER_TICK_MS = 55;

function pickAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const MR = MediaRecorder;
  if (typeof MR.isTypeSupported === 'function') {
    if (MR.isTypeSupported('audio/webm;codecs=opus')) {
      return 'audio/webm;codecs=opus';
    }
    if (MR.isTypeSupported('audio/webm')) return 'audio/webm';
  }
  return '';
}

function resolveSttApiKey(
  stt: SttSettings,
  getApiKeyForProvider: (p: ChatProviderOption) => string,
): string {
  const o = stt.apiKeyOverride?.trim();
  if (o) return o;
  if (stt.backend === 'openai') return getApiKeyForProvider('openai').trim();
  if (stt.backend === 'gemini') return getApiKeyForProvider('gemini').trim();
  return '';
}

function resolveOpenAiStyleUrl(stt: SttSettings): string {
  const u = stt.transcribeUrl.trim();
  if (stt.backend === 'openai') {
    return u || OPENAI_DEFAULT_TRANSCRIBE_URL;
  }
  return u;
}

function canRemoteStt(
  stt: SttSettings,
  getApiKeyForProvider: (p: ChatProviderOption) => string,
): boolean {
  if (!stt || stt.backend === 'browser') return false;
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  if (stt.backend === 'local') {
    return stt.transcribeUrl.trim().length > 0;
  }
  if (stt.backend === 'openai') {
    return resolveSttApiKey(stt, getApiKeyForProvider).length > 0;
  }
  if (stt.backend === 'gemini') {
    return resolveSttApiKey(stt, getApiKeyForProvider).length > 0;
  }
  return false;
}

export interface UseRemoteSttOptions {
  enabled: boolean;
  stt: SttSettings;
  getApiKeyForProvider: (p: ChatProviderOption) => string;
  onSentenceCommitted?: (sentence: string) => void;
  onRemainderWhenStopped?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
}

export function useRemoteStt(options: UseRemoteSttOptions) {
  const {
    enabled,
    stt,
    getApiKeyForProvider,
    onSentenceCommitted,
    onRemainderWhenStopped,
    onFinalTranscript,
  } = options;

  const optsRef = useRef(options);
  optsRef.current = options;

  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [pendingSpeechBuffer, setPendingSpeechBuffer] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [monitorStream, setMonitorStream] = useState<MediaStream | null>(null);
  const [micRmsLevel, setMicRmsLevel] = useState(0);
  /** 直近セグメントの声紋類似度（0〜1）。プロファイルありで解析したときだけ更新 */
  const [voiceMatchSimilarity, setVoiceMatchSimilarity] = useState<
    number | null
  >(null);
  const [voiceMatchPassed, setVoiceMatchPassed] = useState<boolean | null>(
    null,
  );

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** `rec.start()` のみ使うとき、次の `stop()` までのタイマー */
  const segmentEndTimerRef = useRef<number | null>(null);
  /** 録音セグメント中の最大 RMS（ゲート用。メーターと同スケール） */
  const segmentPeakRmsRef = useRef(0);
  /** 閾値以上が連続した時間の積算（ms）— micNoiseIgnoreMs と組み合わせる */
  const segmentLoudMsRef = useRef(0);
  const stopMeterLoopRef = useRef<(() => void) | null>(null);
  const bufferRef = useRef('');
  const chunkIndexRef = useRef(0);
  const chainRef = useRef(Promise.resolve());
  const wantsListenRef = useRef(false);
  const sessionIdRef = useRef(0);
  const startInFlightRef = useRef(false);
  const listeningRef = useRef(false);
  const processBlobRef = useRef<
    (blob: Blob, mime: string) => Promise<void>
  >(async () => {});
  const resumeAudioContextRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  const supported = enabled && canRemoteStt(stt, getApiKeyForProvider);

  const flushRemainder = useCallback(() => {
    const opts = optsRef.current;
    const tail = bufferRef.current.trim();
    bufferRef.current = '';
    setPendingSpeechBuffer('');
    if (!tail) return;
    if (opts.onRemainderWhenStopped) {
      opts.onRemainderWhenStopped(tail);
    } else if (opts.onFinalTranscript) {
      opts.onFinalTranscript(tail);
    }
  }, []);

  const appendTranscript = useCallback(
    (piece: string) => {
      const t = piece.trim();
      if (!t) return;
      const opts = optsRef.current;
      if (opts.onSentenceCommitted) {
        bufferRef.current += t;
        const { sentences, rest } = extractCompleteSentences(bufferRef.current);
        bufferRef.current = rest;
        setPendingSpeechBuffer(rest);
        for (const s of sentences) {
          opts.onSentenceCommitted?.(s);
        }
      } else {
        setFinalTranscript(t);
        opts.onFinalTranscript?.(t);
      }
    },
    [],
  );

  const processBlob = useCallback(
    async (blob: Blob, mime: string) => {
      const opts = optsRef.current;
      if (!opts.enabled || !wantsListenRef.current || blob.size < MIN_BLOB_BYTES) {
        return;
      }
      const s = opts.stt;
      const gate = Math.max(0, Math.min(1, Number(s.micGateThreshold ?? 0)));
      const noiseNeed = Math.max(0, Math.round(Number(s.micNoiseIgnoreMs ?? 0)));
      const peak = segmentPeakRmsRef.current;
      const loudMs = segmentLoudMsRef.current;
      segmentPeakRmsRef.current = 0;
      segmentLoudMsRef.current = 0;
      // 閾値が有効なときは必ず適用（旧: RMS=0 でゲートをスキップ→環境音まで文字起こししていた）
      if (gate >= 0.004) {
        if (peak < gate) {
          return;
        }
        if (noiseNeed > 0 && loudMs < noiseNeed) {
          return;
        }
      }
      const profile = loadVoiceProfile();
      if (profile) {
        const th = Math.min(
          0.92,
          Math.max(0.55, Number(s.voiceMatchThreshold ?? 0.78)),
        );
        const { match, similarity } = await scoreVoiceMatch(
          blob,
          profile.embedding,
          th,
        );
        setVoiceMatchSimilarity(similarity);
        setVoiceMatchPassed(match);
        if (s.voiceFilterEnabled && !match) {
          return;
        }
      }
      const apiKey = resolveSttApiKey(s, opts.getApiKeyForProvider);
      const lang = s.recognizedLang || 'ja-JP';
      let text = '';
      if (s.backend === 'gemini') {
        text = await transcribeGeminiAudio({
          apiKey,
          model: s.geminiModel,
          audio: blob,
          mimeType: mime,
          languageBcp47: lang,
        });
      } else {
        const url = resolveOpenAiStyleUrl(s);
        if (!url) return;
        const fn = `chunk-${chunkIndexRef.current++}.webm`;
        text = await transcribeOpenAiCompatible({
          url,
          apiKey,
          model: s.openaiCompatibleModel,
          audio: blob,
          filename: fn,
          languageBcp47: lang,
        });
      }
      appendTranscript(text);
    },
    [appendTranscript],
  );

  processBlobRef.current = processBlob;

  const stopTracks = useCallback(() => {
    if (segmentEndTimerRef.current !== null) {
      window.clearTimeout(segmentEndTimerRef.current);
      segmentEndTimerRef.current = null;
    }
    stopMeterLoopRef.current?.();
    stopMeterLoopRef.current = null;
    setMonitorStream(null);
    setMicRmsLevel(0);
    streamRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const wireRecorderRef = useRef<(stream: MediaStream, sessionId: number) => void>(
    () => {},
  );

  const wireAndStartRecorder = useCallback(
    (stream: MediaStream, sessionId: number) => {
      if (segmentEndTimerRef.current !== null) {
        window.clearTimeout(segmentEndTimerRef.current);
        segmentEndTimerRef.current = null;
      }

      segmentPeakRmsRef.current = 0;
      segmentLoudMsRef.current = 0;

      const mime = pickAudioMimeType();
      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = rec;
      const chosenMime = rec.mimeType || mime || 'audio/webm';

      rec.ondataavailable = (ev) => {
        if (sessionIdRef.current !== sessionId) return;
        if (!ev.data || ev.data.size < MIN_BLOB_BYTES) return;
        const blob = ev.data;
        setInterimTranscript('…');
        chainRef.current = chainRef.current
          .then(() => processBlobRef.current(blob, chosenMime))
          .catch((err: unknown) => {
            console.warn('[remote STT]', err);
            const msg = err instanceof Error ? err.message : String(err);
            setLastError(msg);
          })
          .finally(() => {
            if (wantsListenRef.current) {
              setInterimTranscript('');
            }
          });
      };

      rec.onerror = (ev) => {
        console.warn('[remote STT] MediaRecorder error', ev);
      };

      rec.onstop = () => {
        queueMicrotask(() => {
          if (sessionIdRef.current !== sessionId) return;
          if (!wantsListenRef.current) return;
          const s = streamRef.current;
          if (!s?.active) {
            setListening(false);
            return;
          }
          try {
            wireRecorderRef.current(s, sessionId);
          } catch (e) {
            console.warn('[remote STT] recorder segment chain failed', e);
            wantsListenRef.current = false;
            void chainRef.current.finally(() => {
              flushRemainder();
            });
            stopTracks();
            setListening(false);
            setLastError(
              e instanceof Error ? e.message : '録音の再開に失敗しました。',
            );
          }
        });
      };

      try {
        rec.start();
      } catch (e) {
        console.warn('[remote STT] MediaRecorder.start failed', e);
        throw e;
      }

      segmentEndTimerRef.current = window.setTimeout(() => {
        segmentEndTimerRef.current = null;
        if (sessionIdRef.current !== sessionId) return;
        if (!wantsListenRef.current) return;
        if (recorderRef.current !== rec) return;
        if (rec.state !== 'recording') return;
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }, RECORD_SEGMENT_MS);
    },
    [flushRemainder, stopTracks],
  );

  wireRecorderRef.current = wireAndStartRecorder;

  const start = useCallback(async () => {
    if (!enabled) return;
    if (startInFlightRef.current) return;

    const rec = recorderRef.current;
    if (rec?.state === 'recording' && wantsListenRef.current) {
      return;
    }

    const o = optsRef.current;
    if (!canRemoteStt(o.stt, o.getApiKeyForProvider)) {
      setLastError('STT の設定またはマイク環境が不足しています。');
      return;
    }

    startInFlightRef.current = true;
    try {
      if (listeningRef.current || streamRef.current || recorderRef.current) {
        wantsListenRef.current = false;
        sessionIdRef.current += 1;
        try {
          recorderRef.current?.stop();
        } catch {
          /* ignore */
        }
        stopTracks();
        setListening(false);
      }

      setLastError(null);
      wantsListenRef.current = true;
      sessionIdRef.current += 1;
      const sessionId = sessionIdRef.current;
      bufferRef.current = '';
      chunkIndexRef.current = 0;
      setPendingSpeechBuffer('');
      setFinalTranscript('');
      setInterimTranscript('');
      setVoiceMatchSimilarity(null);
      setVoiceMatchPassed(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMonitorStream(stream);
      wireAndStartRecorder(stream, sessionId);
      setListening(true);
    } catch (e) {
      wantsListenRef.current = false;
      sessionIdRef.current += 1;
      console.warn('[remote STT] getUserMedia', e);
      setLastError(
        e instanceof Error ? e.message : 'マイクの利用に失敗しました。',
      );
      stopTracks();
      setListening(false);
    } finally {
      startInFlightRef.current = false;
    }
  }, [enabled, stopTracks, wireAndStartRecorder]);

  const stop = useCallback(() => {
    if (segmentEndTimerRef.current !== null) {
      window.clearTimeout(segmentEndTimerRef.current);
      segmentEndTimerRef.current = null;
    }
    wantsListenRef.current = false;
    sessionIdRef.current += 1;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    stopTracks();
    setListening(false);
    setInterimTranscript('');
    setVoiceMatchSimilarity(null);
    setVoiceMatchPassed(null);
    void chainRef.current.finally(() => {
      flushRemainder();
    });
  }, [flushRemainder, stopTracks]);

  const reset = useCallback(() => {
    bufferRef.current = '';
    setPendingSpeechBuffer('');
    setFinalTranscript('');
    setInterimTranscript('');
    setLastError(null);
  }, []);

  useEffect(() => {
    return () => {
      wantsListenRef.current = false;
      sessionIdRef.current += 1;
      if (segmentEndTimerRef.current !== null) {
        window.clearTimeout(segmentEndTimerRef.current);
        segmentEndTimerRef.current = null;
      }
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      stopTracks();
    };
  }, [stopTracks]);

  useEffect(() => {
    if (!monitorStream) {
      return;
    }
    const stream = monitorStream;
    let cancelled = false;
    let meterTimer: number | null = null;
    let ctx: AudioContext | null = null;

    const resumeAudioIfNeeded = () => {
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
    };
    resumeAudioContextRef.current = resumeAudioIfNeeded;

    const onVisibility = () => {
      if (wantsListenRef.current) {
        resumeAudioIfNeeded();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    const stopLoop = () => {
      cancelled = true;
      if (meterTimer !== null) {
        window.clearInterval(meterTimer);
        meterTimer = null;
      }
      document.removeEventListener('visibilitychange', onVisibility);
      if (resumeAudioContextRef.current === resumeAudioIfNeeded) {
        resumeAudioContextRef.current = null;
      }
      void ctx?.close().catch(() => {});
      ctx = null;
    };

    void (async () => {
      try {
        ctx = new AudioContext();
        await ctx.resume();
        if (cancelled || !ctx) return;
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        an.smoothingTimeConstant = 0.55;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        meterTimer = window.setInterval(() => {
          if (cancelled || !ctx) return;
          resumeAudioIfNeeded();
          an.getFloatTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < buf.length; i += 1) {
            const v = buf[i] ?? 0;
            s += v * v;
          }
          const rms = Math.sqrt(s / buf.length);
          const level = Math.min(1, rms * 7);
          const gate = Math.max(
            0,
            Math.min(1, Number(optsRef.current.stt.micGateThreshold ?? 0)),
          );
          if (recorderRef.current?.state === 'recording') {
            segmentPeakRmsRef.current = Math.max(
              segmentPeakRmsRef.current,
              level,
            );
            if (gate >= 0.004 && level >= gate) {
              segmentLoudMsRef.current += METER_TICK_MS;
            }
          }
          setMicRmsLevel(level);
        }, METER_TICK_MS);
      } catch {
        if (!cancelled) setMicRmsLevel(0);
      }
    })();

    stopMeterLoopRef.current = stopLoop;
    return () => {
      stopMeterLoopRef.current = null;
      stopLoop();
    };
  }, [monitorStream]);

  const ensureRemoteSttRecording = useCallback(() => {
    if (!wantsListenRef.current) return;
    resumeAudioContextRef.current?.();
    const stream = streamRef.current;
    const rec = recorderRef.current;
    if (!stream?.active) return;
    if (rec && rec.state === 'recording') return;
    try {
      wireRecorderRef.current(stream, sessionIdRef.current);
      setListening(true);
    } catch (e) {
      console.warn('[remote STT] resume recording', e);
    }
  }, []);

  /** トレイ非表示でも MediaRecorder / 文字起こしを継続 */
  useEffect(() => {
    if (!supported) return;
    const id = window.setInterval(() => {
      ensureRemoteSttRecording();
    }, BACKGROUND_STT_WATCHDOG_MS);
    const onVisibility = () => {
      ensureRemoteSttRecording();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [supported, ensureRemoteSttRecording]);

  return {
    supported,
    listening,
    interimTranscript,
    finalTranscript,
    pendingSpeechBuffer,
    lastError,
    micRmsLevel,
    voiceMatchSimilarity,
    voiceMatchPassed,
    start,
    stop,
    reset,
  };
}
