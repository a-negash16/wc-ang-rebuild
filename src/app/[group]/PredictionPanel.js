"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "wc_ang_rebuild_session";
const TODAY = "Today";
const TOMORROW = "Tomorrow";
const LATER = "Later";
const URGENT_PICK_WINDOW_MS = 12 * 60 * 60 * 1000;

export default function PredictionPanel({ groupSlug, managers, matches, lockMinutesBeforeKickoff }) {
  const [session, setSession] = useState(null);
  const [managerCode, setManagerCode] = useState(() => managers[0]?.manager_code || "");
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickState, setPickState] = useState([]);
  const [now, setNow] = useState(() => Date.now());

  const openMatches = useMemo(() => matches.filter((match) => match.team_a && match.team_b), [matches]);
  const pickByMatch = useMemo(() => {
    return new Map(pickState.map((pick) => [pick.external_match_id, pick]));
  }, [pickState]);
  const urgentMatches = useMemo(() => {
    return openMatches.filter((match) => {
      const deadline = getDeadline(match.kickoff_at, lockMinutesBeforeKickoff);
      const msUntilDeadline = deadline.getTime() - now;
      return msUntilDeadline > 0 && msUntilDeadline <= URGENT_PICK_WINDOW_MS;
    });
  }, [lockMinutesBeforeKickoff, now, openMatches]);
  const groupedMatches = useMemo(() => groupMatches(urgentMatches), [urgentMatches]);
  const missingCount = pickState.filter((match) => match.is_missing).length;
  const savedCount = pickState.filter((match) => !match.is_missing).length;
  const nextMissingPick = pickState.find((match) => match.is_missing);

  useEffect(() => {
    setSession(loadSession(groupSlug));
  }, [groupSlug]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (session?.token) {
      loadPickState(session.token);
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
      loadPickState(payload.token);
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
      loadPickState(session.token);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  function switchManager() {
    clearSession();
    setSession(null);
    setPickState([]);
    setStatus("Session cleared.");
  }

  async function loadPickState(token) {
    try {
      const response = await fetch("/api/predictions/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json();
      if (response.ok && payload.ok) {
        setPickState(payload.matches || []);
      }
    } catch {
      setPickState([]);
    }
  }

  return (
    <section className="section picks-section">
      <article className="panel manager-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Next action</p>
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
        <article className="panel checklist-mini">
          <div>
            <p className="eyebrow">Your checklist</p>
            <h2>{savedCount} saved</h2>
          </div>
          <div className={missingCount ? "checklist-pill missing" : "checklist-pill"}>
            <strong>{missingCount ? `${missingCount} missing` : "All set"}</strong>
            <span>{nextMissingPick ? formatTeams(nextMissingPick) : "No open picks missing"}</span>
          </div>
        </article>
      ) : null}

      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Open picks</p>
          <h2>Closing Soon</h2>
        </div>
        <span className="status-chip">12-hour window</span>
      </div>

      {urgentMatches.length ? (
        Object.entries(groupedMatches).map(([label, items]) => items.length ? (
          <div className="match-day" key={label}>
            <div className="rail-heading">
              <h3>{label}</h3>
              <span>{items.length} matches</span>
            </div>
            <div className="swipe-rail" aria-label={`${label} prediction cards`}>
              {items.map((match) => {
                const currentPick = pickByMatch.get(match.external_match_id);
                const deadline = getDeadline(match.kickoff_at, lockMinutesBeforeKickoff);
                return (
                  <article className={currentPick?.is_missing ? "prediction-card needs-pick" : "prediction-card"} key={match.external_match_id}>
                    <div className="match-meta">
                      <span>{formatKickoff(match.kickoff_at)}</span>
                      <b>{formatTimeLeft(deadline, now)}</b>
                    </div>
                    <TeamVersus teamA={match.team_a} teamB={match.team_b} />
                    <div className="pick-buttons">
                      <PickButton
                        disabled={busy || !session}
                        isSelected={currentPick?.pick_type === "team_a"}
                        team={match.team_a}
                        onClick={() => submitPick(match, "team_a")}
                      />
                      {match.stage === "Group Stage" ? (
                        <PickButton
                          disabled={busy || !session}
                          isSelected={currentPick?.pick_type === "tie"}
                          label="Tie"
                          onClick={() => submitPick(match, "tie")}
                        />
                      ) : null}
                      <PickButton
                        disabled={busy || !session}
                        isSelected={currentPick?.pick_type === "team_b"}
                        team={match.team_b}
                        onClick={() => submitPick(match, "team_b")}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null)
      ) : (
        <article className="panel quiet-panel">
          <strong>No picks closing in the next 12 hours.</strong>
          <span>Upcoming matches will appear here when they enter the pick window.</span>
        </article>
      )}
    </section>
  );
}

function TeamVersus({ teamA, teamB }) {
  return (
    <div className="team-versus">
      <TeamBadge team={teamA} />
      <span className="versus-pill">vs</span>
      <TeamBadge team={teamB} />
    </div>
  );
}

function TeamBadge({ team }) {
  return (
    <div className="team-badge">
      <span className="flag" aria-hidden="true">{flagForTeam(team)}</span>
      <strong>{team?.name || "TBD"}</strong>
      {team?.fifa_code ? <small>{team.fifa_code}</small> : null}
    </div>
  );
}

function PickButton({ disabled, isSelected, label, team, onClick }) {
  return (
    <button
      className={isSelected ? "selected" : ""}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {team ? (
        <>
          <span className="flag" aria-hidden="true">{flagForTeam(team)}</span>
          <span>{team.name}</span>
        </>
      ) : label}
    </button>
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
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function groupMatches(matches) {
  const buckets = { [TODAY]: [], [TOMORROW]: [], [LATER]: [] };
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const now = new Date();
  const todayKey = formatter.format(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = formatter.format(tomorrow);

  matches.forEach((match) => {
    const key = formatter.format(new Date(match.kickoff_at));
    if (key === todayKey) buckets[TODAY].push(match);
    else if (key === tomorrowKey) buckets[TOMORROW].push(match);
    else buckets[LATER].push(match);
  });
  return buckets;
}

function getDeadline(kickoffAt, lockMinutesBeforeKickoff) {
  const lockMs = Number(lockMinutesBeforeKickoff || 60) * 60 * 1000;
  return new Date(new Date(kickoffAt).getTime() - lockMs);
}

function formatTimeLeft(deadline, now) {
  const remaining = deadline.getTime() - now;
  if (remaining <= 0) return "Locked";
  const minutes = Math.ceil(remaining / 60000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
}

function formatTeams(match) {
  return `${match.team_a?.name || "TBD"} vs ${match.team_b?.name || "TBD"}`;
}

function flagForTeam(team) {
  const code = String(team?.fifa_code || "").toUpperCase();
  const flags = {
    AUS: "🇦🇺",
    BEL: "🇧🇪",
    BRA: "🇧🇷",
    CIV: "🇨🇮",
    CUW: "🇨🇼",
    ECU: "🇪🇨",
    ESP: "🇪🇸",
    GER: "🇩🇪",
    HAI: "🇭🇹",
    IRN: "🇮🇷",
    JPN: "🇯🇵",
    KSA: "🇸🇦",
    NED: "🇳🇱",
    PAR: "🇵🇾",
    SWE: "🇸🇪",
    TUN: "🇹🇳",
    TUR: "🇹🇷",
    USA: "🇺🇸",
  };
  return flags[code] || "🏳";
}
