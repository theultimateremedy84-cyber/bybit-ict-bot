import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, LineChart, History, Settings, Zap, Globe, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: History },
  { href: "/signals", label: "Signals", icon: Zap },
  { href: "/performance", label: "Performance", icon: LineChart },
  { href: "/markets", label: "Markets", icon: Globe },
  { href: "/settings", label: "Settings", icon: Settings },
];

// Items shown in the fixed bottom bar on phones (most used first).
const mobileNavItems = navItems.slice(0, 5);

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();

  return (
    <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
      {navItems.map((item) => {
        const isActive = location === item.href;
        return (
          <Link key={item.href} href={item.href}>
            <div
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors cursor-pointer",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 text-primary font-bold text-base sm:text-lg font-mono min-w-0">
      <Activity className="h-5 w-5 shrink-0" />
      <span className="truncate">ICT_TERMINAL</span>
    </div>
  );
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-[100dvh] w-full bg-background text-foreground md:h-screen md:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 border-r border-border bg-card flex-col flex-shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Brand />
        </div>
        <NavList />
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            System Online
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 md:h-full md:overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-40 flex items-center gap-3 h-14 px-4 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation" data-testid="button-open-nav">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 flex flex-col bg-card">
              <div className="h-14 flex items-center px-4 border-b border-border">
                <Brand />
              </div>
              <NavList onNavigate={() => setOpen(false)} />
              <div className="p-4 border-t border-border">
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  System Online
                </div>
              </div>
            </SheetContent>
          </Sheet>
          <Brand />
        </header>

        <div className="flex-1 md:overflow-y-auto p-4 pb-24 sm:p-6 md:pb-6">
          <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">{children}</div>
        </div>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 pb-[env(safe-area-inset-bottom)]">
          <div className="grid grid-cols-5">
            {mobileNavItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                    data-testid={`bottomnav-${item.label.toLowerCase()}`}
                  >
                    <item.icon className="h-5 w-5" />
                    <span className="truncate max-w-full px-1">{item.label}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>
      </main>
    </div>
  );
}
