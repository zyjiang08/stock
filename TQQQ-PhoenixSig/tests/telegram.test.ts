import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sendTelegramMessage,
  telegramBotConfigured,
  telegramConnectUrl,
} from '@/lib/telegram/client';

describe('telegram client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('retries retryable Telegram errors and eventually succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'temporary' })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await sendTelegramMessage('42', 'hello');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/sendMessage$/);
  });

  it('throws after exhausting retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => 'bad gateway' });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(sendTelegramMessage('42', 'hello')).rejects.toThrow(/502/i);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails fast on non-retryable API responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(sendTelegramMessage('42', 'hello')).rejects.toThrow(/403/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('builds connect url from getMe', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { username: ' phoenixsig_bot ' } }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    expect(telegramBotConfigured()).toBe(true);
    await expect(telegramConnectUrl()).resolves.toBe('https://t.me/phoenixsig_bot?start=phoenixsig');
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/getMe$/);
  });

  it('returns null connect url when Telegram username cannot be resolved', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: {} }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(telegramConnectUrl()).resolves.toBeNull();
  });

  it('fails immediately on local config errors', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(sendTelegramMessage('42', 'hello')).rejects.toThrow(/Missing TELEGRAM_BOT_TOKEN/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
