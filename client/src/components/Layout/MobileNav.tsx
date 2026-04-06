import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import Sidebar from './Sidebar';

export default function MobileNav() {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="flex items-center justify-center h-10 w-10 rounded-lg text-muted-foreground hover:text-foreground transition-colors md:hidden"
            >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open navigation</span>
            </button>
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent
                    side="left"
                    className="p-0 w-64"
                    showCloseButton={false}
                >
                    <SheetTitle className="sr-only">Navigation</SheetTitle>
                    <Sidebar />
                </SheetContent>
            </Sheet>
        </>
    );
}
