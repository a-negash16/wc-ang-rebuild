"use client";

import { useMemo, useState } from "react";

const STORAGE_KEY = "wc_ang_rebuild_session";

export default function PredictionPanel({ groupSlug, matches }) {
  const [session, setSession] = useState(() => loadSession(groupSlug));
  const [managerCode, setManagerCode] = useState("");
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const openMatches = useMemo(() => matches.filter((match) => match.team_a && match.team_b), [matches]);

  async function unlock(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("Unlocking...");
    try {
      const response = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_slug: groupSlug,
          manager_code: managerCode,
          pin,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not unlock");
      saveSession(payload);
      setSession(payload);
      setStatus(`Unlocked as ${payload.manager_name}`);
      setPin("");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPick(match, pickType) {
    if (!session?.token) {
      setStatus("Unlock before picking.");
      return;
    }
    setBusy(true);
    setStatus("Saving pick...");
    try {
      const response = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: session.token,
          external_match_id: match.external_match_id,
          pick_type: pickType,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not save pick");
      setStatus(payload.message);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  function switchManager() {
    clearSession();
    setSession(null);
    setStatus("Session cleared.");
  }

  return (
    <section className="section">
      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Manager Picks</h2>
            <p>
              {session
                ? `Unlocked as ${session.manager_name}. Picks can be changed until deadline.`
                : "Unlock with manager code and commissioner-managed PIN."}
            </p>
          </div>
          {session ? (
            <button className="ghost-button" type="button" onClick={switchManager}>
              Switch
            </button>
          ) : null}
        </div>

        {!session ? (
          <form className="auth-form" onSubmit={unlock}>
            <input
              name="manager_code"
              placeholder="Manager code, e.g. M001"
              value={managerCode}
              onChange={(event) => setManagerCode(event.target.value)}
              required
            />
            <input
              name="pin"
              placeholder="PIN"
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              required
            />
            <button type="submit" disabled={busy}>
              Unlock
            </button>
          </form>
        ) : null}

        {status ? <p className="form-status">{status}</p> : null}
      </article>

      <div className="prediction-grid">
        {openMatches.map((match) => (
          <article className="prediction-card" key={match.external_match_id}>
            <span>{formatKickoff(match.kickoff_at)}</span>
            <h3>{match.team_a.name} vs {match.team_b.name}</h3>
            <div className="pick-buttons">
              <button type="button" disabled={busy || !session} onClick={() => submitPick(match, "team_a")}>
                {match.team_a.name}
              </button>
              {match.stage === "Group Stage" ? (
                <button type="button" disabled={busy || !session} onClick={() => submitPick(match, "tie")}>
                  Tie
                </button>
              ) : null}
              <button type="button" disabled={busy || !session} onClick={() => submitPick(match, "team_b")}>
                {match.team_b.name}
              </button>
            </div>
          </article>
        ))}
      </div>
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

function saveSession(payload) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function clearSession() {
  window.localStorage.removeItem(STORAGE_KEY);
}

function formatKickoff(value) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}
