import { useCallback, useEffect, useRef, useState } from 'react';



const SIG_W = 48;

const SIG_H = 27;



type CaptureOptions = {

  maxWidth: number;

  maxHeight: number;

  jpegQuality: number;

};



function captureFrameFromVideo(

  video: HTMLVideoElement,

  opts: CaptureOptions,

): { dataUrl: string; sig: Uint8Array } | null {

  if (!video.videoWidth || !video.videoHeight) {

    return null;

  }

  const srcW = video.videoWidth;

  const srcH = video.videoHeight;

  const capW = Math.max(64, Math.min(opts.maxWidth, 4096));

  const capH = Math.max(64, Math.min(opts.maxHeight, 4096));

  let w = Math.min(capW, srcW);

  let h = Math.round((w * srcH) / srcW);

  if (h > capH) {

    h = capH;

    w = Math.round((h * srcW) / srcH);

  }

  const canvas = document.createElement('canvas');

  canvas.width = w;

  canvas.height = h;

  const ctx = canvas.getContext('2d');

  if (!ctx) {

    return null;

  }

  ctx.drawImage(video, 0, 0, w, h);

  const q = Math.min(0.98, Math.max(0.2, opts.jpegQuality));



  const sigCanvas = document.createElement('canvas');

  sigCanvas.width = SIG_W;

  sigCanvas.height = SIG_H;

  const sigCtx = sigCanvas.getContext('2d');

  if (!sigCtx) {

    return { dataUrl: canvas.toDataURL('image/jpeg', q), sig: new Uint8Array() };

  }

  sigCtx.drawImage(canvas, 0, 0, SIG_W, SIG_H);

  const img = sigCtx.getImageData(0, 0, SIG_W, SIG_H).data;

  const sig = new Uint8Array(SIG_W * SIG_H);

  for (let i = 0; i < SIG_W * SIG_H; i++) {

    const r = img[i * 4 + 0]!;

    const g = img[i * 4 + 1]!;

    const b = img[i * 4 + 2]!;

    sig[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;

  }



  return { dataUrl: canvas.toDataURL('image/jpeg', q), sig };

}



export type CaptureVisionBarVariant = 'full' | 'minimal';



interface CaptureVisionBarProps {

  disabled: boolean;

  onSendVision: (imageDataUrl: string, visionPrompt: string) => Promise<void>;

  onAutoTick?: (fn: () => void) => void;

  defaultPrompt?: string;

  onPromptChange?: (prompt: string) => void;

  skipIfUnchanged?: boolean;

  changeThreshold?: number;

  captureMaxWidth?: number;

  captureMaxHeight?: number;

  jpegQuality?: number;

  previewMaxHeightPx?: number;

  /**

   * `minimal`: プレビュー＋デバイスのみ。AI 指示・手動送信なし（送信時は `defaultPrompt`）。

   */

  variant?: CaptureVisionBarVariant;
  minimalOptionsVisible?: boolean;
  onToggleMinimalOptions?: () => void;
  periodicEnabled?: boolean;
  onTogglePeriodicEnabled?: () => void;
  sendWithUserMessageEnabled?: boolean;
  onToggleSendWithUserMessage?: () => void;
  periodicIntervalSec?: number;
  onChangePeriodicIntervalSec?: (next: number) => void;

}



export function CaptureVisionBar({

  disabled,

  onSendVision,

  onAutoTick,

  defaultPrompt,

  onPromptChange,

  skipIfUnchanged,

  changeThreshold,

  captureMaxWidth = 1280,

  captureMaxHeight = 720,

  jpegQuality = 0.82,

  previewMaxHeightPx = 220,

  variant = 'full',
  minimalOptionsVisible = false,
  onToggleMinimalOptions,
  periodicEnabled,
  onTogglePeriodicEnabled,
  sendWithUserMessageEnabled,
  onToggleSendWithUserMessage,
  periodicIntervalSec = 30,
  onChangePeriodicIntervalSec,

}: CaptureVisionBarProps) {

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);

  const [visionPrompt, setVisionPrompt] = useState(defaultPrompt ?? '');

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);

  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  const [error, setError] = useState<string | null>(null);

  const [sending, setSending] = useState(false);

  const lastSigRef = useRef<Uint8Array | null>(null);
  const lastAutoStartAtRef = useRef(0);



  const stopStream = useCallback(() => {

    const v = videoRef.current;

    if (v?.srcObject) {

      for (const t of (v.srcObject as MediaStream).getTracks()) {

        t.stop();

      }

      v.srcObject = null;

    }

    setStream(null);

  }, []);



  const refreshDevices = useCallback(async () => {

    try {

      const list = await navigator.mediaDevices.enumerateDevices();

      const cams = list.filter((d) => d.kind === 'videoinput');

      setVideoDevices(cams);

    } catch {

      setVideoDevices([]);

    }

  }, []);



  useEffect(() => {

    void refreshDevices();

    const handler = () => {

      void refreshDevices();

    };

    navigator.mediaDevices.addEventListener('devicechange', handler);

    return () => {

      navigator.mediaDevices.removeEventListener('devicechange', handler);

    };

  }, [refreshDevices]);



  useEffect(() => {

    if (videoDevices.length > 0 && !selectedDeviceId) {

      setSelectedDeviceId(videoDevices[0].deviceId);

    }

  }, [videoDevices, selectedDeviceId]);



  useEffect(() => {

    return () => {

      stopStream();

    };

  }, [stopStream]);



  const attachStream = useCallback(async (mediaStream: MediaStream) => {

    stopStream();

    setError(null);

    const v = videoRef.current;

    if (!v) return;

    v.srcObject = mediaStream;

    setStream(mediaStream);

    mediaStream.getVideoTracks()[0]?.addEventListener('ended', () => {

      stopStream();

    });

    try {

      await v.play();

    } catch (e) {

      console.error(e);

      setError('プレビューの再生に失敗しました');

    }

  }, [stopStream]);



  const startDeviceCapture = useCallback(async () => {

    if (!navigator.mediaDevices?.getUserMedia) {

      setError('カメラ API に対応していません');

      return;

    }

    try {

      const constraints: MediaStreamConstraints = {

        video: selectedDeviceId

          ? { deviceId: { exact: selectedDeviceId } }

          : true,

        audio: false,

      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      await attachStream(mediaStream);

    } catch (e) {

      console.warn(e);

      setError('キャプチャデバイスを開けませんでした（権限・接続を確認）');

    }

  }, [attachStream, selectedDeviceId]);



  const handleSendFrame = useCallback(async () => {

    const video = videoRef.current;

    if (!video || disabled || sending) return;

    const frame = captureFrameFromVideo(video, {

      maxWidth: captureMaxWidth,

      maxHeight: captureMaxHeight,

      jpegQuality,

    });

    if (!frame) {

      setError('まだ映像がありません。デバイス映像の権限と接続を確認してください');

      return;

    }



    const threshold = Number.isFinite(changeThreshold) ? Number(changeThreshold) : 0;

    if (skipIfUnchanged && frame.sig.length > 0 && lastSigRef.current) {

      const prev = lastSigRef.current;

      let sum = 0;

      const n = Math.min(prev.length, frame.sig.length);

      for (let i = 0; i < n; i++) {

        sum += Math.abs(frame.sig[i]! - prev[i]!);

      }

      const avg = sum / (n * 255);

      if (avg <= threshold) {

        return;

      }

    }

    if (frame.sig.length > 0) {

      lastSigRef.current = frame.sig;

    }



    setSending(true);

    setError(null);

    const promptForSend =

      variant === 'minimal' ? (defaultPrompt ?? '').trim() : visionPrompt;



    try {

      await onSendVision(frame.dataUrl, promptForSend);

    } catch (e) {

      console.error(e);

      const detail = e instanceof Error ? e.message : String(e);

      setError(`送信に失敗: ${detail}`);

    } finally {

      setSending(false);

    }

  }, [

    captureMaxHeight,

    captureMaxWidth,

    changeThreshold,

    defaultPrompt,

    disabled,

    jpegQuality,

    onSendVision,

    sending,

    skipIfUnchanged,

    variant,

    visionPrompt,

  ]);



  useEffect(() => {

    if (!onAutoTick) return;

    const tick = () => {

      void handleSendFrame();

    };

    onAutoTick(tick);

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [onAutoTick, handleSendFrame]);



  useEffect(() => {

    if (defaultPrompt === undefined) return;

    setVisionPrompt(defaultPrompt);

  }, [defaultPrompt]);

  // In minimal mode, keep preview available without pressing "表示".
  // This also retries automatically when stream ends unexpectedly.
  useEffect(() => {
    if (variant !== 'minimal') return;
    if (disabled || sending) return;
    if (stream) return;
    if (!selectedDeviceId) return;

    const now = Date.now();
    if (now - lastAutoStartAtRef.current < 1500) return;
    lastAutoStartAtRef.current = now;
    void startDeviceCapture();
  }, [disabled, selectedDeviceId, sending, startDeviceCapture, stream, variant]);



  const busy = disabled || sending;

  const isMinimal = variant === 'minimal';

  const handleDeviceSelectChange = useCallback(
    (nextDeviceId: string) => {
      setSelectedDeviceId(nextDeviceId);
      if (disabled || sending) return;
      void startDeviceCapture();
    },
    [disabled, sending, startDeviceCapture],
  );



  const devicePicker = (
    <select
      className="capture-vision-select"
      value={selectedDeviceId}
      onChange={(e) => handleDeviceSelectChange(e.target.value)}
      aria-label="ビデオ入力"
    >
      {videoDevices.length === 0 ? (
        <option value="">（カメラが見つかりません）</option>
      ) : (
        videoDevices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `ビデオ入力 ${i + 1}`}
          </option>
        ))
      )}
    </select>
  );

  const deviceControls = isMinimal ? (
    <div className="capture-vision-minimal-controls">
      <div className="capture-vision-row capture-vision-row--device">
        {devicePicker}
        <button
          type="button"
          className="capture-vision-secondary"
          onClick={onToggleMinimalOptions}
        >
          {minimalOptionsVisible ? 'オプション非表示' : 'オプション表示'}
        </button>
      </div>
      {minimalOptionsVisible && (
        <>
          <div className="capture-vision-row capture-vision-row--actions">
            <button
              type="button"
              className={`capture-vision-secondary ${periodicEnabled ? 'is-active' : ''}`}
              onClick={onTogglePeriodicEnabled}
            >
              定期送信
            </button>
            <button
              type="button"
              className={`capture-vision-secondary ${sendWithUserMessageEnabled ? 'is-active' : ''}`}
              onClick={onToggleSendWithUserMessage}
            >
              同時送信
            </button>
          </div>
          <div className="capture-vision-row capture-vision-row--slider">
            <label className="capture-vision-label-inline">
              定期送信間隔: {Math.round(periodicIntervalSec)} 秒
            </label>
            <input
              className="capture-vision-slider"
              type="range"
              min={5}
              max={180}
              value={Math.round(periodicIntervalSec)}
              onChange={(e) => onChangePeriodicIntervalSec?.(Number(e.target.value))}
            />
          </div>
        </>
      )}
    </div>
  ) : (
    <div className="capture-vision-row capture-vision-row--device">
      {devicePicker}
      <button
        type="button"
        className="capture-vision-ghost"
        onClick={() => void refreshDevices()}
      >
        更新
      </button>
      <button
        type="button"
        className="capture-vision-primary"
        onClick={() => void startDeviceCapture()}
        disabled={busy}
      >
        キャプチャ開始
      </button>
      <button
        type="button"
        className="capture-vision-secondary"
        onClick={stopStream}
        disabled={!stream}
      >
        停止
      </button>
    </div>
  );



  return (

    <div

      className={

        isMinimal ? 'capture-vision-bar capture-vision-bar--minimal' : 'capture-vision-bar'

      }

    >

      {!isMinimal && (

        <div className="capture-vision-header">

          <span className="capture-vision-title">画面 → AI（ビジョン）</span>

        </div>

      )}



      <div

        className="capture-vision-preview-wrap"

        style={

          isMinimal

            ? undefined

            : { maxHeight: `${previewMaxHeightPx}px` }

        }

      >

        <video

          ref={videoRef}

          className="capture-vision-video"

          muted

          playsInline

          autoPlay

        />

        {!stream && (

          <div className="capture-vision-placeholder">

            {isMinimal

              ? 'デバイスの映像を自動で表示中です（権限が必要です）'

              : 'デバイスでキャプチャを開始するとプレビューが出ます'}

          </div>

        )}

      </div>



      {deviceControls}



      {!isMinimal && (

        <>

          <label className="capture-vision-label" htmlFor="vision-prompt">

            AI への指示（任意・日本語推奨）

          </label>

          <textarea

            id="vision-prompt"

            className="capture-vision-textarea"

            rows={2}

            value={visionPrompt}

            onChange={(e) => {

              setVisionPrompt(e.target.value);

              onPromptChange?.(e.target.value);

            }}

            disabled={busy}

            placeholder="例: この画面のゲーム状況を短く説明して / コメント欄が読めるか確認して"

          />



          <div className="capture-vision-row">

            <button

              type="button"

              className="capture-vision-send"

              onClick={() => void handleSendFrame()}

              disabled={busy || !stream}

            >

              {sending ? '送信中…' : '現在のフレームを AI に送る'}

            </button>

          </div>

        </>

      )}



      {error && <div className="capture-vision-error">{error}</div>}



      {!isMinimal && (

        <p className="capture-vision-hint">

          マルチモーダル対応モデルが必要です。LM Studio は OpenAI 互換の{' '}

          <code>/v1/chat/completions</code> エンドポイントと、画像入力に対応したモデルを選んでください。

          送信が失敗する場合は、画像サイズ（幅・高さ）や JPEG 品質を下げてください。

        </p>

      )}

    </div>

  );

}

