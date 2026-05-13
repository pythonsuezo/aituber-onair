import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AmbientLight,
  AnimationClip,
  AnimationMixer,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  LoopRepeat,
  MOUSE,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VRM,
  VRMExpressionPresetName,
  VRMLoaderPlugin,
  VRMUtils,
} from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import { clearStoredVrm, loadStoredVrmBuffer } from '../utils/vrmBlobStorage';
import {
  VRM_CONTROL_EVENT,
  VRM_EMOTION_PREVIEW_EVENT,
  type VrmEmotionPreviewEventDetail,
} from '../windowMode';
import {
  type VrmChromaBgMode,
  type VrmEmotionTuneMap,
  type VrmExpressionBlendSettings,
  type VrmLegacyExpressionSettings,
  type VrmLightingSettings,
} from '../types/settings';

interface AvatarBackgroundProps {
  mouthLevel: number;
  isSpeaking: boolean;
  /** スマホレイアウトでは常に暗色（クロマ無し） */
  useDarkStudioBackground: boolean;
  /** PC の VRM シーン用クロマ色（useDarkStudioBackground が false のとき） */
  vrmChromaBg: VrmChromaBgMode;
  vrmLighting: VrmLightingSettings;
  vrmExpressionBlend: VrmExpressionBlendSettings;
  /** チューニング UI 用に保持。表情ドライブは `vrmLegacyExpression` ベース */
  vrmEmotionTunes: VrmEmotionTuneMap;
  vrmLegacyExpression: VrmLegacyExpressionSettings;
  /** 応答の感情タグ（例: happy）に連動した表情。未指定でニュートラル寄せ */
  assistantEmotion?: string;
}

const VRM_FILE_URL = `${import.meta.env.BASE_URL}avatar/miko.vrm`;
const VRMA_FILE_URL = `${import.meta.env.BASE_URL}avatar/idle_loop.vrma`;
const MAX_MOUTH_LEVEL = 4;
const BLINK_DURATION_SECONDS = 0.14;
const BLINK_INTERVAL_MIN_SECONDS = 2.4;
const BLINK_INTERVAL_MAX_SECONDS = 5.2;
/** 旧アプリ同様の表情プリセット重みの平滑係数 */
const LEGACY_FACE_BLEND = 0.18;
const DEFAULT_VISIBLE_HEIGHT_RATIO = 0.39;
const DEFAULT_VISIBLE_WIDTH_RATIO = 0.72;
const DEFAULT_LOOK_AT_HEIGHT_RATIO = 0.8;
const DEFAULT_LOOK_AT_RAISE_RATIO = 0.045;
const DEFAULT_CAMERA_HEIGHT_OFFSET_RATIO = 0.0;
const DEFAULT_MIN_DISTANCE_RATIO = 0.9;
const DEFAULT_MAX_DISTANCE_RATIO = 1.32;
const DEFAULT_MODEL_X_OFFSET = 0.0;
const DEFAULT_MODEL_Y_ROTATION = -0.12;

type LegacyRuntimeEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'relaxed';

function mapAssistantStringToLegacyRuntime(
  raw: string | undefined | null,
): LegacyRuntimeEmotion {
  if (raw == null) return 'neutral';
  const e = raw.trim().toLowerCase();
  if (!e || e === 'neutral') return 'neutral';
  if (e === 'happy' || e === 'joy') return 'happy';
  if (e === 'sad' || e === 'sorrow') return 'sad';
  if (e === 'angry' || e === 'rage') return 'angry';
  if (e === 'surprised' || e === 'surprise') return 'surprised';
  if (e === 'relaxed') return 'relaxed';
  return 'neutral';
}

const MOBILE_BG_HEX = 0x111827;

const VRM_BG_HEX: Record<VrmChromaBgMode, number> = {
  /** Chroma green (鮮やか・キーしやすい) */
  green: 0x00ff00,
  /** Chroma blue */
  blue: 0x0000ff,
  /** Chroma purple / magenta寄り */
  purple: 0xff00ff,
};

function orbitStorageKey(): string {
  const mode = new URLSearchParams(window.location.search).get('window') ?? 'combined';
  return `react-vrm-orbit-camera-v1:${mode}`;
}

type OrbitPersistV1 = {
  version: 1;
  position: [number, number, number];
  target: [number, number, number];
};

export function AvatarBackground({
  mouthLevel,
  isSpeaking,
  useDarkStudioBackground,
  vrmChromaBg,
  vrmLighting,
  vrmExpressionBlend,
  vrmEmotionTunes: _vrmEmotionTunes,
  vrmLegacyExpression,
  assistantEmotion,
}: AvatarBackgroundProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const sceneBgHexRef = useRef<number>(MOBILE_BG_HEX);
  const vrmChromaBgRef = useRef<VrmChromaBgMode>(vrmChromaBg);
  const useDarkStudioBgRef = useRef(useDarkStudioBackground);
  const vrmRef = useRef<VRM | null>(null);
  const targetMouthWeightRef = useRef(0);
  const mouthWeightRef = useRef(0);
  const assistantEmotionRef = useRef<string | undefined>(undefined);
  const vrmLightingRef = useRef<VrmLightingSettings>(vrmLighting);
  const vrmExpressionBlendRef = useRef<VrmExpressionBlendSettings>(vrmExpressionBlend);
  const isSpeakingRef = useRef(isSpeaking);
  const emotionRef = useRef<LegacyRuntimeEmotion>('neutral');
  const emotionExpireAtRef = useRef(0);
  const emotionAutoNeutralSecondsRef = useRef(
    vrmLegacyExpression.emotionAutoNeutralSeconds,
  );
  const blinkPolicyRef = useRef({
    neutral: vrmLegacyExpression.blinkWhileNeutral,
    happy: vrmLegacyExpression.blinkWhileHappy,
    sad: vrmLegacyExpression.blinkWhileSad,
    angry: vrmLegacyExpression.blinkWhileAngry,
    surprised: vrmLegacyExpression.blinkWhileSurprised,
    relaxed: vrmLegacyExpression.blinkWhileRelaxed,
  });
  const blinkIntensityRef = useRef({
    neutral: vrmLegacyExpression.blinkIntensityNeutral,
    happy: vrmLegacyExpression.blinkIntensityHappy,
    sad: vrmLegacyExpression.blinkIntensitySad,
    angry: vrmLegacyExpression.blinkIntensityAngry,
    surprised: vrmLegacyExpression.blinkIntensitySurprised,
    relaxed: vrmLegacyExpression.blinkIntensityRelaxed,
  });
  const blinkElapsedRef = useRef(0);
  const nextBlinkInRef = useRef(
    BLINK_INTERVAL_MIN_SECONDS
    + Math.random() * (BLINK_INTERVAL_MAX_SECONDS - BLINK_INTERVAL_MIN_SECONDS),
  );
  const targetHappyWeightRef = useRef(0);
  const targetSadWeightRef = useRef(0);
  const targetAngryWeightRef = useRef(0);
  const targetSurprisedWeightRef = useRef(0);
  const targetRelaxedWeightRef = useRef(0);
  const happyWeightRef = useRef(0);
  const sadWeightRef = useRef(0);
  const angryWeightRef = useRef(0);
  const surprisedWeightRef = useRef(0);
  const relaxedWeightRef = useRef(0);
  const previewEmotionRef = useRef<string | null>(null);
  const previewUntilRef = useRef(0);
  const ambientLightRef = useRef<AmbientLight | null>(null);
  const directionalLightRef = useRef<DirectionalLight | null>(null);
  const [vrmUrl, setVrmUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const syncEmotionFromExternal = useCallback(() => {
    const now = performance.now();
    let raw: string | undefined = assistantEmotionRef.current;
    if (
      previewEmotionRef.current != null
      && now < previewUntilRef.current
    ) {
      raw = previewEmotionRef.current ?? undefined;
    }
    const active = mapAssistantStringToLegacyRuntime(raw);
    emotionRef.current = active;
    targetHappyWeightRef.current = active === 'happy' ? 1 : 0;
    targetSadWeightRef.current = active === 'sad' ? 1 : 0;
    targetAngryWeightRef.current = active === 'angry' ? 1 : 0;
    targetSurprisedWeightRef.current = active === 'surprised' ? 1 : 0;
    targetRelaxedWeightRef.current = active === 'relaxed' ? 1 : 0;
    const isPreview =
      previewEmotionRef.current != null && now < previewUntilRef.current;
    const holdSec = emotionAutoNeutralSecondsRef.current;
    const holdMs = Math.max(0, holdSec) * 1000;
    if (!isPreview && active !== 'neutral' && holdMs > 0) {
      emotionExpireAtRef.current = Date.now() + holdMs;
    } else {
      emotionExpireAtRef.current = 0;
    }
  }, []);

  useEffect(() => {
    emotionAutoNeutralSecondsRef.current =
      vrmLegacyExpression.emotionAutoNeutralSeconds;
    blinkPolicyRef.current = {
      neutral: vrmLegacyExpression.blinkWhileNeutral,
      happy: vrmLegacyExpression.blinkWhileHappy,
      sad: vrmLegacyExpression.blinkWhileSad,
      angry: vrmLegacyExpression.blinkWhileAngry,
      surprised: vrmLegacyExpression.blinkWhileSurprised,
      relaxed: vrmLegacyExpression.blinkWhileRelaxed,
    };
    blinkIntensityRef.current = {
      neutral: vrmLegacyExpression.blinkIntensityNeutral,
      happy: vrmLegacyExpression.blinkIntensityHappy,
      sad: vrmLegacyExpression.blinkIntensitySad,
      angry: vrmLegacyExpression.blinkIntensityAngry,
      surprised: vrmLegacyExpression.blinkIntensitySurprised,
      relaxed: vrmLegacyExpression.blinkIntensityRelaxed,
    };
  }, [vrmLegacyExpression]);

  useEffect(() => {
    assistantEmotionRef.current = assistantEmotion;
    syncEmotionFromExternal();
  }, [assistantEmotion, syncEmotionFromExternal]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    vrmExpressionBlendRef.current = vrmExpressionBlend;
  }, [vrmExpressionBlend]);

  useLayoutEffect(() => {
    vrmChromaBgRef.current = vrmChromaBg;
    useDarkStudioBgRef.current = useDarkStudioBackground;
  }, [vrmChromaBg, useDarkStudioBackground]);

  useLayoutEffect(() => {
    vrmLightingRef.current = vrmLighting;
    const ambient = ambientLightRef.current;
    const directional = directionalLightRef.current;
    if (ambient) {
      ambient.intensity = vrmLighting.ambientIntensity;
    }
    if (directional) {
      directional.intensity = vrmLighting.directionalIntensity;
      directional.position.set(
        vrmLighting.directionalLightX,
        vrmLighting.directionalLightY,
        vrmLighting.directionalLightZ,
      );
    }
  }, [vrmLighting]);

  const targetWeight = useMemo(() => {
    if (!isSpeaking) return 0;
    const normalized = mouthLevel / MAX_MOUTH_LEVEL;
    const scaled = normalized * vrmLegacyExpression.mouthSensitivity;
    return Math.min(Math.max(scaled, 0), 1);
  }, [isSpeaking, mouthLevel, vrmLegacyExpression.mouthSensitivity]);

  useEffect(() => {
    targetMouthWeightRef.current = targetWeight;
  }, [targetWeight]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buf = await loadStoredVrmBuffer();
        if (cancelled) return;
        if (buf && buf.byteLength > 0) {
          const url = URL.createObjectURL(new Blob([buf]));
          setVrmUrl(url);
        } else {
          setVrmUrl(VRM_FILE_URL);
        }
      } catch {
        if (!cancelled) setVrmUrl(VRM_FILE_URL);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const url = vrmUrl;
    return () => {
      if (url?.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    };
  }, [vrmUrl]);

  useEffect(() => {
    const onPreview = (ev: Event) => {
      const ce = ev as CustomEvent<VrmEmotionPreviewEventDetail>;
      const d = ce.detail;
      if (!d) return;
      if (d.emotion == null || d.emotion === '') {
        previewEmotionRef.current = null;
        previewUntilRef.current = 0;
      } else {
        previewEmotionRef.current = d.emotion;
        previewUntilRef.current =
          performance.now() + (d.durationMs ?? 12_000);
      }
      syncEmotionFromExternal();
    };
    window.addEventListener(
      VRM_EMOTION_PREVIEW_EVENT,
      onPreview as EventListener,
    );
    return () => {
      window.removeEventListener(
        VRM_EMOTION_PREVIEW_EVENT,
        onPreview as EventListener,
      );
    };
  }, [syncEmotionFromExternal]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !vrmUrl) return;

    setIsLoading(true);
    setLoadError(null);

    const scene = new Scene();
    const initialBgHex = useDarkStudioBackground
      ? MOBILE_BG_HEX
      : VRM_BG_HEX[vrmChromaBg];
    scene.background = new Color(initialBgHex);
    sceneRef.current = scene;

    const camera = new PerspectiveCamera(30, 1, 0.1, 30);
    camera.position.set(0, 1.35, 2.2);

    const ambientLight = new AmbientLight(
      0xffffff,
      vrmLightingRef.current.ambientIntensity,
    );
    const directionalLight = new DirectionalLight(
      0xffffff,
      vrmLightingRef.current.directionalIntensity,
    );
    directionalLight.position.set(
      vrmLightingRef.current.directionalLightX,
      vrmLightingRef.current.directionalLightY,
      vrmLightingRef.current.directionalLightZ,
    );
    ambientLightRef.current = ambientLight;
    directionalLightRef.current = directionalLight;
    scene.add(ambientLight);
    scene.add(directionalLight);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      console.error('Failed to initialize WebGLRenderer:', error);
      sceneRef.current = null;
      window.setTimeout(() => {
        setLoadError('WebGLの初期化に失敗しました。');
        setIsLoading(false);
      }, 0);
      return;
    }

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.touchAction = 'none';
    sceneBgHexRef.current = initialBgHex;
    rendererRef.current = renderer;
    renderer.setClearColor(initialBgHex, 1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.mouseButtons = {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.65;
    controls.screenSpacePanning = true;
    controls.minPolarAngle = (Math.PI * 0.2);
    controls.maxPolarAngle = (Math.PI * 0.55);
    controls.target.set(0, 1.1, 0);
    controls.update();

    const defaultCameraPosition = camera.position.clone();
    const defaultTarget = controls.target.clone();

    const resetCamera = () => {
      camera.position.copy(defaultCameraPosition);
      controls.target.copy(defaultTarget);
      controls.update();
    };

    const setDraggingCursor = () => {
      canvas.classList.add('is-dragging');
    };
    const clearDraggingCursor = () => {
      canvas.classList.remove('is-dragging');
    };

    canvas.addEventListener('dblclick', resetCamera);
    canvas.addEventListener('pointerdown', setDraggingCursor);
    canvas.addEventListener('pointerup', clearDraggingCursor);
    canvas.addEventListener('pointerleave', clearDraggingCursor);
    canvas.addEventListener('pointercancel', clearDraggingCursor);
    const preventCanvasContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    canvas.addEventListener('contextmenu', preventCanvasContextMenu);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let disposed = false;
    let animationFrameId = 0;
    let loadedVrm: VRM | null = null;
    let mixer: AnimationMixer | null = null;
    let orbitPersistTimer = 0;
    let detachOrbitPersist: (() => void) | null = null;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      vrmUrl,
      (gltf) => {
        if (disposed) return;
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          setLoadError('VRMモデルの読み込みに失敗しました。');
          setIsLoading(false);
          return;
        }

        VRMUtils.rotateVRM0(vrm);

        const bounds = new Box3().setFromObject(vrm.scene);
        const size = bounds.getSize(new Vector3());
        const center = bounds.getCenter(new Vector3());

        vrm.scene.position.x -= center.x;
        vrm.scene.position.z -= center.z;
        vrm.scene.position.y -= bounds.min.y;
        vrm.scene.position.x += DEFAULT_MODEL_X_OFFSET;
        vrm.scene.rotation.y += DEFAULT_MODEL_Y_ROTATION;

        const modelHeight = Math.max(size.y, 1.0);
        const modelWidth = Math.max(size.x, 0.6);
        const verticalFov = (camera.fov * Math.PI) / 180;
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
        const visibleHeight = modelHeight * DEFAULT_VISIBLE_HEIGHT_RATIO;
        const visibleWidth = modelWidth * DEFAULT_VISIBLE_WIDTH_RATIO;
        const distanceByHeight = visibleHeight / (2 * Math.tan(verticalFov / 2));
        const distanceByWidth = visibleWidth / (2 * Math.tan(horizontalFov / 2));
        const distance = Math.max(distanceByHeight, distanceByWidth);
        const lookAtY = Math.max(
          0.9,
          modelHeight * (DEFAULT_LOOK_AT_HEIGHT_RATIO + DEFAULT_LOOK_AT_RAISE_RATIO),
        );
        const lookAtX = DEFAULT_MODEL_X_OFFSET;
        const cameraY = lookAtY + modelHeight * DEFAULT_CAMERA_HEIGHT_OFFSET_RATIO;

        camera.position.set(lookAtX, cameraY, distance);
        controls.target.set(lookAtX, lookAtY, 0);
        controls.minDistance = Math.max(0.7, distance * DEFAULT_MIN_DISTANCE_RATIO);
        controls.maxDistance = Math.max(2.5, distance * DEFAULT_MAX_DISTANCE_RATIO);
        camera.near = 0.01;
        camera.far = Math.max(50, distance * 20);
        camera.updateProjectionMatrix();
        controls.update();

        defaultCameraPosition.copy(camera.position);
        defaultTarget.copy(controls.target);

        try {
          const raw = localStorage.getItem(orbitStorageKey());
          if (raw) {
            const parsed = JSON.parse(raw) as Partial<OrbitPersistV1>;
            if (
              parsed?.version === 1 &&
              Array.isArray(parsed.position) &&
              parsed.position.length === 3 &&
              Array.isArray(parsed.target) &&
              parsed.target.length === 3
            ) {
              const [px, py, pz] = parsed.position.map(Number);
              const [tx, ty, tz] = parsed.target.map(Number);
              if ([px, py, pz, tx, ty, tz].every((n) => Number.isFinite(n))) {
                camera.position.set(px, py, pz);
                controls.target.set(tx, ty, tz);
                controls.update();
              }
            }
          }
        } catch {
          // ignore invalid saved state
        }

        const persistOrbit = () => {
          window.clearTimeout(orbitPersistTimer);
          orbitPersistTimer = window.setTimeout(() => {
            if (disposed) return;
            try {
              const payload: OrbitPersistV1 = {
                version: 1,
                position: [
                  camera.position.x,
                  camera.position.y,
                  camera.position.z,
                ],
                target: [
                  controls.target.x,
                  controls.target.y,
                  controls.target.z,
                ],
              };
              localStorage.setItem(orbitStorageKey(), JSON.stringify(payload));
            } catch {
              // ignore quota / private mode
            }
          }, 320);
        };

        detachOrbitPersist?.();
        detachOrbitPersist = () => {
          controls.removeEventListener('change', persistOrbit);
          window.clearTimeout(orbitPersistTimer);
        };
        controls.addEventListener('change', persistOrbit);

        scene.add(vrm.scene);
        loadedVrm = vrm;
        vrmRef.current = vrm;
        setIsLoading(false);

        const animationLoader = new GLTFLoader();
        animationLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
        animationLoader.load(
          VRMA_FILE_URL,
          (animationGltf) => {
            if (disposed) return;
            const vrmAnimations = animationGltf.userData.vrmAnimations as
              | VRMAnimation[]
              | undefined;
            const idleAnimation = vrmAnimations?.[0];
            if (!idleAnimation) {
              console.warn('VRM animation is missing:', VRMA_FILE_URL);
              return;
            }
            const idleClip = createVRMAnimationClip(
              idleAnimation,
              vrm as unknown as Parameters<typeof createVRMAnimationClip>[1],
            );
            const hipsNodeName = vrm.humanoid.getNormalizedBoneNode('hips')?.name;
            const stabilizedTracks = hipsNodeName
              ? idleClip.tracks.filter((track) => track.name !== `${hipsNodeName}.position`)
              : idleClip.tracks;
            const stabilizedClip = new AnimationClip(
              idleClip.name,
              idleClip.duration,
              stabilizedTracks,
            );
            mixer = new AnimationMixer(vrm.scene);
            const action = mixer.clipAction(stabilizedClip);
            action.setLoop(LoopRepeat, Infinity);
            action.play();
          },
          undefined,
          (error) => {
            if (disposed) return;
            console.warn('Failed to load VRMA:', error);
          },
        );
      },
      undefined,
      (error) => {
        if (disposed) return;
        console.error('Failed to load VRM:', error);
        setLoadError('VRMモデルを読み込めませんでした。');
        setIsLoading(false);
      },
    );

    let lastAppliedSceneBgHex = -1;

    const clock = new Clock();
    const animate = () => {
      if (disposed) return;

      if (
        typeof document !== 'undefined'
        && document.visibilityState !== 'visible'
      ) {
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      const delta = clock.getDelta();
      const vrm = vrmRef.current;
      if (vrm) {
        mixer?.update(delta);

        const nowPerf = performance.now();
        if (
          previewEmotionRef.current !== null
          && nowPerf >= previewUntilRef.current
        ) {
          previewEmotionRef.current = null;
          syncEmotionFromExternal();
        }

        const holdMs =
          Math.max(0, emotionAutoNeutralSecondsRef.current) * 1000;
        const inPreview =
          previewEmotionRef.current !== null
          && nowPerf < previewUntilRef.current;
        if (
          holdMs > 0
          && !inPreview
          && emotionRef.current !== 'neutral'
          && emotionExpireAtRef.current > 0
          && Date.now() >= emotionExpireAtRef.current
        ) {
          emotionRef.current = 'neutral';
          targetHappyWeightRef.current = 0;
          targetSadWeightRef.current = 0;
          targetAngryWeightRef.current = 0;
          targetSurprisedWeightRef.current = 0;
          targetRelaxedWeightRef.current = 0;
          emotionExpireAtRef.current = 0;
        }

        const currentEmotion = emotionRef.current;
        const bi = blinkIntensityRef.current;
        const bp = blinkPolicyRef.current;
        const blinkIntensity =
          currentEmotion === 'happy'
            ? bi.happy
            : currentEmotion === 'sad'
              ? bi.sad
              : currentEmotion === 'angry'
                ? bi.angry
                : currentEmotion === 'surprised'
                  ? bi.surprised
                  : currentEmotion === 'relaxed'
                    ? bi.relaxed
                    : bi.neutral;
        const allowBlink =
          currentEmotion === 'happy'
            ? bp.happy
            : currentEmotion === 'sad'
              ? bp.sad
              : currentEmotion === 'angry'
                ? bp.angry
                : currentEmotion === 'surprised'
                  ? bp.surprised
                  : currentEmotion === 'relaxed'
                    ? bp.relaxed
                    : bp.neutral;

        let blinkWeight = 0;
        if (allowBlink) {
          blinkElapsedRef.current += delta;
          if (blinkElapsedRef.current >= nextBlinkInRef.current) {
            const phase =
              (blinkElapsedRef.current - nextBlinkInRef.current)
              / BLINK_DURATION_SECONDS;
            if (phase <= 1) {
              blinkWeight = phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
            } else {
              blinkElapsedRef.current = 0;
              nextBlinkInRef.current =
                BLINK_INTERVAL_MIN_SECONDS
                + Math.random()
                  * (BLINK_INTERVAL_MAX_SECONDS - BLINK_INTERVAL_MIN_SECONDS);
            }
          }
        } else {
          blinkElapsedRef.current = 0;
        }
        blinkWeight = Math.min(1, Math.max(0, blinkWeight * blinkIntensity));

        const blend = vrmExpressionBlendRef.current;
        const nextWeight = mouthWeightRef.current
          + (targetMouthWeightRef.current - mouthWeightRef.current)
            * blend.mouthBlendSpeed;
        mouthWeightRef.current = nextWeight;

        const k = LEGACY_FACE_BLEND;
        const nextHappy = happyWeightRef.current
          + (targetHappyWeightRef.current - happyWeightRef.current) * k;
        happyWeightRef.current = nextHappy;
        const nextSad = sadWeightRef.current
          + (targetSadWeightRef.current - sadWeightRef.current) * k;
        sadWeightRef.current = nextSad;
        const nextAngry = angryWeightRef.current
          + (targetAngryWeightRef.current - angryWeightRef.current) * k;
        angryWeightRef.current = nextAngry;
        const nextSurprised = surprisedWeightRef.current
          + (targetSurprisedWeightRef.current - surprisedWeightRef.current) * k;
        surprisedWeightRef.current = nextSurprised;
        const nextRelaxed = relaxedWeightRef.current
          + (targetRelaxedWeightRef.current - relaxedWeightRef.current) * k;
        relaxedWeightRef.current = nextRelaxed;

        const expressionManager = vrm.expressionManager;
        if (expressionManager) {
          expressionManager.setValue(VRMExpressionPresetName.Blink, blinkWeight);
          expressionManager.setValue(VRMExpressionPresetName.Aa, nextWeight);
          expressionManager.setValue(VRMExpressionPresetName.Happy, nextHappy);
          expressionManager.setValue(VRMExpressionPresetName.Sad, nextSad);
          expressionManager.setValue(VRMExpressionPresetName.Angry, nextAngry);
          expressionManager.setValue(
            VRMExpressionPresetName.Surprised,
            nextSurprised,
          );
          expressionManager.setValue(
            VRMExpressionPresetName.Relaxed,
            nextRelaxed,
          );
        }

        vrm.update(delta);
      } else {
        mixer?.update(delta);
      }

      controls.update();

      const bgHex = useDarkStudioBgRef.current
        ? MOBILE_BG_HEX
        : VRM_BG_HEX[vrmChromaBgRef.current];
      if (bgHex !== lastAppliedSceneBgHex) {
        lastAppliedSceneBgHex = bgHex;
        sceneBgHexRef.current = bgHex;
        scene.background = new Color(bgHex);
        renderer.setClearColor(bgHex, 1);
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();

      detachOrbitPersist?.();
      detachOrbitPersist = null;

      if (loadedVrm) {
        scene.remove(loadedVrm.scene);
        VRMUtils.deepDispose(loadedVrm.scene);
      }
      canvas.removeEventListener('dblclick', resetCamera);
      canvas.removeEventListener('pointerdown', setDraggingCursor);
      canvas.removeEventListener('pointerup', clearDraggingCursor);
      canvas.removeEventListener('pointerleave', clearDraggingCursor);
      canvas.removeEventListener('pointercancel', clearDraggingCursor);
      canvas.removeEventListener('contextmenu', preventCanvasContextMenu);
      controls.dispose();
      if (mixer) {
        mixer.stopAllAction();
        if (loadedVrm) {
          mixer.uncacheRoot(loadedVrm.scene);
        }
        mixer = null;
      }
      vrmRef.current = null;
      mouthWeightRef.current = 0;
      targetMouthWeightRef.current = 0;
      blinkElapsedRef.current = 0;
      happyWeightRef.current = 0;
      targetHappyWeightRef.current = 0;
      sadWeightRef.current = 0;
      targetSadWeightRef.current = 0;
      angryWeightRef.current = 0;
      targetAngryWeightRef.current = 0;
      surprisedWeightRef.current = 0;
      targetSurprisedWeightRef.current = 0;
      relaxedWeightRef.current = 0;
      targetRelaxedWeightRef.current = 0;
      ambientLightRef.current = null;
      directionalLightRef.current = null;
      rendererRef.current = null;
      renderer.dispose();
      sceneRef.current = null;
    };
    // vrmUrl 変更でシーン再構築。表情同期は ref 経由。
  }, [vrmUrl, syncEmotionFromExternal]);

  useEffect(() => {
    const handleVrmControl = async (e: Event) => {
      const custom = e as CustomEvent<{ action?: 'reload' | 'bundled' }>;
      const action = custom.detail?.action ?? 'reload';
      if (action === 'bundled') {
        await clearStoredVrm();
        setVrmUrl((prev) => {
          if (prev?.startsWith('blob:')) {
            URL.revokeObjectURL(prev);
          }
          return VRM_FILE_URL;
        });
        return;
      }
      const buf = await loadStoredVrmBuffer();
      if (buf && buf.byteLength > 0) {
        const url = URL.createObjectURL(new Blob([buf]));
        setVrmUrl((prev) => {
          if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
          return url;
        });
      }
    };
    window.addEventListener(VRM_CONTROL_EVENT, handleVrmControl as EventListener);
    return () => {
      window.removeEventListener(VRM_CONTROL_EVENT, handleVrmControl as EventListener);
    };
  }, []);

  return (
    <div className="avatar-background">
      <div className="vrm-stage" ref={containerRef}>
        <canvas ref={canvasRef} className="vrm-canvas" />
        {isLoading && !loadError && (
          <div className="avatar-status">VRMモデルを読み込み中...</div>
        )}
        {loadError && <div className="avatar-error">{loadError}</div>}
      </div>
    </div>
  );
}
