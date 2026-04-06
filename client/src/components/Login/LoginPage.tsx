import { Button } from '@/components/ui/button';
import { GithubIcon } from '@/components/icons/GithubIcon';

export default function LoginPage({ error }: { error?: boolean }) {
    return (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-background">
            {/* Card */}
            <div className="flex flex-col items-center gap-8 px-8 py-10 rounded-2xl border border-border/50 bg-card shadow-lg w-full max-w-sm">
                {/* Logo */}
                <div className="flex flex-col items-center gap-3">
                    <img
                        src="/sebastian.png"
                        alt="Sebastian"
                        className="h-16 w-16 rounded-full object-cover ring-2 ring-border/50"
                    />
                    <div className="text-center">
                        <h1 className="text-xl font-semibold">Sebastian FastClaw</h1>
                        <p className="text-sm text-muted-foreground mt-1">Your personal workspace</p>
                    </div>
                </div>

                <div className="w-full border-t border-border/40" />

                {/* Auth */}
                <div className="flex flex-col items-center gap-4 w-full">
                    <p className="text-sm text-muted-foreground text-center">
                        Sign in to access your workspace
                    </p>

                    <Button
                        className="w-full gap-2 cursor-pointer"
                        size="lg"
                        onClick={() => { window.location.href = '/app/api/auth/github'; }}
                    >
                        <GithubIcon size={16} className="h-4 w-4" />
                        Sign in with GitHub
                    </Button>

                    {error && (
                        <p className="text-xs text-destructive text-center">
                            Authentication failed. Please try again.
                        </p>
                    )}
                </div>
            </div>

            <p className="mt-6 text-xs text-muted-foreground/40">
                Only you have access to this workspace
            </p>
        </div>
    );
}
