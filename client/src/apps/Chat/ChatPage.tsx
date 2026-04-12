import { Bot } from 'lucide-react';

import { AppLayout } from '@/components/AppLayout';

export default function ChatPage() {
    return (
        <AppLayout
            icon={<Bot size={20} />}
            iconClassName="bg-fuchsia-500/10 text-fuchsia-500"
            title="Sebastian"
            subtitle="Chat with your AI agent"
        >
            <iframe
                src="/fluxy"
                title="Sebastian Chat"
                className="w-full h-full border-none"
                allow="microphone"
            />
        </AppLayout>
    );
}
