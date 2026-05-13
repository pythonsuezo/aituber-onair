type JikkyoMessagePayload = {
  raw: string;
  cleaned: string;
};

type JikkyoStatusPayload = {
  listening: boolean;
  port: number;
  error?: string;
};

type JikkyoTcpBridge = {
  updateConfig: (config: {
    enabled: boolean;
    listenPort: number;
    bouyomiPort: number;
    forwardToBouyomi: boolean;
  }) => Promise<{
    ok: boolean;
    listening: boolean;
    listenPort: number;
    bouyomiPort: number;
    forwardToBouyomi: boolean;
  }>;
  onMessage: (
    handler: (payload: JikkyoMessagePayload) => void,
  ) => (() => void) | void;
  onStatus: (
    handler: (payload: JikkyoStatusPayload) => void,
  ) => (() => void) | void;
};

declare global {
  interface Window {
    jikkyoTcp?: JikkyoTcpBridge;
  }
}

export {};
