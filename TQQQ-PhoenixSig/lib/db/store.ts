import { createLocalAppRepository } from './local-repository';
import { AppRepository, TelegramSubscriber } from './repository';

// This single adapter selection point keeps the app ready for a future Manus DB
// implementation without forcing call sites to change again.
const repository: AppRepository = createLocalAppRepository();

export type { TelegramSubscriber, AppRepository };

export const subscribeChat = (chatId: string): Promise<TelegramSubscriber> =>
  repository.subscribeChat(chatId);

export const unsubscribeChat = (chatId: string): Promise<TelegramSubscriber | null> =>
  repository.unsubscribeChat(chatId);

export const listActiveSubscribers = (): Promise<TelegramSubscriber[]> =>
  repository.listActiveSubscribers();

export const getLatestActiveSubscriber = (): Promise<TelegramSubscriber | null> =>
  repository.getLatestActiveSubscriber();

export const disconnectLatestActiveSubscriber = (): Promise<TelegramSubscriber | null> =>
  repository.disconnectLatestActiveSubscriber();

export const getTelegramUpdateCursor = (): Promise<number> =>
  repository.getTelegramUpdateCursor();

export const setTelegramUpdateCursor = (cursor: number): Promise<void> =>
  repository.setTelegramUpdateCursor(cursor);

export const hasSentAlertKey = (key: string): Promise<boolean> =>
  repository.hasSentAlertKey(key);

export const markAlertKeySent = (key: string): Promise<void> =>
  repository.markAlertKeySent(key);
