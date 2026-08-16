import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Dashboard from '@/pages/dashboard';
import Trades from '@/pages/trades';
import Signals from '@/pages/signals';
import Performance from '@/pages/performance';
import Markets from '@/pages/markets';
import Settings from '@/pages/settings';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { useEffect } from 'react';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/trades" component={Trades} />
      <Route path="/signals" component={Signals} />
      <Route path="/performance" component={Performance} />
      <Route path="/markets" component={Markets} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
