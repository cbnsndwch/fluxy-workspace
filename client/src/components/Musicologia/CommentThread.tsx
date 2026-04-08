import { useState, useCallback } from "react";
import { useAuthStore } from "@/store/auth";
import { formatDistanceToNow } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Comment {
  id: number;
  user_id: number | null;
  user_name: string;
  user_avatar: string | null;
  body: string;
  parent_id: number | null;
  created_at: string;
  replies: Comment[];
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div
      className="rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-white/60 font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials}
    </div>
  );
}

// ── Single Comment ────────────────────────────────────────────────────────────

function CommentItem({
  comment,
  currentUserId,
  onReply,
  onDelete,
  depth = 0,
}: {
  comment: Comment;
  currentUserId: number | null;
  onReply: (parentId: number, body: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  depth?: number;
}) {
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const ts = (() => {
    try {
      return formatDistanceToNow(new Date(comment.created_at), { addSuffix: true });
    } catch {
      return "";
    }
  })();

  const handleReply = async () => {
    if (!replyBody.trim()) return;
    setSubmitting(true);
    try {
      await onReply(comment.id, replyBody.trim());
      setReplyBody("");
      setReplying(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={depth > 0 ? "ml-8 mt-3" : "mt-4"}>
      <div className="flex gap-3">
        <Avatar src={comment.user_avatar} name={comment.user_name} size={28} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-white/80">{comment.user_name}</span>
            <span className="text-xs text-white/30">{ts}</span>
            {currentUserId === comment.user_id && (
              <button
                onClick={() => onDelete(comment.id)}
                className="text-xs text-white/20 hover:text-red-400 transition-colors ml-auto cursor-pointer"
              >
                delete
              </button>
            )}
          </div>
          <p className="text-sm text-white/60 leading-relaxed whitespace-pre-wrap">
            {comment.body}
          </p>
          {depth === 0 && currentUserId !== null && (
            <button
              onClick={() => setReplying((r) => !r)}
              className="text-xs text-white/30 hover:text-white/60 mt-1 transition-colors cursor-pointer"
            >
              {replying ? "cancel" : "reply"}
            </button>
          )}
          {replying && (
            <div className="mt-2 flex gap-2">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Write a reply…"
                rows={2}
                className="flex-1 text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white/70 placeholder:text-white/20 resize-none focus:outline-none focus:border-white/20"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleReply();
                }}
              />
              <button
                onClick={handleReply}
                disabled={submitting || !replyBody.trim()}
                className="self-end px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? "…" : "Post"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Nested replies */}
      {comment.replies.map((reply) => (
        <CommentItem
          key={reply.id}
          comment={reply}
          currentUserId={currentUserId}
          onReply={onReply}
          onDelete={onDelete}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function CommentThread({
  targetType,
  targetId,
  comments,
  onCommentsChange,
}: {
  targetType: "track" | "playlist";
  targetId: number;
  comments: Comment[];
  onCommentsChange: (comments: Comment[]) => void;
}) {
  const { user } = useAuthStore();
  const [newBody, setNewBody] = useState("");
  const [posting, setPosting] = useState(false);

  const postComment = useCallback(
    async (body: string, parentId: number | null = null) => {
      const res = await fetch("/app/api/musicologia/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          body,
          parent_id: parentId,
        }),
      });
      if (!res.ok) throw new Error("Failed to post comment");
      const comment = (await res.json()) as Comment;
      return comment;
    },
    [targetType, targetId],
  );

  const handlePost = async () => {
    if (!newBody.trim()) return;
    setPosting(true);
    try {
      const comment = await postComment(newBody.trim());
      onCommentsChange([...comments, comment]);
      setNewBody("");
    } finally {
      setPosting(false);
    }
  };

  const handleReply = useCallback(
    async (parentId: number, body: string) => {
      const reply = await postComment(body, parentId);
      // Insert reply into the correct parent
      const insertReply = (list: Comment[]): Comment[] =>
        list.map((c) =>
          c.id === parentId
            ? { ...c, replies: [...c.replies, reply] }
            : { ...c, replies: insertReply(c.replies) },
        );
      onCommentsChange(insertReply(comments));
    },
    [postComment, comments, onCommentsChange],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      await fetch(`/app/api/musicologia/comments/${id}`, { method: "DELETE" });
      const removeById = (list: Comment[]): Comment[] =>
        list.filter((c) => c.id !== id).map((c) => ({ ...c, replies: removeById(c.replies) }));
      onCommentsChange(removeById(comments));
    },
    [comments, onCommentsChange],
  );

  const totalCount = (() => {
    const count = (list: Comment[]): number =>
      list.reduce((acc, c) => acc + 1 + count(c.replies), 0);
    return count(comments);
  })();

  return (
    <div className="mt-6">
      <h3 className="text-xs text-white/30 uppercase tracking-widest mb-4">
        {totalCount > 0 ? `${totalCount} comment${totalCount !== 1 ? "s" : ""}` : "Comments"}
      </h3>

      {/* Comment list */}
      <div className="space-y-0">
        {comments.length === 0 && (
          <p className="text-sm text-white/20 italic">No comments yet. Be the first!</p>
        )}
        {comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            currentUserId={user?.id ?? null}
            onReply={handleReply}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* New comment input */}
      {user ? (
        <div className="mt-6 flex gap-3">
          <Avatar src={user.avatar_url ?? null} name={user.name ?? user.login} size={28} />
          <div className="flex-1">
            <textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Share your thoughts…"
              rows={3}
              className="w-full text-sm bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white/70 placeholder:text-white/20 resize-none focus:outline-none focus:border-white/20 transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePost();
              }}
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-white/20">⌘↵ to post</span>
              <button
                onClick={handlePost}
                disabled={posting || !newBody.trim()}
                className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {posting ? "Posting…" : "Post comment"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-white/20">Sign in to leave a comment.</p>
      )}
    </div>
  );
}
