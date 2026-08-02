import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Power, PowerOff, Activity, Wallet, TrendingUp, AlertTriangle } from "lucide-react";
import { 
  useGetBotStatus, useGetAccount, useGetPositions, 
  useGetSignals, useStartBot, useStopBot, 
  getGetBotStatusQueryKey, getGetAccountQueryKey, getGetPositionsQueryKey, 
  getGetSignalsQueryKey
} from "@/lib/api";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Dashboard() {
  const queryClient = useQueryClient();
  
  const { data: status, isLoading: statusLoading } = useGetBotStatus({ query: { refetchInterval: 5000, queryKey: getGetBotStatusQueryKey() } });
  const { data: account, isLoading: accountLoading } = useGetAccount({ query: { refetchInterval: 2000, refetchIntervalInBackground: true, staleTime: 0, queryKey: getGetAccountQueryKey() } });
  const { data: positions, isLoading: positionsLoading } = useGetPositions({ query: { refetchInterval: 2000, refetchIntervalInBackground: true, staleTime: 0, queryKey: getGetPositionsQueryKey() } });
  const { data: signals, isLoading: signalsLoading } = useGetSignals({ limit: 5 }, { query: { refetchInterval: 5000, queryKey: getGetSignalsQueryKey({ limit: 5 }) } });

  const startBot = useStartBot();
  const stopBot = useStopBot();

  const handleToggleBot = () => {
    if (!status) return;
    if (status.running) {
      stopBot.mutate(undefined, {
        onSuccess: (data) => queryClient.setQueryData(getGetBotStatusQueryKey(), data)
      });
    } else {
      startBot.mutate(undefined, {
        onSuccess: (data) => queryClient.setQueryData(getGetBotStatusQueryKey(), data)
      });
    }
  };

  // Live floating PnL: prefer the sum of open positions (updates every poll),
  // fall back to the wallet aggregate when positions aren't available yet.
  const positionsPnl = (positions ?? []).reduce(
    (sum, p) => sum + (Number(p.unrealisedPnl) || 0),
    0,
  );
  const floatingPnl =
    positions && positions.length > 0 ? positionsPnl : Number(account?.unrealisedPnl ?? 0);

  const formatCurrency = (val: number | undefined) => {
    if (val === undefined) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
  };

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-4 sm:mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Real-time overview of bot performance and market conditions.</p>
        </div>
        <div className="flex items-center gap-4 w-full sm:w-auto">
          {statusLoading ? (
            <Skeleton className="h-10 w-full sm:w-32" />
          ) : (
            <Button
              variant={status?.running ? "destructive" : "success"}
              onClick={handleToggleBot}
              disabled={startBot.isPending || stopBot.isPending}
              className="font-mono uppercase tracking-wider w-full sm:w-auto h-11"
              data-testid="button-toggle-bot"
            >
              {status?.running ? <PowerOff className="mr-2 h-4 w-4" /> : <Power className="mr-2 h-4 w-4" />}
              {status?.running ? "Stop Bot" : "Start Bot"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 sm:p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Bot Status</p>
                {statusLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="flex items-center gap-2">
                    <div className={`h-3 w-3 rounded-full ${status?.running ? 'bg-success animate-pulse' : 'bg-destructive'}`} />
                    <span className="text-2xl font-bold font-mono">{status?.running ? 'ACTIVE' : 'HALTED'}</span>
                  </div>
                )}
              </div>
              <Activity className="h-5 w-5 text-muted-foreground" />
            </div>
            {status?.error && (
              <p className="text-xs text-destructive mt-4 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {status.error}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 sm:p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Equity</p>
                {accountLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <p className="text-2xl font-bold font-mono">{formatCurrency(account?.equity)}</p>
                )}
              </div>
              <Wallet className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 sm:p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Unrealized PNL</p>
                {accountLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <p className={`text-2xl font-bold font-mono ${floatingPnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {floatingPnl > 0 ? '+' : ''}{formatCurrency(floatingPnl)}
                  </p>
                )}
              </div>
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 sm:p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Open Positions</p>
                {positionsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <p className="text-2xl font-bold font-mono">{positions?.length || 0}</p>
                )}
              </div>
              <Activity className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Active Positions</CardTitle>
            <CardDescription>Currently open trades across all markets.</CardDescription>
          </CardHeader>
          <CardContent>
            {positionsLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : positions && positions.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead className="text-right">PNL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((pos) => (
                    <TableRow key={pos.symbol}>
                      <TableCell className="font-mono font-medium">{pos.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={pos.direction === 'BUY' ? 'success' : 'destructive'} className="font-mono">
                          {pos.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">{pos.size}</TableCell>
                      <TableCell className="font-mono">{pos.openLevel}</TableCell>
                      <TableCell className={`text-right font-mono font-bold ${pos.unrealisedPnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {pos.unrealisedPnl >= 0 ? '+' : ''}{formatCurrency(pos.unrealisedPnl)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground font-mono text-sm border border-dashed border-border rounded-lg">
                NO OPEN POSITIONS
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Signals</CardTitle>
            <CardDescription>Latest ICT setups detected by the algorithm.</CardDescription>
          </CardHeader>
          <CardContent>
            {signalsLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : signals && signals.length > 0 ? (
              <div className="space-y-4">
                {signals.map((sig) => (
                  <div key={sig.id} className="flex items-center justify-between p-3 rounded-md bg-secondary/50 border border-border">
                    <div className="flex items-center gap-3">
                      <div className={`w-1.5 h-10 rounded-full ${sig.direction === 'BUY' ? 'bg-success' : 'bg-destructive'}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">{sig.market}</span>
                          <Badge variant="outline" className="text-[10px] py-0">{sig.signalType}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 font-mono">
                          {format(new Date(sig.detectedAt), 'HH:mm:ss')} • Conf: {(sig.confidence * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm">{sig.entryPrice}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-1">
                        {sig.killZone || 'NO KZ'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground font-mono text-sm border border-dashed border-border rounded-lg">
                NO RECENT SIGNALS
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
