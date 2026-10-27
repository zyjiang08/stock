CREATE TABLE `alert_sent_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertKey` varchar(255) NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alert_sent_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `alert_sent_keys_alertKey_unique` UNIQUE(`alertKey`)
);
--> statement-breakpoint
CREATE TABLE `app_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stateKey` varchar(64) NOT NULL,
	`stateValue` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_state_stateKey_unique` UNIQUE(`stateKey`)
);
--> statement-breakpoint
CREATE TABLE `strategy_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cacheKey` varchar(128) NOT NULL,
	`payload` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `strategy_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `strategy_cache_cacheKey_unique` UNIQUE(`cacheKey`)
);
--> statement-breakpoint
CREATE TABLE `telegram_subscribers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chatId` varchar(64) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`openId` varchar(64),
	`subscribedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_subscribers_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_subscribers_chatId_unique` UNIQUE(`chatId`)
);
