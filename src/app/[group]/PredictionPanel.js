"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "wc_ang_rebuild_session";

export default function PredictionPanel({ groupSlug, managers, matches }) {
  const [session, setSession] = useState(() => loadSession(groupSlug));
  const [managerCode, setManagerCode] = useState(() => managers[0]?.manager_code || "");
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState([]);

  const openMatches = useMemo(() => matches.filter((match) => match.team_a && match.team_b), [matches]);

  useEffect(() => {
    if (session?.token) {
      loadPreview(session.token);
    }
  }, [session?.token]);

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
      loadPreview(payload.token);
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
      loadPreview(session.token);
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

  async function loadPreview(token) {
    try {
      const response = await fetch("/api/predictions/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json();
      if (response.ok && payload.ok) {
        setPreview(payload.picks || []);
      }
    } catch {
      setPreview([]);
    }
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
            <select
              name="manager_code"
              value={managerCode}
              onChange={(event) => setManagerCode(event.target.value)}
              required
            >
              {managers.map((manager) => (
                <option key={manager.manager_code} value={manager.manager_code}>
                  {manager.display_name}
                </option>
              ))}
            </select>
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

      {session ? (
        <article className="panel">
          <h2>Your Pick Preview</h2>
          {preview.length ? (
            <ul className="match-list">
              {preview.map((pick) => (
                <li key={`${pick.external_match_id}-${pick.manager_code}`}>
                  <strong>{pick.team_a_name || "TBD"} vs {pick.team_b_name || "TBD"}</strong>
                  <span>{formatPick(pick)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No saved picks to preview yet.</p>
          )}
        </article>
      ) : null}

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

function formatPick(pick) {
  if (pick.pick_type === "tie") return "Tie";
  if (pick.pick_type === "team_a") return pick.team_a_name || "Team A";
  if (pick.pick_type === "team_b") return pick.team_b_name || "Team B";
  return "Unknown";
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
