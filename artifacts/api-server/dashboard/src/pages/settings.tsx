import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const settingsSchema = z.object({
  riskPerTrade: z.coerce.number().min(0.1).max(10),
  maxOpenTrades: z.coerce.number().min(1).max(20),
  dailyLossLimit: z.coerce.number().min(1).max(50),
  minConfidence: z.coerce.number().min(0).max(100),
  minRR: z.coerce.number().min(1).max(10),
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

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      riskPerTrade: 1,
      maxOpenTrades: 3,
      dailyLossLimit: 5,
      minConfidence: 55,
      minRR: 2,
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
        riskPerTrade: settings.riskPerTrade,
        maxOpenTrades: settings.maxOpenTrades,
        dailyLossLimit: settings.dailyLossLimit,
        minConfidence: settings.minConfidence,
        minRR: settings.minRR,
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
        toast({ title: "Settings Updated", description: "Bot settings have been saved successfully." });
        queryClient.setQueryData(getGetSettingsQueryKey(), updated);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update settings.", variant: "destructive" });
      }
    });
  };

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
                <Label htmlFor="riskPerTrade">Risk Per Trade (%)</Label>
                <Input id="riskPerTrade" type="number" step="0.1" {...form.register("riskPerTrade")} className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxOpenTrades">Max Open Trades</Label>
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
                  <Switch id="reverseSignals" checked={field.value} onCheckedChange={field.onChange} />
                )} />
                <Label htmlFor="reverseSignals">Reverse signal execution (counter-trade the bot)</Label>
              </div>
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
