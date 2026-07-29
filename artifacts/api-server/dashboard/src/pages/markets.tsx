import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetMarkets, getGetMarketsQueryKey } from "@/lib/api";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

export default function Markets() {
  const { data: markets, isLoading } = useGetMarkets({ query: { refetchInterval: 5000, queryKey: getGetMarketsQueryKey() } });

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(val);
  };

  const formatPct = (val: number) => {
    return `${(val > 0 ? '+' : '')}${(val).toFixed(2)}%`;
  };

  const formatVol = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(2)}K`;
    return `$${val.toFixed(2)}`;
  };

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Market Data</h1>
        <p className="text-muted-foreground mt-1 text-sm">Live perpetual contracts prices and 24h stats.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Enabled Symbols</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : markets && markets.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>24h Change</TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead>24h High</TableHead>
                  <TableHead>24h Low</TableHead>
                  <TableHead className="text-right">24h Vol</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {markets.map((market) => (
                  <TableRow key={market.symbol}>
                    <TableCell className="font-mono font-bold">
                      {market.symbol}
                      <span className="block text-[10px] text-muted-foreground font-sans font-normal">{market.name}</span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{formatCurrency(market.lastPrice)}</TableCell>
                    <TableCell className={`font-mono text-sm ${market.changePercent > 0 ? 'text-success' : market.changePercent < 0 ? 'text-destructive' : ''}`}>
                      {formatPct(market.changePercent)}
                    </TableCell>
                    <TableCell>
                      {market.trend === 'BULLISH' && <ArrowUpRight className="h-4 w-4 text-success" />}
                      {market.trend === 'BEARISH' && <ArrowDownRight className="h-4 w-4 text-destructive" />}
                      {market.trend === 'SIDEWAYS' && <Minus className="h-4 w-4 text-muted-foreground" />}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{formatCurrency(market.high24h)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{formatCurrency(market.low24h)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatVol(market.volume24h)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground font-mono text-sm border border-dashed border-border rounded-lg">
              NO MARKETS ENABLED OR DATA UNAVAILABLE
            </div>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
}
