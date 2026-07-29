import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetPerformance } from "@/lib/api";
import { Activity, Target, TrendingUp, TrendingDown, DollarSign, BarChart3, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Performance() {
  const { data: perf, isLoading } = useGetPerformance();

  const formatCurrency = (val: number | undefined) => {
    if (val === undefined) return "-";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
  };

  const formatPct = (val: number | undefined) => {
    if (val === undefined) return "-";
    return `${(val * 100).toFixed(1)}%`;
  };

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Performance Metrics</h1>
        <p className="text-muted-foreground mt-1 text-sm">Aggregated statistics and drawdowns across all markets.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total PNL</p>
                {isLoading ? <Skeleton className="h-8 w-24" /> : (
                  <p className={`text-2xl font-bold font-mono ${perf && perf.totalPnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {perf && perf.totalPnl > 0 ? '+' : ''}{formatCurrency(perf?.totalPnl)}
                  </p>
                )}
              </div>
              <DollarSign className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Win Rate</p>
                {isLoading ? <Skeleton className="h-8 w-20" /> : (
                  <p className="text-2xl font-bold font-mono">{formatPct(perf?.winRate)}</p>
                )}
              </div>
              <Target className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Trades</p>
                {isLoading ? <Skeleton className="h-8 w-16" /> : (
                  <p className="text-2xl font-bold font-mono">{perf?.totalTrades || 0}</p>
                )}
              </div>
              <Activity className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Avg R:R</p>
                {isLoading ? <Skeleton className="h-8 w-16" /> : (
                  <p className="text-2xl font-bold font-mono">1:{perf?.avgRR?.toFixed(2) || '0.00'}</p>
                )}
              </div>
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wider mb-1">Best Trade</p>
              {isLoading ? <Skeleton className="h-6 w-20" /> : (
                <p className="text-lg font-mono font-bold text-success">+{formatCurrency(perf?.bestTrade)}</p>
              )}
            </div>
            <TrendingUp className="h-8 w-8 text-success/50" />
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wider mb-1">Worst Trade</p>
              {isLoading ? <Skeleton className="h-6 w-20" /> : (
                <p className="text-lg font-mono font-bold text-destructive">{formatCurrency(perf?.worstTrade)}</p>
              )}
            </div>
            <TrendingDown className="h-8 w-8 text-destructive/50" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wider mb-1">Max Drawdown</p>
              {isLoading ? <Skeleton className="h-6 w-20" /> : (
                <p className="text-lg font-mono font-bold text-warning">{formatPct(perf?.maxDrawdown)}</p>
              )}
            </div>
            <AlertTriangle className="h-8 w-8 text-warning/50" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-Market Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : perf?.byMarket && perf.byMarket.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Market</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Wins</TableHead>
                  <TableHead>Losses</TableHead>
                  <TableHead>Win Rate</TableHead>
                  <TableHead className="text-right">PNL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perf.byMarket.map((m) => (
                  <TableRow key={m.market}>
                    <TableCell className="font-mono font-bold">{m.market}</TableCell>
                    <TableCell className="font-mono">{m.trades}</TableCell>
                    <TableCell className="font-mono text-success">{m.wins}</TableCell>
                    <TableCell className="font-mono text-destructive">{m.losses}</TableCell>
                    <TableCell className="font-mono">{formatPct(m.winRate)}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${m.pnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {m.pnl > 0 ? '+' : ''}{formatCurrency(m.pnl)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground font-mono text-sm border border-dashed border-border rounded-lg">
              NO MARKET DATA AVAILABLE
            </div>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
}
