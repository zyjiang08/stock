import { readJsonCache, writeJsonCache } from '@/lib/data/cache';
import { AppRepository, TelegramSubscriber } from './repository';

type DbShape = {
  subscribers: TelegramSubscriber[];
  sentAlertKeys: string[];
  telegramUpdateCursor: number;
};

const DB_PATH = '.data/db.json';

const load = async (): Promise<DbShape> => {
  const db = await readJsonCache<DbShape>(DB_PATH);
  return {
    subscribers: db?.subscribers ?? [],
    sentAlertKeys: db?.sentAlertKeys ?? [],
    telegramUpdateCursor: typeof db?.telegramUpdateCursor === 'number' ? db.telegramUpdateCursor : 0,
  };
};

const save = async (db: DbShape): Promise<void> => {
  await writeJsonCache(DB_PATH, db);
};

export const createLocalAppRepository = (): AppRepository => ({
  async subscribeChat(chatId: string): Promise<TelegramSubscriber> {
    const db = await load();
    const existing = db.subscribers.find((subscriber) => subscriber.chatId === chatId);

    if (existing) {
      existing.active = true;
      existing.subscribedAt = new Date().toISOString();
      existing.unsubscribedAt = null;
      await save(db);
      return existing;
    }

    const subscriber: TelegramSubscriber = {
      chatId,
      active: true,
      subscribedAt: new Date().toISOString(),
      unsubscribedAt: null,
    };
    db.subscribers.push(subscriber);
    await save(db);
    return subscriber;
  },

  async unsubscribeChat(chatId: string): Promise<TelegramSubscriber | null> {
    const db = await load();
    const existing = db.subscribers.find((subscriber) => subscriber.chatId === chatId);
    if (!existing) return null;

    existing.active = false;
    existing.unsubscribedAt = new Date().toISOString();
    await save(db);
    return existing;
  },

  async listActiveSubscribers(): Promise<TelegramSubscriber[]> {
    const db = await load();
    return db.subscribers.filter((subscriber) => subscriber.active);
  },

  async getLatestActiveSubscriber(): Promise<TelegramSubscriber | null> {
    const db = await load();
    const active = db.subscribers.filter((subscriber) => subscriber.active);
    return active
      .slice()
      .sort((left, right) => right.subscribedAt.localeCompare(left.subscribedAt))[0] ?? null;
  },

  async disconnectLatestActiveSubscriber(): Promise<TelegramSubscriber | null> {
    const db = await load();
    const latest = db.subscribers
      .filter((subscriber) => subscriber.active)
      .slice()
      .sort((left, right) => right.subscribedAt.localeCompare(left.subscribedAt))[0] ?? null;
    if (!latest) return null;

    const existing = db.subscribers.find((subscriber) => subscriber.chatId === latest.chatId);
    if (!existing) return null;
    existing.active = false;
    existing.unsubscribedAt = new Date().toISOString();
    await save(db);
    return existing;
  },

  async getTelegramUpdateCursor(): Promise<number> {
    const db = await load();
    return db.telegramUpdateCursor;
  },

  async setTelegramUpdateCursor(cursor: number): Promise<void> {
    const db = await load();
    db.telegramUpdateCursor = cursor;
    await save(db);
  },

  async hasSentAlertKey(key: string): Promise<boolean> {
    const db = await load();
    return db.sentAlertKeys.includes(key);
  },

  async markAlertKeySent(key: string): Promise<void> {
    const db = await load();
    if (!db.sentAlertKeys.includes(key)) {
      db.sentAlertKeys.push(key);
      await save(db);
    }
  },
});
