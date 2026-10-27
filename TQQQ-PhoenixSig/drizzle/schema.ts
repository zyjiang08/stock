import { boolean, int, longtext, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Telegram subscribers — one row per chatId.
 * active=true means the user has /start-ed and not /stop-ped.
 * openId links to the Manus OAuth user who connected this chat.
 */
export const telegramSubscribers = mysqlTable("telegram_subscribers", {
  id: int("id").autoincrement().primaryKey(),
  chatId: varchar("chatId", { length: 64 }).notNull().unique(),
  active: boolean("active").notNull().default(true),
  openId: varchar("openId", { length: 64 }),
  subscribedAt: timestamp("subscribedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TelegramSubscriber = typeof telegramSubscribers.$inferSelect;
export type InsertTelegramSubscriber = typeof telegramSubscribers.$inferInsert;

/**
 * Deduplication keys for sent rebalance alerts.
 * Prevents double-sending on job retries.
 */
export const alertSentKeys = mysqlTable("alert_sent_keys", {
  id: int("id").autoincrement().primaryKey(),
  alertKey: varchar("alertKey", { length: 255 }).notNull().unique(),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
});

export type AlertSentKey = typeof alertSentKeys.$inferSelect;

/**
 * Telegram update cursor — stores the latest processed update_id.
 * Only ever has one row (key = 'telegram_cursor').
 */
export const appState = mysqlTable("app_state", {
  id: int("id").autoincrement().primaryKey(),
  stateKey: varchar("stateKey", { length: 64 }).notNull().unique(),
  stateValue: text("stateValue").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AppState = typeof appState.$inferSelect;

/**
 * Strategy cache — stores the computed backtest + current snapshot keyed by market data hash.
 * Avoids recomputing the full backtest on every request.
 */
export const strategyCache = mysqlTable("strategy_cache", {
  id: int("id").autoincrement().primaryKey(),
  cacheKey: varchar("cacheKey", { length: 128 }).notNull().unique(),
  payload: longtext('payload').notNull(), // JSON blob — longtext supports up to 4GB
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StrategyCache = typeof strategyCache.$inferSelect;
