import { useEffect, useRef, type MutableRefObject } from 'react';

export interface UseMicSilenceAutoSendParams {
  /** マイク ON */
  active: boolean;
  /** 0 で無効 */
  silenceMs: number;
  /** レベルがこれ以上なら「閾値超え」 */
  gateThreshold: number;
  /** 閾値超えをこの ms 以上維持したときだけ実入力とみなす */
  noiseIgnoreMs: number;
  rmsRef: MutableRefObject<number>;
  disabled: boolean;
  getMessage: () => string;
  /** メッセージが空でなければ呼ぶ */
  onSilenceSend: () => void;
}

/**
 * 実入力（閾値以上が noiseIgnoreMs 続く）のあと、レベルが閾値未満が silenceMs 続いたら送信。
 * 無音＝閾値未満（メーターの縦線と同じ。旧 58% ルールは閾値が効かない体感の原因だった）。
 */
export function useMicSilenceAutoSend(params: UseMicSilenceAutoSendParams) {
  const ref = useRef(params);
  ref.current = params;

  useEffect(() => {
    const tick = 100;
    let loudStreak = 0;
    let quietStreak = 0;
    let hasLoud = false;

    const id = window.setInterval(() => {
      const p = ref.current;
      if (!p.active || p.silenceMs <= 0 || p.disabled) {
        loudStreak = 0;
        quietStreak = 0;
        hasLoud = false;
        return;
      }

      const rms = p.rmsRef.current;
      const thr = p.gateThreshold;
      const noiseNeed = Math.max(0, p.noiseIgnoreMs);
      const silenceNeed = p.silenceMs;
      const gateActive = thr >= 0.004;
      const loud = gateActive ? rms >= thr : rms > 0.002;
      const quiet = gateActive ? rms < thr : rms <= 0.002;

      if (loud) {
        quietStreak = 0;
        loudStreak += tick;
        if (loudStreak >= noiseNeed) {
          hasLoud = true;
        }
      } else {
        loudStreak = 0;
        if (hasLoud && quiet) {
          quietStreak += tick;
          if (quietStreak >= silenceNeed) {
            const msg = p.getMessage().trim();
            if (msg) {
              p.onSilenceSend();
            }
            hasLoud = false;
            quietStreak = 0;
          }
        } else if (hasLoud && !quiet) {
          quietStreak = 0;
        }
      }
    }, tick);

    return () => {
      window.clearInterval(id);
    };
  }, [
    params.active,
    params.silenceMs,
    params.disabled,
    params.gateThreshold,
    params.noiseIgnoreMs,
  ]);
}
