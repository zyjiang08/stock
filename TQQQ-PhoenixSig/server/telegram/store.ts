import { promises as fs } from 'node:fs';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db.js';
import { telegramSubscribers, alertSentKeys, appState } from '../../drizzle/schema.js';

export type TelegramSubscriber = {
  chatId: string;
  active: boolean;
  openId: string | null;
};

const CURSOR_KEY = 'telegram_cursor';
const LOCAL_STORE_PATH = path.join(process.cwd(), '.data', 'telegram-store.json');

type LocalSubscriberRecord = TelegramSubscriber & {
  subscribedAt: number;
  updatedAt: number;
};

type LocalStoreState = {
  telegramSubscribers: LocalSubscriberRecord[];
  appState: Record<string, string>;
  alertSentKeys: string[];
};

const createEmptyLocalStore = (): LocalStoreState => ({
  telegramSubscribers: [],
  appState: {},
  alertSentKeys: [],
});

const ensureLocalStoreDir = async (): Promise<void> => {
  await fs.mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
};

const readLocalStore = async (): Promise<LocalStoreState> => {
  try {
    const raw = await fs.readFile(LOCAL_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LocalStoreState>;

    return {
      telegramSubscribers: Array.isArray(parsed.telegramSubscribers)
        ? parsed.telegramSubscribers.map((record) => ({
            chatId: typeof record?.chatId === 'string' ? record.chatId : '',
            active: Boolean(record?.active),
            openId: typeof record?.openId === 'string' ? record.openId : null,
            subscribedAt: typeof record?.subscribedAt === 'number' ? record.subscribedAt : Date.now(),
            updatedAt: typeof record?.updatedAt === 'number' ? record.updatedAt : Date.now(),
          })).filter((record) => record.chatId)
        : [],
      appState: parsed.appState && typeof parsed.appState === 'object' ? Object.fromEntries(
        Object.entries(parsed.appState).filter(([, value]) => typeof value === 'string'),
      ) : {},
      alertSentKeys: Array.isArray(parsed.alertSentKeys)
        ? parsed.alertSentKeys.filter((value): value is string => typeof value === 'string')
        : [],
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT') {
      return createEmptyLocalStore();
    }

    console.warn('[Telegram store] Failed to read local store, resetting it:', error);
    return createEmptyLocalStore();
  }
};

const writeLocalStore = async (state: LocalStoreState): Promise<void> => {
  await ensureLocalStoreDir();
  await fs.writeFile(LOCAL_STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
};

const toSubscriber = (record: LocalSubscriberRecord): TelegramSubscriber => ({
  chatId: record.chatId,
  active: record.active,
  openId: record.openId,
});

const findLatestSubscriber = (
  records: LocalSubscriberRecord[],
  predicate: (record: LocalSubscriberRecord) => boolean,
): LocalSubscriberRecord | null => {
  const matching = records
    .filter(predicate)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return matching[0] ?? null;
};

// ── Subscriber management ──────────────────────────────────────────────────

export const subscribeChat = async (chatId: string, openId?: string): Promise<TelegramSubscriber> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    const now = Date.now();
    const existing = state.telegramSubscribers.find((record) => record.chatId === chatId);

    if (existing) {
      existing.active = true;
      existing.openId = openId ?? null;
      existing.updatedAt = now;
    } else {
      state.telegramSubscribers.push({
        chatId,
        active: true,
        openId: openId ?? null,
        subscribedAt: now,
        updatedAt: now,
      });
    }

    await writeLocalStore(state);
    return { chatId, active: true, openId: openId ?? null };
  }

  await db
    .insert(telegramSubscribers)
    .values({ chatId, active: true, openId: openId ?? null })
    .onDuplicateKeyUpdate({ set: { active: true, openId: openId ?? null } });

  return { chatId, active: true, openId: openId ?? null };
};

export const unsubscribeChat = async (chatId: string): Promise<TelegramSubscriber | null> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    const existing = state.telegramSubscribers.find((record) => record.chatId === chatId);

    if (!existing) return null;

    existing.active = false;
    existing.updatedAt = Date.now();
    await writeLocalStore(state);

    return toSubscriber(existing);
  }

  const rows = await db
    .select()
    .from(telegramSubscribers)
    .where(eq(telegramSubscribers.chatId, chatId))
    .limit(1);

  if (!rows[0]) return null;

  await db
    .update(telegramSubscribers)
    .set({ active: false })
    .where(eq(telegramSubscribers.chatId, chatId));

  return { chatId: rows[0].chatId, active: false, openId: rows[0].openId };
};

export const listActiveSubscribers = async (): Promise<TelegramSubscriber[]> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    return state.telegramSubscribers
      .filter((record) => record.active)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(toSubscriber);
  }

  const rows = await db
    .select()
    .from(telegramSubscribers)
    .where(eq(telegramSubscribers.active, true));

  return rows.map((r) => ({ chatId: r.chatId, active: r.active, openId: r.openId }));
};

/** Returns the most recently subscribed active subscriber for a given openId (or any if openId is null). */
export const getActiveSubscriberForUser = async (openId: string): Promise<TelegramSubscriber | null> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    const record = findLatestSubscriber(
      state.telegramSubscribers,
      (subscriber) => subscriber.active && subscriber.openId === openId,
    );

    return record ? toSubscriber(record) : null;
  }

  const rows = await db
    .select()
    .from(telegramSubscribers)
    .where(and(eq(telegramSubscribers.active, true), eq(telegramSubscribers.openId, openId)))
    .limit(1);

  if (!rows[0]) return null;
  return { chatId: rows[0].chatId, active: rows[0].active, openId: rows[0].openId };
};

/** Returns the most recently subscribed active subscriber (any user). */
export const getLatestActiveSubscriber = async (): Promise<TelegramSubscriber | null> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    const record = findLatestSubscriber(state.telegramSubscribers, (subscriber) => subscriber.active);
    return record ? toSubscriber(record) : null;
  }

  const rows = await db
    .select()
    .from(telegramSubscribers)
    .where(eq(telegramSubscribers.active, true))
    .limit(1);

  if (!rows[0]) return null;
  return { chatId: rows[0].chatId, active: rows[0].active, openId: rows[0].openId };
};

/** Disconnects the active subscriber for a given openId. */
export const disconnectSubscriberForUser = async (openId: string): Promise<TelegramSubscriber | null> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    const record = findLatestSubscriber(
      state.telegramSubscribers,
      (subscriber) => subscriber.active && subscriber.openId === openId,
    );

    if (!record) return null;

    record.active = false;
    record.updatedAt = Date.now();
    await writeLocalStore(state);

    return toSubscriber(record);
  }

  const rows = await db
    .select()
    .from(telegramSubscribers)
    .where(and(eq(telegramSubscribers.active, true), eq(telegramSubscribers.openId, openId)))
    .limit(1);

  if (!rows[0]) return null;

  await db
    .update(telegramSubscribers)
    .set({ active: false })
    .where(eq(telegramSubscribers.chatId, rows[0].chatId));

  return { chatId: rows[0].chatId, active: false, openId: rows[0].openId };
};

// ── Update cursor ──────────────────────────────────────────────────────────

export const getTelegramUpdateCursor = async (): Promise<number> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    return Number(state.appState[CURSOR_KEY] ?? 0);
  }

  const rows = await db
    .select()
    .from(appState)
    .where(eq(appState.stateKey, CURSOR_KEY))
    .limit(1);

  return rows[0] ? Number(rows[0].stateValue) : 0;
};

export const setTelegramUpdateCursor = async (cursor: number): Promise<void> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    state.appState[CURSOR_KEY] = String(cursor);
    await writeLocalStore(state);
    return;
  }

  await db
    .insert(appState)
    .values({ stateKey: CURSOR_KEY, stateValue: String(cursor) })
    .onDuplicateKeyUpdate({ set: { stateValue: String(cursor) } });
};

// ── Deep-link token store ────────────────────────────────────────────────────
// Tokens are stored in app_state with key `tg_token:<token>` and value `<openId>:<expiresAt>`.
// TTL is 10 minutes.

const TOKEN_TTL_MS = 10 * 60 * 1000;

export const createConnectToken = async (openId: string): Promise<string> => {
  const db = await getDb();
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  if (!db) {
    const state = await readLocalStore();
    state.appState[`tg_token:${token}`] = `${openId}:${expiresAt}`;
    await writeLocalStore(state);
    return token;
  }

  await db
    .insert(appState)
    .values({ stateKey: `tg_token:${token}`, stateValue: `${openId}:${expiresAt}` })
    .onDuplicateKeyUpdate({ set: { stateValue: `${openId}:${expiresAt}` } });
  return token;
};

export const resolveConnectToken = async (token: string): Promise<string | null> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    const rawValue = state.appState[`tg_token:${token}`];

    if (!rawValue) return null;

    const [openId, expiresAtStr] = rawValue.split(':');
    if (!openId || !expiresAtStr) return null;

    if (Date.now() > Number(expiresAtStr)) {
      delete state.appState[`tg_token:${token}`];
      await writeLocalStore(state);
      return null;
    }

    delete state.appState[`tg_token:${token}`];
    await writeLocalStore(state);
    return openId;
  }
  const rows = await db
    .select()
    .from(appState)
    .where(eq(appState.stateKey, `tg_token:${token}`))
    .limit(1);
  if (!rows[0]) return null;
  const [openId, expiresAtStr] = rows[0].stateValue.split(':');
  if (!openId || !expiresAtStr) return null;
  if (Date.now() > Number(expiresAtStr)) {
    // Expired — clean up
    await db.delete(appState).where(eq(appState.stateKey, `tg_token:${token}`));
    return null;
  }
  // Consume the token (one-time use)
  await db.delete(appState).where(eq(appState.stateKey, `tg_token:${token}`));
  return openId;
};

// ── Alert deduplication ────────────────────────────────────────────────────

export const hasSentAlertKey = async (key: string): Promise<boolean> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    return state.alertSentKeys.includes(key);
  }

  const rows = await db
    .select()
    .from(alertSentKeys)
    .where(eq(alertSentKeys.alertKey, key))
    .limit(1);

  return rows.length > 0;
};

export const markAlertKeySent = async (key: string): Promise<void> => {
  const db = await getDb();
  if (!db) {
    const state = await readLocalStore();
    if (!state.alertSentKeys.includes(key)) {
      state.alertSentKeys.push(key);
      await writeLocalStore(state);
    }
    return;
  }

  await db
    .insert(alertSentKeys)
    .values({ alertKey: key })
    .onDuplicateKeyUpdate({ set: { alertKey: key } });
};
