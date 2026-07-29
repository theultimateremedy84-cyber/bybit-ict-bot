import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetTrades } from "@/lib/api";
import { format } from "date-fns";

export default function Trades() {
  const { data: trades, isLoading } = useGetTrades();

  const formatCurrency = (val: number | null) => {
    if (val === null || val === undefined) return "-";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
  };

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Trade History</h1>
        <p className="text-muted-foreground mt-1 text-sm">Full log of executed setups and results.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Trades</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : trades && trades.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Market</TableHead>
                  <TableHead>Dir</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Entry / Exit</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">PNL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {format(new Date(trade.entryDate), 'MM/dd HH:mm')}
                    </TableCell>
                    <TableCell className="font-mono font-medium">{trade.market}</TableCell>
                    <TableCell>
                      <Badge variant={trade.direction === 'BUY' ? 'success' : 'destructive'} className="font-mono text-[10px]">
                        {trade.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{trade.size}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {trade.entryPrice} <br /> {trade.exitPrice || 'OPEN'}
                    </TableCell>
                    <TableCell>
                      {trade.result ? (
                        <Badge 
                          variant={trade.result === 'WIN' ? 'success' : trade.result === 'LOSS' ? 'destructive' : 'outline'}
                          className="font-mono text-[10px]"
                        >
                          {trade.result}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="font-mono text-[10px]">OPEN</Badge>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-bold ${trade.profit && trade.profit > 0 ? 'text-success' : trade.profit && trade.profit < 0 ? 'text-destructive' : ''}`}>
                      {trade.profit && trade.profit > 0 ? '+' : ''}{formatCurrency(trade.profit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground font-mono text-sm border border-dashed border-border rounded-lg">
              NO TRADES EXECUTED YET
            </div>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
}
