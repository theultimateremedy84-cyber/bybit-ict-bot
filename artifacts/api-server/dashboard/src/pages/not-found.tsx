import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground p-4">
      <Card className="w-full max-w-md border-destructive/50">
        <CardContent className="pt-6 flex flex-col items-center text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div className="space-y-2">
            <h1 className="text-2xl font-bold font-mono tracking-tighter">404 - SYSTEM OFFLINE</h1>
            <p className="text-sm text-muted-foreground font-mono">
              The requested quadrant could not be located in the current workspace.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
