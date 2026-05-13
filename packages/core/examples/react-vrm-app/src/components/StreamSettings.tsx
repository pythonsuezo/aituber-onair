import type {
  StreamSettings,
  StreamingPlatformOption,
} from '../types/settings';

const STREAM_INTERVAL_OPTIONS = [5000, 10000, 20000, 30000, 60000] as const;

interface StreamSettingsProps {
  stream: StreamSettings;
  disabled: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  streamErrorMessage?: string;
  updateStreamPlatform: (platform: StreamingPlatformOption) => void;
  updateYoutubeApiKey: (value: string) => void;
  updateYoutubeLiveId: (value: string) => void;
  updateYoutubeEnabled: (value: boolean) => void;
  updateYoutubeCommentIntervalMs: (value: number) => void;
  updateTwitchClientId: (value: string) => void;
  updateTwitchAccessToken: (value: string) => void;
  updateTwitchChannel: (value: string) => void;
  updateTwitchEnabled: (value: boolean) => void;
  updateTwitchCommentIntervalMs: (value: number) => void;
  updateJikkyoTcpEnabled: (value: boolean) => void;
  updateJikkyoListenPort: (value: number) => void;
  updateJikkyoBouyomiPort: (value: number) => void;
  updateJikkyoForwardToBouyomi: (value: boolean) => void;
  updateJikkyoSendToAi: (value: boolean) => void;
  updateJikkyoAiHeaderEnabled: (value: boolean) => void;
  updateJikkyoAiHeaderText: (value: string) => void;
}

function getTwitchRedirectUri(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URL(window.location.pathname, window.location.origin).toString();
}

export function StreamSettings({
  stream,
  disabled,
  isExpanded,
  onToggleExpand,
  streamErrorMessage,
  updateStreamPlatform,
  updateYoutubeApiKey,
  updateYoutubeLiveId,
  updateYoutubeEnabled,
  updateYoutubeCommentIntervalMs,
  updateTwitchClientId,
  updateTwitchAccessToken,
  updateTwitchChannel,
  updateTwitchEnabled,
  updateTwitchCommentIntervalMs,
  updateJikkyoTcpEnabled,
  updateJikkyoListenPort,
  updateJikkyoBouyomiPort,
  updateJikkyoForwardToBouyomi,
  updateJikkyoSendToAi,
  updateJikkyoAiHeaderEnabled,
  updateJikkyoAiHeaderText,
}: StreamSettingsProps) {
  const twitchRedirectUri = getTwitchRedirectUri();
  const isYoutubeSelected = stream.platform === 'youtube';
  const isTwitchSelected = stream.platform === 'twitch';
  const isTwitchReady =
    !!stream.twitchAccessToken &&
    !!stream.twitchChannel.trim() &&
    !!stream.twitchClientId.trim();

  const handleConnectTwitch = () => {
    try {
      const state = window.crypto.randomUUID();
      sessionStorage.setItem('twitchOauthState', state);

      const params = new URLSearchParams({
        client_id: stream.twitchClientId,
        redirect_uri: twitchRedirectUri,
        response_type: 'token',
        scope: 'user:read:chat',
        state,
      });

      window.location.assign(
        `https://id.twitch.tv/oauth2/authorize?${params.toString()}`,
      );
    } catch (error) {
      console.error('Failed to start Twitch OAuth:', error);
    }
  };

  return (
    <div className="settings-section">
      <button
        type="button"
        className="settings-section-toggle"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
      >
        <h3>Stream</h3>
        <span
          className={`settings-section-chevron${isExpanded ? ' is-open' : ''}`}
        >
          ⌄
        </span>
      </button>

      {isExpanded && (
        <>
          <div className="settings-field">
            <label htmlFor="stream-platform">Platform</label>
            <select
              id="stream-platform"
              value={stream.platform}
              onChange={(event) =>
                updateStreamPlatform(
                  event.target.value as StreamingPlatformOption,
                )
              }
              disabled={disabled}
            >
              <option value="none">None</option>
              <option value="youtube">YouTube</option>
              <option value="twitch">Twitch</option>
            </select>
          </div>

          {isYoutubeSelected && (
            <>
              <div className="settings-field">
                <label htmlFor="stream-youtube-apikey">YouTube API Key</label>
                <input
                  id="stream-youtube-apikey"
                  type="password"
                  value={stream.youtubeApiKey}
                  onChange={(event) => updateYoutubeApiKey(event.target.value)}
                  placeholder="YouTube Data API v3 key"
                  disabled={disabled}
                />
              </div>

              <div className="settings-field">
                <label htmlFor="stream-youtube-liveid">
                  YouTube Live Video ID
                </label>
                <input
                  id="stream-youtube-liveid"
                  type="text"
                  value={stream.youtubeLiveId}
                  onChange={(event) => updateYoutubeLiveId(event.target.value)}
                  placeholder="YouTube live video ID"
                  disabled={disabled}
                />
                <p className="settings-field-hint">
                  Use the <code>v=</code> value from the YouTube Live URL.
                </p>
              </div>

              <div className="settings-field">
                <label htmlFor="stream-youtube-interval">Polling Interval</label>
                <select
                  id="stream-youtube-interval"
                  value={stream.youtubeCommentIntervalMs}
                  onChange={(event) =>
                    updateYoutubeCommentIntervalMs(Number(event.target.value))
                  }
                  disabled={disabled}
                >
                  {STREAM_INTERVAL_OPTIONS.map((intervalMs) => (
                    <option key={intervalMs} value={intervalMs}>
                      {intervalMs.toLocaleString()} ms
                    </option>
                  ))}
                </select>
              </div>

              <div className="settings-field">
                <label htmlFor="stream-youtube-enabled">
                  <input
                    id="stream-youtube-enabled"
                    type="checkbox"
                    checked={stream.youtubeEnabled}
                    onChange={(event) =>
                      updateYoutubeEnabled(event.target.checked)
                    }
                    disabled={disabled}
                    style={{ marginRight: 8 }}
                  />
                  Enable
                </label>
              </div>
            </>
          )}

          {isTwitchSelected && (
            <>
              <div className="settings-field">
                <label htmlFor="stream-twitch-clientid">Twitch Client ID</label>
                <input
                  id="stream-twitch-clientid"
                  type="password"
                  value={stream.twitchClientId}
                  onChange={(event) => updateTwitchClientId(event.target.value)}
                  placeholder="Twitch Client ID"
                  disabled={disabled}
                />
              </div>

              <div className="settings-field">
                <label>Twitch Connection</label>
                {stream.twitchAccessToken ? (
                  <div className="settings-file-actions">
                    <span className="settings-file-status">Connected</span>
                    <button
                      type="button"
                      className="settings-clear-button"
                      onClick={() => {
                        updateTwitchAccessToken('');
                        updateTwitchEnabled(false);
                      }}
                      disabled={disabled}
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="settings-file-trigger"
                    onClick={handleConnectTwitch}
                    disabled={disabled || !stream.twitchClientId.trim()}
                  >
                    Connect to Twitch
                  </button>
                )}
                <p className="settings-field-hint">
                  Register this URL in Twitch Developer Console as an OAuth
                  Redirect URL.
                </p>
                <p className="settings-field-hint">{twitchRedirectUri}</p>
              </div>

              <div className="settings-field">
                <label htmlFor="stream-twitch-channel">
                  Twitch Channel (login name)
                </label>
                <input
                  id="stream-twitch-channel"
                  type="text"
                  value={stream.twitchChannel}
                  onChange={(event) => updateTwitchChannel(event.target.value)}
                  placeholder="example_channel"
                  disabled={disabled}
                />
              </div>

              <div className="settings-field">
                <label htmlFor="stream-twitch-interval">Dequeue Interval</label>
                <select
                  id="stream-twitch-interval"
                  value={stream.twitchCommentIntervalMs}
                  onChange={(event) =>
                    updateTwitchCommentIntervalMs(Number(event.target.value))
                  }
                  disabled={disabled}
                >
                  {STREAM_INTERVAL_OPTIONS.map((intervalMs) => (
                    <option key={intervalMs} value={intervalMs}>
                      {intervalMs.toLocaleString()} ms
                    </option>
                  ))}
                </select>
                <p className="settings-field-hint">
                  One queued Twitch message is forwarded per interval.
                </p>
              </div>

              <div className="settings-field">
                <label htmlFor="stream-twitch-enabled">
                  <input
                    id="stream-twitch-enabled"
                    type="checkbox"
                    checked={stream.twitchEnabled}
                    onChange={(event) =>
                      updateTwitchEnabled(event.target.checked)
                    }
                    disabled={disabled || !isTwitchReady}
                    style={{ marginRight: 8 }}
                  />
                  Enable
                </label>
              </div>
            </>
          )}

          {streamErrorMessage ? (
            <p className="settings-field-error">{streamErrorMessage}</p>
          ) : null}

          <div className="settings-field">
            <label htmlFor="stream-jikkyo-enabled">
              <input
                id="stream-jikkyo-enabled"
                type="checkbox"
                checked={stream.jikkyoTcpEnabled}
                onChange={(event) =>
                  updateJikkyoTcpEnabled(event.target.checked)
                }
                disabled={disabled}
                style={{ marginRight: 8 }}
              />
              実況掲示板TCP受信を有効化
            </label>
            <p className="settings-field-hint">
              受信: TCP {stream.jikkyoListenPort}（例: 50000）
            </p>
          </div>

          <div className="settings-field">
            <label htmlFor="stream-jikkyo-listen-port">受信ポート</label>
            <input
              id="stream-jikkyo-listen-port"
              type="number"
              min={1}
              max={65535}
              value={stream.jikkyoListenPort}
              onChange={(event) =>
                updateJikkyoListenPort(Number(event.target.value || 0))
              }
              disabled={disabled}
            />
          </div>

          <div className="settings-field">
            <label htmlFor="stream-jikkyo-bouyomi-port">
              棒読みちゃん送信ポート
            </label>
            <input
              id="stream-jikkyo-bouyomi-port"
              type="number"
              min={1}
              max={65535}
              value={stream.jikkyoBouyomiPort}
              onChange={(event) =>
                updateJikkyoBouyomiPort(Number(event.target.value || 0))
              }
              disabled={disabled}
            />
          </div>

          <div className="settings-field">
            <label htmlFor="stream-jikkyo-forward-bouyomi">
              <input
                id="stream-jikkyo-forward-bouyomi"
                type="checkbox"
                checked={stream.jikkyoForwardToBouyomi}
                onChange={(event) =>
                  updateJikkyoForwardToBouyomi(event.target.checked)
                }
                disabled={disabled}
                style={{ marginRight: 8 }}
              />
              棒読みちゃん（TCP）へ転送
            </label>
          </div>

          <div className="settings-field">
            <label htmlFor="stream-jikkyo-send-ai">
              <input
                id="stream-jikkyo-send-ai"
                type="checkbox"
                checked={stream.jikkyoSendToAi}
                onChange={(event) => updateJikkyoSendToAi(event.target.checked)}
                disabled={disabled}
                style={{ marginRight: 8 }}
              />
              ヘッダー除去した本文をAIへ送る
            </label>
          </div>

          <div className="settings-field">
            <label htmlFor="stream-jikkyo-ai-header-enabled">
              <input
                id="stream-jikkyo-ai-header-enabled"
                type="checkbox"
                checked={stream.jikkyoAiHeaderEnabled}
                onChange={(event) =>
                  updateJikkyoAiHeaderEnabled(event.target.checked)
                }
                disabled={disabled}
                style={{ marginRight: 8 }}
              />
              AI送信時にヘッダを付ける
            </label>
          </div>

          <div className="settings-field">
            <label htmlFor="stream-jikkyo-ai-header-text">AI送信ヘッダ</label>
            <input
              id="stream-jikkyo-ai-header-text"
              type="text"
              value={stream.jikkyoAiHeaderText}
              onChange={(event) =>
                updateJikkyoAiHeaderText(event.target.value)
              }
              placeholder="掲示板："
              disabled={disabled || !stream.jikkyoAiHeaderEnabled}
            />
          </div>
        </>
      )}
    </div>
  );
}
