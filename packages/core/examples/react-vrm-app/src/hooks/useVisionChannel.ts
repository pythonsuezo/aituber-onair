import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  VISION_CHANNEL,
  type VisionChannelMessage,
} from '../windowMode';

/**
 * BroadcastChannel must be recreated after StrictMode / effect cleanup closes it.
 * Do not cache the channel instance in useMemo (StrictMode leaves a closed handle).
 */
export function useVisionChannelSender() {
  const bcRef = useRef<BroadcastChannel | null>(null);

  const getOrCreate = useMemo(
    () => () => {
      if (typeof BroadcastChannel === 'undefined') {
        return null;
      }
      if (!bcRef.current) {
        bcRef.current = new BroadcastChannel(VISION_CHANNEL);
      }
      return bcRef.current;
    },
    [],
  );

  useEffect(() => {
    getOrCreate();
    return () => {
      bcRef.current?.close();
      bcRef.current = null;
    };
  }, [getOrCreate]);

  return useCallback((msg: VisionChannelMessage) => {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    try {
      getOrCreate()?.postMessage(msg);
    } catch {
      try {
        bcRef.current?.close();
      } catch {
        // ignore
      }
      bcRef.current = new BroadcastChannel(VISION_CHANNEL);
      bcRef.current.postMessage(msg);
    }
  }, [getOrCreate]);
}

export function useVisionChannelReceiver(
  onMessage: (msg: VisionChannelMessage) => void | Promise<void>,
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    const bc = new BroadcastChannel(VISION_CHANNEL);
    bc.onmessage = (ev: MessageEvent<VisionChannelMessage>) => {
      void Promise.resolve(onMessageRef.current(ev.data));
    };
    return () => {
      bc.onmessage = null;
      bc.close();
    };
  }, []);
}
