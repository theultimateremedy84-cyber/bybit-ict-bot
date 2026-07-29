import { pgTable, serial, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botSettingsTable = pgTable("bot_settings", {
  id:               serial("id").primaryKey(),
  riskPerTrade:     real("risk_per_trade").notNull().default(1.0),
  maxOpenTrades:    integer("max_open_trades").notNull().default(3),
  dailyLossLimit:   real("daily_loss_limit").notNull().default(3.0),
  // Default crypto markets for Bybit USDT perpetuals
  enabledMarkets:   text("enabled_markets").notNull().default("BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT"),
  enabledKillZones: text("enabled_kill_zones").notNull().default("LONDON,NEW_YORK,ASIAN"),
  minConfidence:    real("min_confidence").notNull().default(55.0),
  useOrderBlocks:   boolean("use_order_blocks").notNull().default(true),
  useFairValueGaps: boolean("use_fair_value_gaps").notNull().default(true),
  useLiquiditySweeps: boolean("use_liquidity_sweeps").notNull().default(true),
  useBOS:           boolean("use_bos").notNull().default(true),
  useChoCH:         boolean("use_cho_ch").notNull().default(true),
  trailingStop:     boolean("trailing_stop").notNull().default(false),
  minRR:            real("min_rr").notNull().default(2.0),
  // Bybit credentials (stored encrypted at rest by Railway / your infra)
  bybitApiKey:    text("bybit_api_key").notNull().default(""),
  bybitApiSecret: text("bybit_api_secret").notNull().default(""),
  bybitTestnet:   boolean("bybit_testnet").notNull().default(true),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export const insertBotSettingsSchema = createInsertSchema(botSettingsTable).omit({ id: true, updatedAt: true });
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type BotSettings = typeof botSettingsTable.$inferSelect;
