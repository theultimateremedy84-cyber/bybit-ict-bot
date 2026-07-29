import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetSignals } from "@workspace/api-client-react";
import { format } from "date-fns";

export default function Signals() {
  const { data: signals, isLoading } = useGetSignals();

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">ICT Signals</h1>
        <p className="text-muted-foreground mt-1 text-sm">Real-time log of detected Smart Money Concepts patterns.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Signal Feed</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : signals && signals.length > 0 ? (
            <div className="space-y-4">
              {signals.map((sig) => (
                <div key={sig.id} className="flex flex-col p-4 rounded-md bg-secondary/30 border border-border">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <Badge variant={sig.direction === 'BUY' ? 'success' : 'destructive'} className="font-mono text-[10px]">
                        {sig.direction}
                      </Badge>
                      <span className="font-mono font-bold text-lg">{sig.market}</span>
                      <span className="text-muted-foreground font-mono text-sm">{sig.timeframe}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {format(new Date(sig.detectedAt), 'yyyy-MM-dd HH:mm:ss')}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase mb-1">Type</p>
                      <Badge variant="outline" className="font-mono text-[10px]">{sig.signalType}</Badge>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase mb-1">Kill Zone</p>
                      <Badge variant="secondary" className="font-mono text-[10px]">{sig.killZone || 'NONE'}</Badge>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase mb-1">Confidence</p>
                      <span className="font-mono text-sm font-medium">{(sig.confidence * 100).toFixed(1)}%</span>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase mb-1">Status</p>
                      <Badge variant={sig.executed ? 'default' : 'outline'} className="font-mono text-[10px]">
                        {sig.executed ? 'EXECUTED' : 'PENDING'}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 p-3 bg-background rounded-md border border-border mb-3">
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase block">Entry</span>
                      <span className="font-mono text-sm">{sig.entryPrice}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-destructive uppercase block">Stop Loss</span>
                      <span className="font-mono text-sm text-destructive">{sig.stopLoss}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-success uppercase block">Take Profit</span>
                      <span className="font-mono text-sm text-success">{sig.takeProfit}</span>
                    </div>
                  </div>

                  {(sig.notes || sig.htfBias || sig.structureContext) && (
                    <div className="text-xs text-muted-foreground space-y-1 bg-muted/20 p-3 rounded-md">
                      {sig.htfBias && <p><strong className="text-foreground">HTF Bias:</strong> {sig.htfBias}</p>}
                      {sig.structureContext && <p><strong className="text-foreground">Context:</strong> {sig.structureContext}</p>}
                      {sig.notes && <p><strong className="text-foreground">Notes:</strong> {sig.notes}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground font-mono text-sm border border-dashed border-border rounded-lg">
              NO SIGNALS DETECTED
            </div>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
}
