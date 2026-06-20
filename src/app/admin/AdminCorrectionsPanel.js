"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "wc_ang_rebuild_session";

export default function AdminCorrectionsPanel() {
  const [session, setSession] = useState(null);
  const [context, setContext] = useState(null);
  const [managerCode, setManagerCode] = useState("");
  const [externalMatchId, setExternalMatchId] = useState("");
  const [pickType, setPickType] = useState("team_a");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSession(loadSession());
  }, []);

  useEffect(() => {
    if (!session?.token) return;
    loadContext(session.token);
  }, [session?.token]);

  const selectedMatch = useMemo(() => {
    return (context?.matches || []).find((match) => match.external_match_id === externalMatchId) || null;
  }, [context?.matches, externalMatchId]);

  const allowedPicks = useMemo(() => {
    if (!selectedMatch) return [];
    const picks = [
      { value: "team_a", label: selectedMatch.team_a?.name || "Team A" },
      { value: "team_b", label: selectedMatch.team_b?.name || "Team B" },
    ];
    if (selectedMatch.stage === "Group Stage") {
      picks.splice(1, 0, { value: "tie", label: "Tie" });
    }
    return picks;
  }, [selectedMatch]);

  useEffect(() => {
    if (allowedPicks.length && !allowedPicks.some((pick) => pick.value === pickType)) {
      setPickType(allowedPicks[0].value);
    }
  }, [allowedPicks, pickType]);

  async function loadContext(token) {
    setBusy(true);
    setStatus("Loading commissioner tools...");
    try {
      const response = await fetch("/api/admin/corrections/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not load admin context");
      setContext(payload);
      setManagerCode(payload.managers?.[0]?.manager_code || "");
      setExternalMatchId(payload.matches?.[0]?.external_match_id || "");
      setStatus(`Commissioner mode: ${payload.group.name}`);
    } catch (error) {
      setContext(null);
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrection(event) {
    event.preventDefault();
    if (!session?.token) return;
    setBusy(true);
    setStatus("Saving correction...");
    try {
      const response = await fetch("/api/admin/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: session.token,
          manager_code: managerCode,
          external_match_id: externalMatchId,
          pick_type: pickType,
          reason,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not save correction");
      setReason("");
      setStatus(payload.changed
        ? `Corrected ${payload.manager.display_name}: ${payload.pick_label}`
        : `No change needed for ${payload.manager.display_name}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <article className="panel admin-tool-panel">
        <h2>Prediction Corrections</h2>
        <p>Open a group page and unlock as Abrham first. Then return here to make commissioner corrections.</p>
      </article>
    );
  }

  return (
    <article className="panel admin-tool-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Commissioner</p>
          <h2>Prediction Corrections</h2>
          <p>{session.manager_name} can correct picks for {session.group_slug} only.</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => loadContext(session.token)} disabled={busy}>
          Refresh
        </button>
      </div>

      <form className="admin-correction-form" onSubmit={submitCorrection}>
        <label>
          <span>Manager</span>
          <select value={managerCode} onChange={(event) => setManagerCode(event.target.value)} required>
            {(context?.managers || []).map((manager) => (
              <option key={manager.manager_code} value={manager.manager_code}>
                {manager.display_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Match</span>
          <select value={externalMatchId} onChange={(event) => setExternalMatchId(event.target.value)} required>
            {(context?.matches || []).map((match) => (
              <option key={match.external_match_id} value={match.external_match_id}>
                {formatMatchOption(match)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Correct pick</span>
          <select value={pickType} onChange={(event) => setPickType(event.target.value)} required>
            {allowedPicks.map((pick) => (
              <option key={pick.value} value={pick.value}>
                {pick.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-reason">
          <span>Reason</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Example: wrong input confirmed by commissioner"
            minLength={6}
            required
          />
        </label>
        <button type="submit" disabled={busy || !context}>
          Save correction
        </button>
      </form>

      {status ? <p className="form-status">{status}</p> : null}
    </article>
  );
}

function loadSession() {
  try {
    const payload = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (!payload?.token) return null;
    if (payload.expires_at && new Date(payload.expires_at).getTime() <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function formatMatchOption(match) {
  const teams = `${match.team_a?.name || "TBD"} vs ${match.team_b?.name || "TBD"}`;
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(match.kickoff_at));
  const group = match.group_label ? `Group ${match.group_label}` : match.stage;
  return `${date} - ${group} - ${teams}`;
}
