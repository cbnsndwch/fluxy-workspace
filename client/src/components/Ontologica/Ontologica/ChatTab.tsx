import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Send,
  Loader2,
  Box,
  Share2,
  CircleDot,
  Sparkles,
  MessageSquare,
  HelpCircle,
  Lightbulb,
  Trash2,
} from 'lucide-react';

import { useProjectContext } from './context';

interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  actions?: string;
  created_at: string;
}

interface AppliedAction {
  type: string;
  name: string;
  description?: string;
  domain?: string;
  range?: string;
  success: boolean;
  error?: string;
}

const ACTION_ICONS: Record<string, typeof Box> = {
  add_class: Box,
  add_individual: CircleDot,
  add_object_property: Share2,
  add_data_property: Share2,
  add_is_a: Share2,
};

const ACTION_LABELS: Record<string, string> = {
  add_class: 'concept',
  add_individual: 'instance',
  add_object_property: 'connection',
  add_data_property: 'attribute',
  add_is_a: 'hierarchy',
  remove_class: 'removed',
  update_class: 'updated',
};

export function ChatTab() {
  const { projectId, loadGraph, loadStats, loadProject } = useProjectContext();
  const onGraphChange = () => { loadGraph(); loadStats(); loadProject(); };
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [lastActions, setLastActions] = useState<AppliedAction[]>([]);
  const [lastQuestions, setLastQuestions] = useState<string[]>([]);
  const [lastSuggestions, setLastSuggestions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const loadConversations = useCallback(async () => {
    const res = await fetch(`/app/api/ontologica/projects/${projectId}/conversations`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data);
    }
  }, [projectId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sending) return;

    setInput('');
    setSending(true);
    setLastActions([]);
    setLastQuestions([]);
    setLastSuggestions([]);

    // Optimistic add
    const tempUserMsg: Message = {
      id: Date.now(),
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await fetch(`/app/api/ontologica/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Chat failed');
      }

      const data = await res.json();
      const { response, appliedActions } = data;

      // Add assistant message
      const assistantMsg: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.message,
        actions: JSON.stringify(appliedActions || []),
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      setLastActions(appliedActions || []);
      setLastQuestions(response.questions || []);
      setLastSuggestions(response.suggestions || []);

      // Notify parent to refresh graph
      if (appliedActions?.some((a: AppliedAction) => a.success)) {
        onGraphChange();
      }
    } catch (err: any) {
      const errorMsg: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `Something went wrong: ${err.message}`,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuestionClick = (q: string) => {
    setInput(q);
    textareaRef.current?.focus();
  };

  const handleClearChat = async () => {
    await fetch(`/app/api/ontologica/projects/${projectId}/conversations`, { method: 'DELETE' });
    setMessages([]);
    setLastActions([]);
    setLastQuestions([]);
    setLastSuggestions([]);
  };

  const renderActions = (actionsJson: string | undefined) => {
    if (!actionsJson) return null;
    let actions: AppliedAction[];
    try { actions = JSON.parse(actionsJson); } catch { return null; }
    if (!actions.length) return null;

    const successful = actions.filter(a => a.success);
    if (!successful.length) return null;

    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        {successful.map((a, i) => {
          const Icon = ACTION_ICONS[a.type] || Box;
          return (
            <Badge
              key={i}
              variant="outline"
              className="text-[10px] gap-1 border-emerald-500/30 text-emerald-400"
            >
              <Icon size={10} />
              {ACTION_LABELS[a.type] || a.type}: {a.name}
            </Badge>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center h-full min-h-[300px]">
            <div className="text-center max-w-md">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                <Sparkles size={28} className="text-emerald-500" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Describe your business</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Tell me how your business works in plain language. I'll extract the concepts,
                relationships, and structure — building your knowledge map as we talk.
              </p>
              <div className="space-y-2 text-left">
                {[
                  'We have customers who place orders. Each order contains products from our catalog.',
                  'Our clinic has patients, doctors, and appointments. Patients get diagnosed with conditions.',
                  'We manage rental properties with tenants, leases, and maintenance requests.',
                ].map((example, i) => (
                  <button
                    key={i}
                    onClick={() => handleQuestionClick(example)}
                    className="w-full text-left text-xs p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    "{example}"
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-emerald-600 text-white rounded-br-md'
                  : 'bg-muted rounded-bl-md'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              {msg.role === 'assistant' && renderActions(msg.actions)}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
              <Loader2 size={16} className="animate-spin text-emerald-400" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions & questions */}
      {(lastQuestions.length > 0 || lastSuggestions.length > 0) && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {lastQuestions.map((q, i) => (
            <button
              key={`q-${i}`}
              onClick={() => handleQuestionClick(q)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-muted/50 hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <HelpCircle size={12} className="text-amber-400 shrink-0" />
              {q}
            </button>
          ))}
          {lastSuggestions.map((s, i) => (
            <button
              key={`s-${i}`}
              onClick={() => handleQuestionClick(s)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer text-emerald-400"
            >
              <Lightbulb size={12} className="shrink-0" />
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex items-end gap-2">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearChat}
              className="shrink-0 text-muted-foreground hover:text-red-400"
              title="Clear conversation"
            >
              <Trash2 size={16} />
            </Button>
          )}
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your business domain..."
            rows={1}
            className="resize-none min-h-[42px] max-h-[120px]"
            disabled={sending}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </Button>
        </div>
      </div>
    </div>
  );
}
