const STARTER_IDEAS = [
    'Create a habit tracker',
    'Make a finance dashboard',
    'Build a task manager',
    'Build a notes app',
];

function handleSuggestion(text: string) {
    const panel = document.getElementById('fluxy-widget-panel');
    if (panel && !panel.classList.contains('open')) {
        const toggle = document.getElementById('fluxy-widget-bubble');
        toggle?.click();
    }
    setTimeout(() => {
        const iframe = document.querySelector<HTMLIFrameElement>(
            '#fluxy-widget-panel iframe',
        );
        if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage(
                { type: 'fluxy:fill-input', text },
                '*',
            );
        }
    }, 400);
}

export function StarterSuggestions() {
    return (
        <section className="w-full max-w-2xl">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
                Build something new
            </h2>
            <div className="flex flex-wrap gap-2">
                {STARTER_IDEAS.map((idea) => (
                    <button
                        key={idea}
                        onClick={() => handleSuggestion(idea)}
                        className="px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer"
                    >
                        {idea}
                    </button>
                ))}
            </div>
        </section>
    );
}
