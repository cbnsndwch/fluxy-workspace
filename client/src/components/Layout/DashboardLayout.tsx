import MobileNav from './MobileNav';
import Sidebar from './Sidebar';

import type { ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

export default function DashboardLayout({ children }: Props) {
    return (
        <div className="flex h-dvh flex-col bg-background">
            {/* Mobile header */}
            <header className="flex items-center justify-between px-4 py-3 md:hidden">
                <MobileNav />
                <div className="flex items-center gap-2">
                    <img
                        src="/sebastian.png"
                        alt="Sebastian"
                        className="h-7 w-7 rounded-full object-cover"
                    />
                    <span className="font-semibold text-base">
                        Sebastian FastClaw
                    </span>
                </div>
                <div className="w-10" />
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Desktop sidebar */}
                <div className="hidden md:flex shrink-0">
                    <Sidebar />
                </div>

                {/* Main content */}
                <main className="flex-1 overflow-y-auto">{children}</main>
            </div>
        </div>
    );
}
