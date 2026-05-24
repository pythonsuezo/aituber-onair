import { useId, useState } from 'react';
import type { SttSettings } from '../types/settings';
import { hasVoiceProfile } from '../utils/voiceProfileStorage';

interface MicInputMeterProps {
  active: boolean;
  rmsLevel: number;
  stt: SttSettings;
  updateSttField: <K extends keyof SttSettings>(
    key: K,
    value: SttSettings[K],
  ) => void;
  remoteGateApplies: boolean;
  voiceMatchSimilarity?: number | null;
  voiceMatchPassed?: boolean | null;
}

export function MicInputMeter({
  active,
  rmsLevel,
  stt,
  updateSttField,
  remoteGateApplies,
  voiceMatchSimilarity = null,
  voiceMatchPassed = null,
}: MicInputMeterProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advId = useId();

  const display = active ? rmsLevel : 0;
  const pct = Math.round(Math.min(1, Math.max(0, display)) * 100);
  const thPct = Math.round(Math.min(1, Math.max(0, stt.micGateThreshold)) * 100);

  const showVoiceMatch = hasVoiceProfile() && remoteGateApplies;
  const voiceTh = Math.min(0.92, Math.max(0.55, stt.voiceMatchThreshold));
  const voiceThPct = Math.round(voiceTh * 100);
  const matchPct =
    voiceMatchSimilarity == null
      ? null
      : Math.round(Math.min(1, Math.max(0, voiceMatchSimilarity)) * 100);
  const matchBarPct = matchPct ?? 0;

  const silenceSec = stt.micAutoSendSilenceMs / 1000;
  const autoLabel =
    stt.micAutoSendSilenceMs > 0
      ? `${silenceSec.toFixed(2)}秒`
      : 'オフ';

  return (
    <div
      className="chat-input-meter-panel"
      aria-label="マイク入力と閾値の設定"
    >
      <div className="mic-input-meter" aria-label="マイク入力レベル">
        <div className="mic-input-meter__header">
          <span className="mic-input-meter__label">マイク入力</span>
          <span className="mic-input-meter__hint">
            {active ? `${pct}%` : '—'}
            {remoteGateApplies ? ' · 下は送信しない' : ' · 表示のみ'}
          </span>
        </div>
        <p className="mic-input-meter__hint-line">
          マイク入力は<strong>無音で送信</strong>が基本です。メーターが閾値線<strong>以上</strong>＝話し中、<strong>未満</strong>が無音カウント。
          {remoteGateApplies
            ? ' 閾値・ノイズ無視は文字起こしにも同じです。'
            : ' ブラウザ音声認識では閾値は無音送信の判定のみ（認識テキスト自体はフィルタされません）。'}
        </p>
        <label className="mic-input-meter__slider-row">
          <span className="mic-input-meter__slider-label">無音で送信</span>
          <input
            type="range"
            min={0}
            max={10}
            step={0.05}
            value={silenceSec}
            onChange={(e) => {
              const sec = Math.min(10, Math.max(0, Number(e.target.value)));
              updateSttField(
                'micAutoSendSilenceMs',
                Math.round(sec * 1000),
              );
            }}
          />
          <span className="mic-input-meter__slider-value">{autoLabel}</span>
        </label>
        <div className="mic-input-meter__track-wrap">
          <div
            className="mic-input-meter__track"
            role="meter"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="mic-input-meter__fill"
              style={{ width: `${pct}%` }}
            />
            <div
              className="mic-input-meter__threshold"
              style={{ left: `${thPct}%` }}
              title={`無入力とみなす境界（閾値） ${thPct}%`}
            />
          </div>
        </div>

        {showVoiceMatch ? (
          <div
            className="mic-input-meter__voice-match"
            aria-label="声紋一致率"
          >
            <div className="mic-input-meter__header">
              <span className="mic-input-meter__label">声紋一致</span>
              <span className="mic-input-meter__hint">
                {active && matchPct != null ? (
                  <>
                    {matchPct}%
                    {voiceMatchPassed === true ? ' · 通過' : ''}
                    {voiceMatchPassed === false ? ' · 無視' : ''}
                  </>
                ) : (
                  '—'
                )}
                {stt.voiceFilterEnabled ? ' · フィルタ ON' : ' · フィルタ OFF'}
              </span>
            </div>
            <div className="mic-input-meter__track-wrap">
              <div
                className="mic-input-meter__track mic-input-meter__track--voice"
                role="meter"
                aria-valuenow={matchPct ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={`mic-input-meter__fill mic-input-meter__fill--voice${
                    voiceMatchPassed === false ? ' is-rejected' : ''
                  }${voiceMatchPassed === true ? ' is-passed' : ''}`}
                  style={{ width: `${matchBarPct}%` }}
                />
                <div
                  className="mic-input-meter__threshold mic-input-meter__threshold--voice"
                  style={{ left: `${voiceThPct}%` }}
                  title={`通過ライン（閾値） ${voiceThPct}%`}
                />
              </div>
            </div>
            <label className="mic-input-meter__slider-row">
              <span className="mic-input-meter__slider-label">声紋しきい値</span>
              <input
                type="range"
                min={0.55}
                max={0.92}
                step={0.01}
                value={voiceTh}
                onChange={(e) => {
                  updateSttField('voiceMatchThreshold', Number(e.target.value));
                }}
              />
              <span className="mic-input-meter__slider-value">
                {voiceThPct}%
              </span>
            </label>
            <p className="mic-input-meter__hint-line">
              縦線がしきい値です。一致率が線以上なら通過（フィルタ ON 時のみ文字起こし）。
            </p>
          </div>
        ) : null}

        <label className="mic-input-meter__slider-row">
          <span className="mic-input-meter__slider-label">入力閾値</span>
          <input
            type="range"
            min={0}
            max={0.85}
            step={0.005}
            value={stt.micGateThreshold}
            onChange={(e) => {
              updateSttField('micGateThreshold', Number(e.target.value));
            }}
          />
          <span className="mic-input-meter__slider-value">
            {thPct}%（高いほど小さい音を無視）
          </span>
        </label>

        <button
          type="button"
          className="mic-input-meter__toggle"
          aria-expanded={advancedOpen}
          aria-controls={advId}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? '▼ 詳細を閉じる' : '▶ 詳細（ノイズ無視）'}
        </button>

        {advancedOpen ? (
          <div className="mic-input-meter__advanced" id={advId}>
            <p className="mic-input-meter__explain">
              閾値以上が {stt.micNoiseIgnoreMs}ms 続いたときだけ「話し始めた」とみなします（チラつきノイズを無視）。
              そのあと閾値未満が無音秒数続くと送信します。
            </p>
            <label className="mic-input-meter__slider-row">
              <span className="mic-input-meter__slider-label">ノイズ無視</span>
              <input
                type="range"
                min={0}
                max={2000}
                step={10}
                value={stt.micNoiseIgnoreMs}
                onChange={(e) => {
                  updateSttField('micNoiseIgnoreMs', Number(e.target.value));
                }}
              />
              <span className="mic-input-meter__slider-value">
                {stt.micNoiseIgnoreMs}ms
              </span>
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
