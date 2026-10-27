export type TelegramSubscriber = {
  chatId: string;
  active: boolean;
  subscribedAt: string;
  unsubscribedAt: string | null;
};

export type AppRepository = {
  subscribeChat(chatId: string): Promise<TelegramSubscriber>;
  unsubscribeChat(chatId: string): Promise<TelegramSubscriber | null>;
  listActiveSubscribers(): Promise<TelegramSubscriber[]>;
  getLatestActiveSubscriber(): Promise<TelegramSubscriber | null>;
  disconnectLatestActiveSubscriber(): Promise<TelegramSubscriber | null>;
  getTelegramUpdateCursor(): Promise<number>;
  setTelegramUpdateCursor(cursor: number): Promise<void>;
  hasSentAlertKey(key: string): Promise<boolean>;
  markAlertKeySent(key: string): Promise<void>;
};
