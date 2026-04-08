import { LayoutDashboard, LogOut } from 'lucide-react';
import { NavLink } from 'react-router';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { mainApps, workspaceApps } from '@/lib/appRegistry';

export default function Sidebar() {
    const { user, logout } = useAuthStore();
    const [connected, setConnected] = useState(true);

    useEffect(() => {
        const check = () => {
            fetch('/app/api/health', { method: 'HEAD' })
                .then(() => setConnected(true))
                .catch(() => setConnected(false));
        };
        check();
        const id = setInterval(check, 15_000);
        return () => clearInterval(id);
    }, []);

    return (
        <aside className="flex flex-col h-full w-64 border-r border-border/50 bg-sidebar p-5 pt-8">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
                <img
                    src="/sebastian.png"
                    alt="Sebastian"
                    className="h-8 w-8 rounded-full object-cover"
                />
                <span className="font-semibold text-lg">
                    Sebastian FastClaw
                </span>
            </div>
            {/* Connection status */}
            <div className="flex items-center gap-1.5 mt-1.5 mb-6 px-0.5">
                <div
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${connected ? 'bg-emerald-500' : 'bg-red-500'}`}
                />
                <span className="text-[10px] text-muted-foreground/50">
                    {connected ? 'Connected' : 'Disconnected'}
                </span>
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-0.5">
                <NavItem icon={LayoutDashboard} label="Dashboard" to="/" end />
                {mainApps.map((app) => (
                    <NavItem
                        key={app.id}
                        icon={app.icon}
                        label={app.navLabel ?? app.name}
                        to={app.path}
                    />
                ))}
                <div className="pt-2 pb-1">
                    <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                        Workspace
                    </p>
                </div>
                {workspaceApps.map((app) => (
                    <NavItem
                        key={app.id}
                        icon={app.icon}
                        label={app.navLabel ?? app.name}
                        to={app.path}
                    />
                ))}
            </nav>

            {/* User profile */}
            {user && (
                <div className="pt-4 border-t border-border/50">
                    <div className="flex items-center gap-2.5 px-1">
                        {user.avatar_url ? (
                            <img
                                src={user.avatar_url}
                                alt={user.login}
                                className="h-7 w-7 rounded-full object-cover shrink-0"
                            />
                        ) : (
                            <div className="h-7 w-7 rounded-full bg-muted shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                                {user.name || user.login}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                                @{user.login}
                            </p>
                        </div>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                                        onClick={logout}
                                    >
                                        <LogOut className="h-3.5 w-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                    Sign out
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
            )}
        </aside>
    );
}

function NavItem({
    icon: Icon,
    label,
    to,
    end,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    to: string;
    end?: boolean;
}) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
                cn(
                    'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer',
                    isActive
                        ? 'bg-sidebar-accent text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50',
                )
            }
        >
            <Icon className="h-4.5 w-4.5" />
            {label}
        </NavLink>
    );
}
