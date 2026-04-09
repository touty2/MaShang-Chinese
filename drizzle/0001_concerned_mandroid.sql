CREATE TABLE `deck_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deckId` int NOT NULL,
	`userId` int NOT NULL,
	`word` varchar(64) NOT NULL,
	`addedAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `deck_cards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `decks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `decks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `story_deck_words` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`storyId` int NOT NULL,
	`word` varchar(64) NOT NULL,
	`addedAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `story_deck_words_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `story_decks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`storyId` int NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `story_decks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_completed_texts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`storyId` int NOT NULL,
	`completedAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `sync_completed_texts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_flashcards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`word` varchar(64) NOT NULL,
	`cardType` enum('zh_en','en_zh') NOT NULL,
	`stability` float DEFAULT 0,
	`difficulty` float DEFAULT 0,
	`scheduledDays` int DEFAULT 0,
	`elapsedDays` int DEFAULT 0,
	`reps` int DEFAULT 0,
	`lapses` int DEFAULT 0,
	`isLeech` boolean DEFAULT false,
	`state` int DEFAULT 0,
	`dueDate` bigint,
	`lastReviewed` bigint,
	`pinyin` varchar(128),
	`definition` text,
	`hskBand` varchar(32),
	`storyId` int,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `sync_flashcards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`prefsJson` text NOT NULL DEFAULT ('{}'),
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `sync_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `sync_preferences_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `sync_segmentation_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`storyId` int NOT NULL,
	`overridesJson` text NOT NULL DEFAULT ('[]'),
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `sync_segmentation_overrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_vocab_ignored` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`word` varchar(64) NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `sync_vocab_ignored_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_word_mistakes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`word` varchar(64) NOT NULL,
	`count` int DEFAULT 1,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `sync_word_mistakes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `openId` varchar(64);--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `name` varchar(255);--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email` varchar(320) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `loginMethod` varchar(64) DEFAULT 'email';--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);--> statement-breakpoint
CREATE INDEX `dc_deck_word` ON `deck_cards` (`deckId`,`word`);--> statement-breakpoint
CREATE INDEX `decks_user` ON `decks` (`userId`);--> statement-breakpoint
CREATE INDEX `sdw_user_story_word` ON `story_deck_words` (`userId`,`storyId`,`word`);--> statement-breakpoint
CREATE INDEX `sd_user_story` ON `story_decks` (`userId`,`storyId`);--> statement-breakpoint
CREATE INDEX `ct_user_story` ON `sync_completed_texts` (`userId`,`storyId`);--> statement-breakpoint
CREATE INDEX `fc_user_word_type` ON `sync_flashcards` (`userId`,`word`,`cardType`);--> statement-breakpoint
CREATE INDEX `so_user_story` ON `sync_segmentation_overrides` (`userId`,`storyId`);--> statement-breakpoint
CREATE INDEX `vi_user_word` ON `sync_vocab_ignored` (`userId`,`word`);--> statement-breakpoint
CREATE INDEX `wm_user_word` ON `sync_word_mistakes` (`userId`,`word`);