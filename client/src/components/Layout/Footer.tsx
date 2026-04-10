export default function Footer({ connected }: { connected: boolean }) {
  return (
    <footer className="flex items-center px-4 md:px-6 py-2.5 text-[11px] text-muted-foreground/60 shrink-0">
      <div className="flex items-center gap-1.5">
        <div
          className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
        />
        <span>{connected ? "Connected" : "Disconnected"}</span>
      </div>
    </footer>
  );
}
