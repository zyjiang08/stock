const telegramBase = (): string => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  return `https://api.telegram.org/bot${token}`;
};

export const telegramBotConfigured = (): boolean => Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());

export type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat?: {
      id?: number | string;
    };
  };
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

class TelegramHttpError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export const sendTelegramMessage = async (chatId: string, text: string): Promise<void> => {
  const baseUrl = telegramBase();
  const maxAttempts = 3;
  const timeoutMs = 10_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: controller.signal,
      });

      if (res.ok) return;

      const body = await res.text().catch(() => '');
      const isRetryable = res.status === 429 || res.status >= 500;

      if (!isRetryable) {
        throw new TelegramHttpError(`Telegram send failed (${res.status}): ${body}`, false);
      }

      if (attempt === maxAttempts) {
        throw new TelegramHttpError(`Telegram send failed (${res.status}): ${body}`, true);
      }
    } catch (error) {
      if (error instanceof TelegramHttpError && !error.retryable) {
        throw error;
      }
      const retryableLocalError =
        (error instanceof DOMException && error.name === 'AbortError') || error instanceof TypeError;
      if (!retryableLocalError) {
        if (error instanceof Error) throw error;
        throw new Error('Telegram send failed: unknown error');
      }
      if (attempt === maxAttempts) {
        if (error instanceof Error) throw error;
        throw new Error('Telegram send failed: unknown error');
      }
    } finally {
      clearTimeout(timeoutId);
    }

    await sleep(attempt * 500);
  }
};

export const telegramConnectUrl = async (): Promise<string | null> => {
  if (!telegramBotConfigured()) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${telegramBase()}/getMe`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const body = await res.json();
    const username = body?.result?.username;
    if (typeof username !== 'string' || !username.trim()) return null;

    return `https://t.me/${username.trim()}?start=phoenixsig`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const fetchTelegramUpdates = async (offset?: number): Promise<TelegramUpdate[]> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  const params = new URLSearchParams({ limit: '50' });
  if (typeof offset === 'number' && Number.isFinite(offset)) {
    params.set('offset', String(offset));
  }

  try {
    const res = await fetch(`${telegramBase()}/getUpdates?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Telegram getUpdates failed (${res.status}): ${body}`);
    }

    const body = await res.json();
    return Array.isArray(body?.result) ? (body.result as TelegramUpdate[]) : [];
  } finally {
    clearTimeout(timeoutId);
  }
};
