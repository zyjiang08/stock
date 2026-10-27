import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { trpc } from '../lib/trpc';

type Props = {
  botConfigured: boolean;
  connectUrl: string | null;
  initiallyConnected: boolean;
  isAuthenticated: boolean;
  loading?: boolean;
  signInUrl: string | null;
  onConnected?: () => void;
  onDisconnected?: () => void;
};

type SubmitState =
  | { tone: 'idle'; message: string }
  | { tone: 'success'; message: string }
  | { tone: 'error'; message: string };

type ToastPosition = {
  left: number;
  top: number;
  width?: number;
  placement: 'side' | 'fallback' | 'mobile';
};

const readErrorMessage = async (res: Response, fallback: string): Promise<string> => {
  const body = await res.json().catch(() => ({}));
  return typeof body?.error === 'string' ? body.error : fallback;
};

export function TelegramConnectionControls({ botConfigured, connectUrl, initiallyConnected, isAuthenticated, loading = false, signInUrl, onConnected, onDisconnected }: Props) {
  const [isConnected, setIsConnected] = useState(initiallyConnected);
  const [pendingAction, setPendingAction] = useState<'sync' | 'test' | 'disconnect' | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({ tone: 'idle', message: '' });
  const [toastPosition, setToastPosition] = useState<ToastPosition | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!submitState.message) return undefined;

    const timer = window.setTimeout(() => {
      setSubmitState({ tone: 'idle', message: '' });
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [submitState]);

  useEffect(() => {
    setIsConnected(initiallyConnected);
  }, [initiallyConnected]);

  useEffect(() => {
    if (!submitState.message || !controlsRef.current) {
      setToastPosition(null);
      return undefined;
    }

    const updateToastPosition = () => {
      if (!controlsRef.current) return;

      const rect = controlsRef.current.getBoundingClientRect();
      const viewportPadding = 16;
      const toastWidth = Math.min(300, window.innerWidth - (viewportPadding * 2));

      if (window.innerWidth < 768) {
        setToastPosition({
          left: viewportPadding,
          top: Math.max(viewportPadding, window.innerHeight - 88),
          width: toastWidth,
          placement: 'mobile',
        });
        return;
      }

      const sideLeft = rect.right + 18;
      const sideTop = Math.max(viewportPadding, rect.top + 8);
      const canPlaceRight = window.innerWidth >= 980 && sideLeft + toastWidth <= window.innerWidth - viewportPadding;

      if (canPlaceRight) {
        setToastPosition({
          left: sideLeft,
          top: sideTop,
          width: toastWidth,
          placement: 'side',
        });
        return;
      }

      setToastPosition({
        left: Math.max(viewportPadding, window.innerWidth - Math.min(toastWidth, window.innerWidth - (viewportPadding * 2)) - viewportPadding),
        top: Math.max(viewportPadding, rect.bottom + 12),
        width: toastWidth,
        placement: 'fallback',
      });
    };

    updateToastPosition();
    window.addEventListener('resize', updateToastPosition);
    window.addEventListener('scroll', updateToastPosition, true);

    return () => {
      window.removeEventListener('resize', updateToastPosition);
      window.removeEventListener('scroll', updateToastPosition, true);
    };
  }, [submitState.message, isAuthenticated, isConnected, botConfigured]);

  const syncMutation = trpc.telegram.sync.useMutation();
  const testMutation = trpc.telegram.test.useMutation();
  const disconnectMutation = trpc.telegram.disconnect.useMutation();

  const syncConnection = async () => {
    setPendingAction('sync');
    setSubmitState({ tone: 'idle', message: '' });
    try {
      const result = await syncMutation.mutateAsync();
      if (result?.connected) {
        setIsConnected(true);
        onConnected?.();
        setSubmitState({ tone: 'idle', message: '' });
      } else {
        setSubmitState({ tone: 'error', message: 'Telegram has not sent a usable /start update yet.' });
      }
    } catch (error) {
      setSubmitState({ tone: 'error', message: error instanceof Error ? error.message : 'Telegram sync failed.' });
    } finally {
      setPendingAction(null);
    }
  };

  const sendTestMessage = async () => {
    setPendingAction('test');
    setSubmitState({ tone: 'idle', message: '' });
    try {
      await testMutation.mutateAsync();
      setSubmitState({ tone: 'success', message: 'Test message sent to the connected Telegram account.' });
    } catch (error) {
      setSubmitState({ tone: 'error', message: error instanceof Error ? error.message : 'Telegram test failed.' });
    } finally {
      setPendingAction(null);
    }
  };

  const disconnectBot = async () => {
    setPendingAction('disconnect');
    setSubmitState({ tone: 'idle', message: '' });
    try {
      await disconnectMutation.mutateAsync();
      setIsConnected(false);
      onDisconnected?.();
      setSubmitState({ tone: 'idle', message: '' });
    } catch (error) {
      setSubmitState({ tone: 'error', message: error instanceof Error ? error.message : 'Telegram disconnect failed.' });
    } finally {
      setPendingAction(null);
    }
  };

  const toast = submitState.message && toastPosition && typeof document !== 'undefined'
    ? createPortal(
      <p
        className={`telegram-toast ${submitState.tone === 'error' ? 'telegram-toast-error' : 'telegram-toast-success'} telegram-toast-${toastPosition.placement}`}
        style={{ left: `${toastPosition.left}px`, top: `${toastPosition.top}px`, width: toastPosition.width ? `${toastPosition.width}px` : undefined }}
        role="status"
        aria-live={submitState.tone === 'error' ? 'assertive' : 'polite'}
      >
        {submitState.message}
      </p>,
      document.body,
    )
    : null;

  return (
    <>
    <div ref={controlsRef} className={`telegram-controls${isConnected ? ' telegram-controls-connected' : ''}`}>
      {loading ? (
        <div className="telegram-loading-state" aria-live="polite">
          <div className="telegram-loading-chip" />
          <div className="telegram-loading-button" />
          <div className="telegram-loading-button telegram-loading-button-secondary" />
        </div>
      ) : !isAuthenticated ? (
        
        <>
          <div className="telegram-disconnected-grid">
            <span className="status-chip warn telegram-disconnected-status">Sign In</span>
            {signInUrl ? (
              <a className="cta telegram-action-button" href={signInUrl}>Sign In To Connect Telegram</a>
            ) : (
              <button type="button" className="cta cta-button telegram-action-button" disabled>Sign In To Connect Telegram</button>
            )}
          </div>
          <p className="small">
            Telegram connection, test sends, and disconnect actions are available after sign-in.
          </p>
          {!signInUrl ? (
            <p className="small status-text-warn">
              Sign-in is unavailable on this deployment until the auth login URL is configured.
            </p>
          ) : null}
          {!botConfigured ? (
            <p className="small status-text-warn">
              Missing <code>TELEGRAM_BOT_TOKEN</code>, so the connect flow will stay unavailable until the bot token is configured.
            </p>
          ) : null}
        </>
      ) : isConnected ? (
        <>
          <div className="telegram-connected-grid">
            <span className="status-chip good telegram-connected-status">Connected</span>
            <button
              type="button"
              className="cta cta-button telegram-action-button"
              onClick={sendTestMessage}
              disabled={!botConfigured || pendingAction !== null}
            >
              {pendingAction === 'test' ? 'Sending...' : 'Send Test Message'}
            </button>
            <button
              type="button"
              className="subtle-button telegram-action-button telegram-danger-button"
              onClick={disconnectBot}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'disconnect' ? 'Disconnecting...' : 'Disconnect Bot'}
            </button>
          </div>
          {!botConfigured ? (
            <p className="small status-text-warn">
              Missing <code>TELEGRAM_BOT_TOKEN</code>, so test sends are disabled until the bot token is configured.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="telegram-disconnected-grid">
            <span className="status-chip bad telegram-disconnected-status">Disconnected</span>
            {connectUrl ? (
              <a className="cta telegram-action-button" href={connectUrl} target="_blank" rel="noreferrer">Connect Telegram</a>
            ) : (
              <button type="button" className="cta cta-button telegram-action-button" disabled>Connect Telegram</button>
            )}
            {botConfigured ? (
              <button
                type="button"
                className="subtle-button telegram-action-button"
                onClick={syncConnection}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'sync' ? 'Checking...' : 'Check Connection'}
              </button>
            ) : null}
          </div>
          {!botConfigured ? (
            <p className="small status-text-warn">
              Missing <code>TELEGRAM_BOT_TOKEN</code>, so the connect link is disabled until the bot token is configured.
            </p>
          ) : null}
        </>
      )}
    </div>
    {toast}
    </>
  );
}
