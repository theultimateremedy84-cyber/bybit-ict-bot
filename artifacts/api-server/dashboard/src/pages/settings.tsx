import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const settingsSchema = z.object({
  tradeAmountUsdt: z.coerce.number().min(0).max(1_000_000),
  riskPerTrade: z.coerce.number().min(0.1).max(10),
  maxOpenTrades: z.coerce.number().min(1).max(20),
  dailyLossLimit: z.coerce.number().min(1).max(50),
  minConfidence: z.coerce.number().min(0).max(100),
  minRR: z.coerce.number().min(1).max(10),
  enabledMarkets: z.array(z.string()).min(1, "Select at least one market"),
  stopLossMode: z.enum(["STRATEGY", "PERCENT", "ATR"]),
  stopLossValue: z.coerce.number().min(0).max(100),
  takeProfitMode: z.enum(["STRATEGY", "PERCENT", "R_MULTIPLE"]),
  takeProfitValue: z.coerce.number().min(0).max(100),
  maxLeverage: z.coerce.number().min(1).max(100),
  useOrderBlocks: z.boolean(),
  useFairValueGaps: z.boolean(),
  useLiquiditySweeps: z.boolean(),
  useBOS: z.boolean(),
  useChoCH: z.boolean(),
  trailingStop: z.boolean(),
  reverseSignals: z.boolean(),
  bybitApiKey: z.string().optional(),
  bybitApiSecret: z.string().optional(),
  bybitTestnet: z.boolean(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

const marketOptions = [
  { symbol: "BTCUSDT", name: "Bitcoin" },
  { symbol: "ETHUSDT", name: "Ethereum" },
  { symbol: "SOLUSDT", name: "Solana" },
  { symbol: "BNBUSDT", name: "BNB" },
  { symbol: "XRPUSDT", name: "XRP" },
  { symbol: "ADAUSDT", name: "Cardano" },
  { symbol: "DOGEUSDT", name: "Dogecoin" },
  { symbol: "LTCUSDT", name: "Litecoin" },
  { symbol: "LINKUSDT", name: "Chainlink" },
  { symbol: "AVAXUSDT", name: "Avalanche" },
  { symbol: "DOTUSDT", name: "Polkadot" },
  { symbol: "MATICUSDT", name: "Polygon" },
  { symbol: "HYPEUSDT", name: "Hyperliquid" },
  { symbol: "SUIUSDT", name: "Sui" },
  { symbol: "XAGUSDT", name: "Silver" },
  { symbol: "XAUUSDT", name: "Gold" },
] as const;

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      tradeAmountUsdt: 7000,
      riskPerTrade: 1,
      maxOpenTrades: 5,
      dailyLossLimit: 5,
      minConfidence: 55,
      minRR: 2,
      enabledMarkets: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
      stopLossMode: "PERCENT",
      stopLossValue: 50,
      takeProfitMode: "PERCENT",
      takeProfitValue: 10,
      maxLeverage: 50,
      useOrderBlocks: true,
      useFairValueGaps: true,
      useLiquiditySweeps: true,
      useBOS: true,
      useChoCH: true,
      trailingStop: true,
      reverseSignals: false,
      bybitApiKey: "",
      bybitApiSecret: "",
      bybitTestnet: true,
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        tradeAmountUsdt: (settings as typeof settings & { tradeAmountUsdt?: number }).tradeAmountUsdt ?? 7000,
        riskPerTrade: settings.riskPerTrade,
        maxOpenTrades: settings.maxOpenTrades,
        dailyLossLimit: settings.dailyLossLimit,
        minConfidence: settings.minConfidence,
        minRR: settings.minRR,
        enabledMarkets: settings.enabledMarkets,
        stopLossMode: (settings as typeof settings & { stopLossMode?: SettingsFormValues["stopLossMode"] }).stopLossMode ?? "PERCENT",
        stopLossValue: (settings as typeof settings & { stopLossValue?: number }).stopLossValue ?? 50,
        takeProfitMode: (settings as typeof settings & { takeProfitMode?: SettingsFormValues["takeProfitMode"] }).takeProfitMode ?? "PERCENT",
        takeProfitValue: (settings as typeof settings & { takeProfitValue?: number }).takeProfitValue ?? 10,
        maxLeverage: 50,
        useOrderBlocks: settings.useOrderBlocks,
        useFairValueGaps: settings.useFairValueGaps,
        useLiquiditySweeps: settings.useLiquiditySweeps,
        useBOS: settings.useBOS,
        useChoCH: settings.useChoCH,
        trailingStop: settings.trailingStop,
        reverseSignals: (settings as typeof settings & { reverseSignals?: boolean }).reverseSignals ?? false,
        bybitApiKey: settings.bybitApiKey || "",
        bybitApiSecret: settings.bybitApiSecret || "",
        bybitTestnet: settings.bybitTestnet,
      });
    }
  }, [settings, form]);

  const onSubmit = (data: SettingsFormValues) => {
    // Only send API keys if they were changed
    const payload = { ...data } as SettingsFormValues & { reverseSignals: boolean };
    if (!payload.bybitApiKey) delete payload.bybitApiKey;
    if (!payload.bybitApiSecret) delete payload.bybitApiSecret;

    updateSettings.mutate({ data: payload }, {
      onSuccess: (updated) => {
        if (updated.reverseSignals !== data.reverseSignals) {
          toast({
            title: "Reverse mode was not saved",
            description: "The database did not confirm the selected execution mode. Please check the server logs.",
            variant: "destructive",
          });
          void queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          return;
        }
        toast({
          title: "Settings Updated",
          description: data.reverseSignals
            ? "Reverse execution is saved and active for the next trade."
            : "Normal signal execution is saved and active.",
        });
        queryClient.setQueryData(getGetSettingsQueryKey(), updated);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update settings.", variant: "destructive" });
      }
    });
  };

  const fixedMarginConfigured = Number(form.watch("tradeAmountUsdt")) > 0;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Bot Configuration</h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage risk parameters and active ICT concepts.</p>
      </div>

      {isLoading ? (
        <div className="space-y-4 sm:space-y-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit, (errors) => {
          toast({
            title: "Settings not saved",
            description: `Invalid values: ${Object.keys(errors).join(", ")}`,
            variant: "destructive",
          });
        })} className="space-y-4 sm:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Risk Management</CardTitle>
              <CardDescription>Configure position sizing and daily limits.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              <div className="space-y-2">
                 <Label htmlFor="tradeAmountUsdt">Margin Per Trade (USDT)</Label>
                <Input
                  id="tradeAmountUsdt"
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  {...form.register("tradeAmountUsdt")}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                   Each new trade uses 7,000 USDT margin at fixed 50x leverage, creating approximately 350,000 USDT position notional.
                </p>
                {form.formState.errors.tradeAmountUsdt && (
                  <p className="text-xs text-destructive">{form.formState.errors.tradeAmountUsdt.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="riskPerTrade">Risk Per Trade (%)</Label>
                <Input id="riskPerTrade" type="number" step="0.1" {...form.register("riskPerTrade")} className="font-mono" />
              </div>
              <div className="space-y-2">
                 <Label htmlFor="maxOpenTrades">Max Open Trades (up to 5)</Label>
                <Input id="maxOpenTrades" type="number" {...form.register("maxOpenTrades")} className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dailyLossLimit">Daily Loss Limit (%)</Label>
                <Input id="dailyLossLimit" type="number" step="0.1" {...form.register("dailyLossLimit")} className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="minConfidence">Min Signal Confidence (0-100)</Label>
                <Input id="minConfidence" type="number" step="1" min="0" max="100" {...form.register("minConfidence")} className="font-mono" />
                {form.formState.errors.minConfidence && (
                  <p className="text-xs text-destructive">{form.formState.errors.minConfidence.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="minRR">Min Risk:Reward</Label>
                <Input id="minRR" type="number" step="0.1" {...form.register("minRR")} className="font-mono" />
              </div>
              <div className="space-y-2">
                 <Label htmlFor="maxLeverage">Leverage (fixed at 50x)</Label>
                <Input
                  id="maxLeverage"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                   readOnly
                  {...form.register("maxLeverage")}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                   Every fixed-margin trade targets 50x. Bybit may allow less on some markets, in which case the exchange limit is used.
                </p>
                {form.formState.errors.maxLeverage && (
                  <p className="text-xs text-destructive">{form.formState.errors.maxLeverage.message}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trade Exits</CardTitle>
              <CardDescription>
                Use the strategy levels or override each new trade with a fixed percentage, ATR distance, or risk multiple.
                Existing positions are not changed.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div>
                  <Label htmlFor="stopLossMode">Stop Loss Method</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {fixedMarginConfigured
                      ? "Percentage is the loss target as a percentage of leveraged margin. ATR uses the live 15-minute ATR."
                      : "Percentage is measured from entry. ATR uses the live 15-minute ATR."}
                  </p>
                </div>
                <Controller
                  name="stopLossMode"
                  control={form.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="stopLossMode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STRATEGY">Strategy level</SelectItem>
                        <SelectItem value="PERCENT">Fixed percentage</SelectItem>
                        <SelectItem value="ATR">ATR multiple</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <div className="space-y-2">
                  <Label htmlFor="stopLossValue">
                    {form.watch("stopLossMode") === "ATR"
                      ? "ATR Multiple"
                      : fixedMarginConfigured
                        ? "Margin Loss (%)"
                        : "Distance (%)"}
                  </Label>
                  <Input
                    id="stopLossValue"
                    type="number"
                    min="0"
                    step="0.1"
                    disabled={form.watch("stopLossMode") === "STRATEGY"}
                    {...form.register("stopLossValue")}
                    className="font-mono"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border p-4">
                <div>
                  <Label htmlFor="takeProfitMode">Take Profit Method</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {fixedMarginConfigured
                       ? "Percentage is the profit target as a percentage of the configured margin."
                      : "Risk multiple is calculated from the final stop distance."}
                  </p>
                </div>
                <Controller
                  name="takeProfitMode"
                  control={form.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="takeProfitMode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STRATEGY">Strategy level</SelectItem>
                        <SelectItem value="PERCENT">Fixed percentage</SelectItem>
                        <SelectItem value="R_MULTIPLE">Risk multiple (R)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <div className="space-y-2">
                  <Label htmlFor="takeProfitValue">
                    {form.watch("takeProfitMode") === "R_MULTIPLE"
                      ? "Reward multiple (R)"
                         : fixedMarginConfigured
                        ? "Margin Profit (%)"
                        : "Distance (%)"}
                  </Label>
                  <Input
                    id="takeProfitValue"
                    type="number"
                    min="0"
                    step="0.1"
                    disabled={form.watch("takeProfitMode") === "STRATEGY"}
                    {...form.register("takeProfitValue")}
                    className="font-mono"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Markets to Trade</CardTitle>
              <CardDescription>
                Select the symbols the bot scans and trades. These same symbols appear on the Market Data page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Controller
                name="enabledMarkets"
                control={form.control}
                render={({ field, fieldState }) => (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {marketOptions.map((market) => {
                        const checked = field.value.includes(market.symbol);
                        return (
                          <label
                            key={market.symbol}
                            htmlFor={`market-${market.symbol}`}
                            className="flex items-center gap-3 rounded-lg border border-border px-3 py-3 cursor-pointer hover:bg-secondary/60 transition-colors"
                          >
                            <Checkbox
                              id={`market-${market.symbol}`}
                              checked={checked}
                              onCheckedChange={(value) => {
                                const next = value
                                  ? [...field.value, market.symbol]
                                  : field.value.filter((symbol) => symbol !== market.symbol);
                                field.onChange([...new Set(next)]);
                              }}
                            />
                            <span>
                              <span className="block font-mono text-sm font-semibold">{market.symbol}</span>
                              <span className="block text-xs text-muted-foreground">{market.name}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {fieldState.error && (
                      <p className="text-xs text-destructive">{fieldState.error.message}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Selected: {field.value.length} market{field.value.length === 1 ? "" : "s"}
                    </p>
                  </div>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ICT Strategy Concepts</CardTitle>
              <CardDescription>Enable or disable specific trading patterns.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              <div className="flex items-center space-x-2">
                <Controller name="useOrderBlocks" control={form.control} render={({ field }) => (
                  <Switch id="useOrderBlocks" checked={field.value} onCheckedChange={field.onChange} />
                )} />
                <Label htmlFor="useOrderBlocks">Order Blocks</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Controller name="useFairValueGaps" control={form.control} render={({ field }) => (
                  <Switch id="useFairValueGaps" checked={field.value} onCheckedChange={field.onChange} />
                )} />
                <Label htmlFor="useFairValueGaps">Fair Value Gaps</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Controller name="useLiquiditySweeps" control={form.control} render={({ field }) => (
                  <Switch id="useLiquiditySweeps" checked={field.value} onCheckedChange={field.onChange} />
                )} />
                <Label htmlFor="useLiquiditySweeps">Liquidity Sweeps</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Controller name="useBOS" control={form.control} render={({ field }) => (
                  <Switch id="useBOS" checked={field.value} onCheckedChange={field.onChange} />
                )} />
                <Label htmlFor="useBOS">Break of Structure (BOS)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Controller name="useChoCH" control={form.control} render={({ field }) => (
                  <Switch id="useChoCH" checked={field.value} onCheckedChange={field.onChange} />
                )} />
                <Label htmlFor="useChoCH">Change of Character (ChoCH)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Controller name="trailingStop" control={form.control} render={({ field }) => (
                  <Switch id="trailingStop" checked={field.value} onCheckedChange={field.onChange} />
                )} />
                <Label htmlFor="trailingStop">Trailing Stop Loss</Label>
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle>Execution Mode</CardTitle>
              <CardDescription>
                Reverse mode places the exact opposite of every generated signal: side flipped,
                stop and target mirrored (old target becomes the stop), and size recomputed
                against the new stop distance. Signals are still recorded in their original form.
                Test on Demo/Testnet before running this live.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Controller name="reverseSignals" control={form.control} render={({ field }) => (
                  <Switch
                    id="reverseSignals"
                    checked={field.value === true}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      form.setValue("reverseSignals", checked, { shouldDirty: true, shouldValidate: true });
                    }}
                  />
                )} />
                <Label htmlFor="reverseSignals">Reverse signal execution (counter-trade the bot)</Label>
              </div>
              <p className={form.watch("reverseSignals") ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>
                {form.watch("reverseSignals")
                  ? "Selected: REVERSE execution — click Save Settings to confirm."
                  : "Selected: Normal signal execution."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exchange Credentials</CardTitle>
              <CardDescription>Bybit API connection details. Leave blank to keep existing keys.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-xl">
              <div className="space-y-2">
                <Label htmlFor="bybitApiKey">API Key</Label>
                <Input id="bybitApiKey" type="password" placeholder="••••••••••••••••" {...form.register("bybitApiKey")} className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bybitApiSecret">API Secret</Label>
                <Input id="bybitApiSecret" type="password" placeholder="••••••••••••••••••••••••••••••••" {...form.register("bybitApiSecret")} className="font-mono" />
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Controller name="bybitTestnet" control={form.control} render={({ field }) => (
                  <Switch id="bybitTestnet" checked={field.value} onCheckedChange={field.onChange} />
                )} />
                <Label htmlFor="bybitTestnet">Use Testnet</Label>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={updateSettings.isPending} className="w-full sm:w-auto h-11">
              {updateSettings.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      )}
    </Layout>
  );
}
