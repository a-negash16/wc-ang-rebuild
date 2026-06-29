"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "wc_ang_rebuild_session";
const MAX_COMMENT_LENGTH = 30;

export default function CommentSection({ groupSlug, initialComments = [] }) {
  const [comments, setComments] = useState(initialComments);
  const [session, setSession] = useState(null);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function syncSession() {
      setSession(loadSession(groupSlug));
    }

    syncSession();
    window.addEventListener("focus", syncSession);
    window.addEventListener("click", syncSession);
    return () => {
      window.removeEventListener("focus", syncSession);
      window.removeEventListener("click", syncSession);
    };
  }, [groupSlug]);

  async function submitComment(event) {
    event.preventDefault();
    if (!session?.token) {
      setStatus("Unlock in Manager Picks before commenting.");
      return;
    }

    const cleanComment = comment.trim();
    if (!cleanComment) {
      setStatus("Comment is required.");
      return;
    }
    if (cleanComment.length > MAX_COMMENT_LENGTH) {
      setStatus(`Keep comments under ${MAX_COMMENT_LENGTH} characters.`);
      return;
    }

    setBusy(true);
    setStatus("Posting anonymously...");
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: session.token,
          comment: cleanComment,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not post comment");
      setComments((current) => [{ ...payload.comment, anonymous_label: "Anonymous" }, ...current].slice(0, 30));
      setComment("");
      setStatus("Posted anonymously.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section section-band comments-section" id="comments" aria-labelledby="comments-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Group chat</p>
          <h2 id="comments-title">Comments</h2>
        </div>
        <span className="status-chip">Anonymous wall</span>
      </div>

      <article className="panel comments-panel">
        <form className="comment-form" onSubmit={submitComment}>
          <label>
            <span>Recommendation, suggestion, or game talk</span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={MAX_COMMENT_LENGTH}
              placeholder={session ? "Post anonymously to your group..." : "Unlock in Manager Picks to post anonymously."}
              disabled={!session || busy}
            />
          </label>
          <div className="comment-form-footer">
            <small>{comment.length}/{MAX_COMMENT_LENGTH}</small>
            <button type="submit" disabled={!session || busy}>
              Post
            </button>
          </div>
          {status ? <p className="form-status">{status}</p> : null}
        </form>

        <div className="comment-list" aria-label="Anonymous group comments">
          {comments.length ? (
            comments.map((item) => (
              <article className="comment-card" key={item.id}>
                <header>
                  <strong>{item.anonymous_label || "Anonymous"}</strong>
                  <time>{formatCommentTime(item.created_at)}</time>
                </header>
                <p>{item.body}</p>
              </article>
            ))
          ) : (
            <div className="empty-state compact">
              <strong>No comments yet.</strong>
              <span>Unlocked managers can start the anonymous game thread.</span>
            </div>
          )}
        </div>
      </article>
    </section>
  );
}

function loadSession(groupSlug) {
  if (typeof window === "undefined") return null;
  try {
    const payload = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (!payload || payload.group_slug !== groupSlug) return null;
    if (payload.expires_at && new Date(payload.expires_at).getTime() <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function formatCommentTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
