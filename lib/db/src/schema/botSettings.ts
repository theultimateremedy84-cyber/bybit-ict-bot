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
  // Demo Trading uses api-demo.bybit.com — keys come from bybit.com → Demo Account
  // This is different from Testnet (api-testnet.bybit.com, keys from testnet.bybit.com)
  bybitDemo:      boolean("bybit_demo").notNull().default(false),

  // ── Institutional order-flow layer ─────────────────────────────────────
  useOrderFlow:            boolean("use_order_flow").notNull().default(true),
  orderFlowVetoThreshold:  real("order_flow_veto_threshold").notNull().default(25),
  requireFlowConfirmation: boolean("require_flow_confirmation").notNull().default(true),
  minFlowConfirmation:     real("min_flow_confirmation").notNull().default(12),
  cryptoMode:              boolean("crypto_mode").notNull().default(true),
  maxRelativeSpread:       real("max_relative_spread").notNull().default(0.0008),

  // ── Institutional risk layer ───────────────────────────────────────────
  maxLeverage:             real("max_leverage").notNull().default(5),
  scaleByConfidence:       boolean("scale_by_confidence").notNull().default(true),
  maxPerCorrelationGroup:  integer("max_per_correlation_group").notNull().default(2),
  maxDirectionalLeverage:  real("max_directional_leverage").notNull().default(3),
  maxTotalLeverage:        real("max_total_leverage").notNull().default(5),

  // ── Execution mode ─────────────────────────────────────────────────────
  // When true the bot places the EXACT OPPOSITE of every generated signal:
  // side flipped, stop and target mirrored, sizing recomputed.
  reverseSignals:          boolean("reverse_signals").notNull().default(false),

  // ── Runtime state ──────────────────────────────────────────────────────
  // Persisted "should the bot be running" flag. Survives process restarts /
  // redeploys / dyno sleeps so the bot resumes itself on boot.
  botEnabled:              boolean("bot_enabled").notNull().default(false),

  // ── In-trade management ────────────────────────────────────────────────
  breakEvenAtR:            real("break_even_at_r").notNull().default(1.0),
  trailAtR:                real("trail_at_r").notNull().default(1.5),
  trailAtrMultiple:        real("trail_atr_multiple").notNull().default(1.5),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export const insertBotSettingsSchema = createInsertSchema(botSettingsTable).omit({ id: true, updatedAt: true });
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type BotSettings = typeof botSettingsTable.$inferSelect;
