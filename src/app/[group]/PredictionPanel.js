"use client";

import { useEffect, useMemo, useState } from "react";

import { getLockMinutesBeforeKickoff } from "@/rules/predictions";

const STORAGE_KEY = "wc_ang_rebuild_session";
const TODAY = "Today";
const TOMORROW = "Tomorrow";
const LATER = "Later";

export default function PredictionPanel({
  groupSlug,
  managers,
  matches,
  lockMinutesBeforeKickoff,
  timezone = "America/New_York",
  draftTeamManagersByCode = {},
  draftPlayersByCode = {},
}) {
  const [session, setSession] = useState(null);
  const [managerCode, setManagerCode] = useState(() => managers[0]?.manager_code || "");
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickState, setPickState] = useState([]);
  const [lockedPickState, setLockedPickState] = useState(null);
  const [parlaySlipState, setParlaySlipState] = useState(null);
  const [pendingLockedSelections, setPendingLockedSelections] = useState({});
  const [pendingParlaySelections, setPendingParlaySelections] = useState({});
  const [pendingRiskByMatch, setPendingRiskByMatch] = useState({});
  const [pendingFirstScoreRiskByMatch, setPendingFirstScoreRiskByMatch] = useState({});
  const [now, setNow] = useState(() => Date.now());

  const openMatches = useMemo(() => matches.filter((match) => match.team_a && match.team_b), [matches]);
  const pickByMatch = useMemo(() => {
    return new Map(pickState.map((pick) => [pick.external_match_id, pick]));
  }, [pickState]);
  const openPickMatches = useMemo(() => {
    const unlockedMatches = openMatches.filter((match) => {
      const deadline = getDeadline(match.kickoff_at, lockMinutesBeforeKickoff, match.stage);
      return deadline.getTime() > now;
    });
    return getCurrentPredictionRoundMatches(unlockedMatches);
  }, [lockMinutesBeforeKickoff, now, openMatches]);
  const groupedMatches = useMemo(() => groupMatches(openPickMatches, timezone), [openPickMatches, timezone]);
  const activeRoundLabel = useMemo(() => getPredictionRoundLabel(openPickMatches), [openPickMatches]);
  const openPickState = useMemo(() => {
    const openIds = new Set(openPickMatches.map((match) => match.external_match_id));
    return pickState.filter((match) => openIds.has(match.external_match_id));
  }, [pickState, openPickMatches]);
  const savedPicks = useMemo(() => {
    return pickState
      .filter((match) => !match.is_missing)
      .sort((left, right) => new Date(left.kickoff_at).getTime() - new Date(right.kickoff_at).getTime());
  }, [pickState]);
  const missingCount = openPickState.filter((match) => match.is_missing).length;
  const savedCount = openPickState.filter((match) => !match.is_missing).length;
  const nextMissingPick = openPickState.find((match) => match.is_missing);
  const activeRoundRequiresLockedPicks = openPickMatches.some((match) => requiresLockedPicksForStage(match.stage));
  const lockedPicksComplete = !activeRoundRequiresLockedPicks || Boolean(lockedPickState?.is_complete);
  const lockedGateActive = Boolean(session && activeRoundRequiresLockedPicks && !lockedPicksComplete);
  const visibleGroupedMatches = lockedGateActive ? {} : groupedMatches;

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

  async function submitPick(match, pickType, lengthPick = null, firstScorePick = null) {
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
          length_pick: lengthPick,
          first_score_pick: firstScorePick,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not save pick");
      const savedAt = payload.saved_at || new Date().toISOString();
      const savedLengthPick = payload.length_pick_saved === false ? null : lengthPick;
      const savedFirstScorePick = payload.first_score_pick_saved === false ? null : firstScorePick;
      updateOptimisticPick({
        match,
        pickType,
        lengthPick: savedLengthPick,
        firstScorePick: savedFirstScorePick,
        savedAt,
      });
      clearPendingRisk(match.external_match_id);
      clearPendingFirstScoreRisk(match.external_match_id);
      setStatus(formatSaveStatus({
        match,
        pickType,
        lengthPick,
        savedLengthPick,
        firstScorePick,
        savedFirstScorePick,
        savedAt,
        timezone,
      }));
      const refreshed = await loadPickState(session.token, { clearOnError: false });
      if (!refreshed) {
        setStatus(`Saved: ${getPickLabel(match, pickType)}. Refresh to confirm latest card state.`);
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRiskPick(match, currentPick, lengthPick) {
    const latestPick = getLatestPickForMatch(match.external_match_id, currentPick);
    const currentLengthPick = getSelectedRiskPick(match.external_match_id, latestPick);
    const nextLengthPick = currentLengthPick === lengthPick ? null : lengthPick;
    if (!latestPick?.pick_type) {
      setPendingRisk(match.external_match_id, nextLengthPick);
      setStatus(nextLengthPick
        ? `${nextLengthPick} risk selected. Pick a winner to save it.`
        : "Risk Bonus cleared.");
      return;
    }
    await submitPick(
      match,
      latestPick.pick_type,
      nextLengthPick,
      getSelectedFirstScoreRiskPick(match.external_match_id, latestPick)
    );
  }

  async function submitFirstScoreRiskPick(match, currentPick, firstScorePick) {
    const latestPick = getLatestPickForMatch(match.external_match_id, currentPick);
    const currentFirstScorePick = getSelectedFirstScoreRiskPick(match.external_match_id, latestPick);
    const nextFirstScorePick = currentFirstScorePick === firstScorePick ? null : firstScorePick;
    if (!latestPick?.pick_type) {
      setPendingFirstScoreRisk(match.external_match_id, nextFirstScorePick);
      setStatus(nextFirstScorePick
        ? `${getPickLabel(match, nextFirstScorePick)} first-score risk selected. Pick a winner to save it.`
        : "First-score risk cleared.");
      return;
    }
    await submitPick(
      match,
      latestPick.pick_type,
      getSelectedRiskPick(match.external_match_id, latestPick),
      nextFirstScorePick
    );
  }

  function getLatestPickForMatch(externalMatchId, fallbackPick) {
    return pickState.find((pick) => pick.external_match_id === externalMatchId)
      || pickState.find((pick) => String(pick.external_match_id) === String(externalMatchId))
      || fallbackPick
      || null;
  }

  function getSelectedRiskPick(externalMatchId, currentPick) {
    return Object.hasOwn(pendingRiskByMatch, externalMatchId)
      ? pendingRiskByMatch[externalMatchId]
      : currentPick?.length_pick || null;
  }

  function setPendingRisk(externalMatchId, lengthPick) {
    setPendingRiskByMatch((current) => ({
      ...current,
      [externalMatchId]: lengthPick,
    }));
  }

  function clearPendingRisk(externalMatchId) {
    setPendingRiskByMatch((current) => {
      if (!Object.hasOwn(current, externalMatchId)) return current;
      const next = { ...current };
      delete next[externalMatchId];
      return next;
    });
  }

  function getSelectedFirstScoreRiskPick(externalMatchId, currentPick) {
    return Object.hasOwn(pendingFirstScoreRiskByMatch, externalMatchId)
      ? pendingFirstScoreRiskByMatch[externalMatchId]
      : currentPick?.first_score_pick || null;
  }

  function setPendingFirstScoreRisk(externalMatchId, firstScorePick) {
    setPendingFirstScoreRiskByMatch((current) => ({
      ...current,
      [externalMatchId]: firstScorePick,
    }));
  }

  function clearPendingFirstScoreRisk(externalMatchId) {
    setPendingFirstScoreRiskByMatch((current) => {
      if (!Object.hasOwn(current, externalMatchId)) return current;
      const next = { ...current };
      delete next[externalMatchId];
      return next;
    });
  }

  function updateOptimisticPick({ match, pickType, lengthPick, firstScorePick, savedAt }) {
    setPickState((current) => {
      const nextPick = {
        ...match,
        pick_type: pickType,
        length_pick: lengthPick,
        first_score_pick: firstScorePick,
        pick_label: getPickLabel(match, pickType),
        risk_label: formatRiskPickLabel(lengthPick),
        first_score_risk_label: formatFirstScoreRiskPickLabel(match, firstScorePick),
        picked_at: savedAt,
        is_missing: false,
      };
      const index = current.findIndex((pick) => pick.external_match_id === match.external_match_id);
      if (index === -1) return [...current, nextPick];
      return current.map((pick, pickIndex) => pickIndex === index ? { ...pick, ...nextPick } : pick);
    });
  }

  function switchManager() {
    clearSession();
    setSession(null);
    setPickState([]);
    setLockedPickState(null);
    setParlaySlipState(null);
    setPendingLockedSelections({});
    setPendingParlaySelections({});
    setStatus("Session cleared.");
  }

  async function loadPickState(token, { clearOnError = true } = {}) {
    try {
      const response = await fetch("/api/predictions/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json();
      if (response.ok && payload.ok) {
        setPickState(payload.matches || []);
        setLockedPickState(payload.locked_picks || null);
        setParlaySlipState(payload.parlay_slips || null);
        setPendingLockedSelections(buildLockedSelections(payload.locked_picks));
        setPendingParlaySelections(buildParlaySelections(payload.parlay_slips));
        return true;
      }
    } catch {
      if (clearOnError) {
        setPickState([]);
        setLockedPickState(null);
        setParlaySlipState(null);
        setPendingLockedSelections({});
        setPendingParlaySelections({});
      }
    }
    if (clearOnError) {
      setPickState([]);
      setLockedPickState(null);
      setParlaySlipState(null);
      setPendingLockedSelections({});
      setPendingParlaySelections({});
    }
    return false;
  }


  function updateLockedSelection(categoryKey, optionKey) {
    setPendingLockedSelections((current) => ({
      ...current,
      [categoryKey]: optionKey,
    }));
  }

  async function submitLockedPicks() {
    if (!session?.token) {
      setStatus("Unlock before saving locked picks.");
      return;
    }
    if (lockedPickState?.is_locked) {
      setStatus("Semi-Final Locked Picks deadline passed.");
      return;
    }
    setBusy(true);
    setStatus("Saving locked picks...");
    try {
      const response = await fetch("/api/predictions/locked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: session.token,
          selections: pendingLockedSelections,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not save locked picks");
      setLockedPickState(payload.locked_picks || null);
      setPendingLockedSelections(buildLockedSelections(payload.locked_picks));
      setStatus(formatLockedPickConfirmation(payload.locked_picks));
      await loadPickState(session.token, { clearOnError: false });
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  function updateParlaySelection(externalMatchId, marketKey, optionKey) {
    setPendingParlaySelections((current) => ({
      ...current,
      [externalMatchId]: {
        ...(current[externalMatchId] || {}),
        [marketKey]: optionKey,
      },
    }));
  }

  async function submitParlaySlip(match) {
    if (!session?.token) {
      setStatus("Unlock before saving parlay slips.");
      return;
    }
    if (match?.is_locked) {
      setStatus("Parlay slip deadline passed.");
      return;
    }
    setBusy(true);
    setStatus("Saving parlay slip...");
    try {
      const response = await fetch("/api/predictions/parlay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: session.token,
          external_match_id: match.external_match_id,
          selections: pendingParlaySelections[match.external_match_id] || {},
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not save parlay slip");
      setParlaySlipState(payload.parlay_slips || null);
      setPendingParlaySelections(buildParlaySelections(payload.parlay_slips));
      setStatus(formatParlayConfirmation(match, payload.parlay_slips));
      await loadPickState(session.token, { clearOnError: false });
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section section-band picks-section" id="next-picks">
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
            <span>{nextMissingPick ? formatTeams(nextMissingPick) : "No urgent picks missing"}</span>
          </div>
        </article>
      ) : null}

      {session && activeRoundRequiresLockedPicks ? (
        <LockedPicksCard
          lockedPicks={lockedPickState}
          selections={pendingLockedSelections}
          busy={busy}
          onSelect={updateLockedSelection}
          now={now}
          timezone={timezone}
          onSubmit={submitLockedPicks}
        />
      ) : null}

      {session ? (
        <SavedPicksPreview picks={savedPicks} timezone={timezone} />
      ) : null}

      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Open picks</p>
          <h2>{activeRoundLabel || "Open Round"}</h2>
        </div>
        <span className="status-chip">Round open</span>
      </div>

      {lockedGateActive ? (
        <article className="panel empty-state locked-futures-empty">
          <strong>Complete Semi-Final Locked Picks first.</strong>
          <span>The semi-final match cards unlock after all country and player futures are saved.</span>
        </article>
      ) : openPickMatches.length ? (
        Object.entries(visibleGroupedMatches).map(([label, items]) => items.length ? (
          <div className="match-day" key={label}>
            <div className="rail-heading">
              <h3>{label}</h3>
              <span>{items.length} matches</span>
            </div>
            <div className="ticket-rail-wrap">
              <div className="swipe-rail" aria-label={`${label} prediction cards`}>
              {items.map((match) => {
                const currentPick = pickByMatch.get(match.external_match_id);
                const deadline = getDeadline(match.kickoff_at, lockMinutesBeforeKickoff, match.stage);
                const teamACode = getTeamCode(match.team_a);
                const teamBCode = getTeamCode(match.team_b);
                const selectedRiskPick = getSelectedRiskPick(match.external_match_id, currentPick);
                const selectedFirstScoreRiskPick = getSelectedFirstScoreRiskPick(match.external_match_id, currentPick);
                return (
                  <article className={currentPick?.is_missing ? "prediction-card needs-pick" : "prediction-card"} key={match.external_match_id}>
                    <div className="ticket-meta">
                      <b className={groupClass(match.group_label)}>Group {match.group_label || "-"}</b>
                    </div>
                    <div className="ticket-body ticket-body-matchup">
                      <TeamVersus
                        teamA={match.team_a}
                        teamB={match.team_b}
                        teamADrafters={draftTeamManagersByCode[teamACode] || []}
                        teamBDrafters={draftTeamManagersByCode[teamBCode] || []}
                      />
                      <WatchOutFor
                        teamA={match.team_a}
                        teamB={match.team_b}
                        teamAPlayers={draftPlayersByCode[teamACode] || []}
                        teamBPlayers={draftPlayersByCode[teamBCode] || []}
                      />
                      <div className="ticket-time-row">
                        <div className="kickoff-block">
                          <strong>Kickoff</strong>
                          <span>{formatTicketKickoff(match.kickoff_at, timezone)}</span>
                        </div>
                        <div className="deadline-countdown" aria-label="Time left before prediction lock">
                          <strong>Locks</strong>
                          <b>{formatTimeLeft(deadline, now)}</b>
                        </div>
                      </div>
                    </div>
                    <div className="ticket-divider" />
                    <div className="match-meta">
                      <span className={currentPick?.pick_label ? "pick-receipt saved" : "pick-receipt"}>
                        <strong>{currentPick?.pick_label ? `Saved: ${currentPick.pick_label}` : "No pick saved"}</strong>
                        {currentPick?.picked_at ? <small>Confirmed {formatSavedAt(currentPick.picked_at, timezone)}</small> : null}
                      </span>
                    </div>
                    <div className={match.stage === "Group Stage" ? "pick-buttons" : "pick-buttons pick-buttons-knockout"}>
                      <PickButton
                        disabled={busy || !session}
                        isSelected={currentPick?.pick_type === "team_a"}
                        points={match.team_a_points}
                        team={match.team_a}
                        onClick={() => submitPick(match, "team_a", selectedRiskPick, selectedFirstScoreRiskPick)}
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
                        points={match.team_b_points}
                        team={match.team_b}
                        onClick={() => submitPick(match, "team_b", selectedRiskPick, selectedFirstScoreRiskPick)}
                      />
                    </div>
                    {match.stage === "Group Stage" ? null : (
                      <>
                        <RiskBonusButtons
                          disabled={busy || !session}
                          selected={selectedRiskPick}
                          onSelect={(lengthPick) => submitRiskPick(match, currentPick, lengthPick)}
                        />
                        <FirstScoreRiskButtons
                          disabled={busy || !session}
                          selected={selectedFirstScoreRiskPick}
                          teamA={match.team_a}
                          teamB={match.team_b}
                          onSelect={(firstScorePick) => submitFirstScoreRiskPick(match, currentPick, firstScorePick)}
                        />
                      </>
                    )}
                  </article>
                );
              })}
              </div>
            </div>
          </div>
        ) : null)
      ) : (
        <article className="panel empty-state">
          <strong>No open picks right now.</strong>
          <span>Upcoming round matches will appear here once teams are set and deadlines are open.</span>
        </article>
      )}

      {session ? (
        <ParlaySlipCards
          parlaySlips={parlaySlipState}
          selections={pendingParlaySelections}
          busy={busy}
          now={now}
          timezone={timezone}
          onSelect={updateParlaySelection}
          onSubmit={submitParlaySlip}
        />
      ) : null}
    </section>
  );
}

function ParlaySlipCards({ parlaySlips, selections, busy, now, timezone, onSelect, onSubmit }) {
  const matches = (parlaySlips?.matches || []).filter((match) => !match.is_locked && match.markets?.length);
  if (!matches.length) return null;

  return (
    <div className="parlay-slip-wrap">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Final bonus</p>
          <h2>{parlaySlips?.label || "Final / 3rd Place Slip"}</h2>
        </div>
        <span className="status-chip">Parlay</span>
      </div>
      <div className="swipe-rail parlay-slip-rail" aria-label="Final and third-place parlay slips">
        {matches.map((match) => {
          const matchSelections = selections?.[match.external_match_id] || {};
          const complete = isParlaySelectionComplete(match, matchSelections);
          return (
            <article className={match.is_complete ? "panel parlay-slip-card complete" : "panel parlay-slip-card"} key={match.external_match_id}>
              <div className="rail-heading parlay-slip-heading">
                <div>
                  <p className="eyebrow">{match.stage}</p>
                  <h3>{formatTeams(match)}</h3>
                  <span>All correct doubles new bonus points. Miss one leg and correct legs pay 1.5x. Miss every leg: -20 pts.</span>
                  <small className="locked-picks-deadline">
                    Locks {formatShortDeadline(match.deadline_at, timezone)} · {formatTimeLeft(new Date(match.deadline_at), now)}
                  </small>
                </div>
                <strong>{countParlaySelections(match, matchSelections)}/{match.required_count}</strong>
              </div>
              <div className="parlay-market-list">
                {match.markets.map((market) => (
                  <div className="parlay-market" key={market.market_key}>
                    <strong>{market.label}</strong>
                    <span>{getParlayMarketHelp(market)}</span>
                    {market.market_type === "exact_score" ? (
                      <ExactScorePicker
                        match={match}
                        market={market}
                        value={matchSelections[market.market_key] || market.exact_score || {}}
                        disabled={busy || match.is_locked}
                        onChange={(value) => onSelect(match.external_match_id, market.market_key, value)}
                      />
                    ) : (
                      <div className="parlay-option-grid">
                        {(market.options || []).map((option) => {
                          const selected = matchSelections[market.market_key] === option.option_key || market.selected?.option_key === option.option_key;
                          return (
                            <button
                              className={selected ? "selected" : ""}
                              type="button"
                              disabled={busy || match.is_locked}
                              key={`${market.market_key}-${option.option_key}`}
                              onClick={() => onSelect(match.external_match_id, market.market_key, option.option_key)}
                            >
                              <b>{option.label}</b>
                              <small>{formatPickPoints(option.points)}</small>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {match.is_complete ? <ParlaySlipConfirmation match={match} /> : null}
              <button
                className="locked-picks-submit"
                type="button"
                disabled={busy || match.is_locked || !complete}
                onClick={() => onSubmit(match)}
              >
                {match.is_complete ? "Update Slip" : "Save Slip"}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ParlaySlipConfirmation({ match }) {
  const selected = (match.markets || [])
    .filter((market) => market.selected || hasCompleteExactScore(market.exact_score))
    .map((market) => {
      if (market.market_type === "exact_score") {
        return {
          key: market.market_key,
          label: market.label,
          value: `${market.exact_score.team_a_score}-${market.exact_score.team_b_score} ${formatPickPoints(market.points)}`,
        };
      }
      return {
        key: market.market_key,
        label: market.label,
        value: `${market.selected.label} ${formatPickPoints(market.selected.points)}`,
      };
    });
  if (!selected.length) return null;
  return (
    <div className="parlay-slip-confirmation" aria-label={`${match.stage} parlay slip confirmation`}>
      <strong>{match.stage} Slip Confirmation</strong>
      <div>
        {selected.map((item) => (
          <span key={item.key}>
            <b>{item.label}</b>
            <em>{item.value}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

function ExactScorePicker({ match, market, value, disabled, onChange }) {
  const teamAValue = value?.team_a_score ?? "";
  const teamBValue = value?.team_b_score ?? "";
  return (
    <div className="exact-score-picker">
      <label>
        <span>{match.team_a?.name || "Team A"}</span>
        <input
          inputMode="numeric"
          min="0"
          type="number"
          value={teamAValue}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, team_a_score: event.target.value })}
        />
      </label>
      <b>-</b>
      <label>
        <span>{match.team_b?.name || "Team B"}</span>
        <input
          inputMode="numeric"
          min="0"
          type="number"
          value={teamBValue}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, team_b_score: event.target.value })}
        />
      </label>
      <small>{formatPickPoints(market.points)}</small>
    </div>
  );
}

function getParlayMarketHelp(market) {
  if (market.market_key === "var_reviews") {
    return "Count only when the main referee goes to the screen, across the whole game.";
  }
  if (market.market_key === "exact_score") {
    return "Predict the final official score across the whole game.";
  }
  if (market.market_key === "total_goals") {
    return "Total goals across the whole game.";
  }
  if (market.market_key === "yellow_cards") {
    return "Total yellow cards across the whole game.";
  }
  if (String(market.market_key || "").includes("_score")) {
    return "Pick whether the player scores at least once.";
  }
  return "Pick one option.";
}

function LockedPicksCard({ lockedPicks, selections, busy, now, timezone, onSelect, onSubmit }) {
  const categories = lockedPicks?.categories || [];
  if (!categories.length) return null;
  const countryCategories = categories.filter((category) => category.group === "country");
  const playerCategories = categories.filter((category) => category.group === "player");
  const complete = Boolean(lockedPicks?.is_complete);
  const locked = Boolean(lockedPicks?.is_locked);
  const deadline = lockedPicks?.deadline_at ? new Date(lockedPicks.deadline_at) : null;

  return (
    <article className={complete ? "panel locked-picks-card complete" : "panel locked-picks-card"}>
      <div className="rail-heading locked-picks-heading">
        <div>
          <p className="eyebrow">Semi-final gate</p>
          <h3>{lockedPicks?.label || "Semi-Final Locked Picks"}</h3>
          <span>{complete ? "Saved. Semi-final match picks are open." : "Complete these first to unlock semi-final match picks."}</span>
          {deadline ? (
            <small className={locked ? "locked-picks-deadline locked" : "locked-picks-deadline"}>
              {locked ? "Locked" : `Locks ${formatShortDeadline(deadline, timezone)} · ${formatTimeLeft(deadline, now)}`}
            </small>
          ) : null}
        </div>
        <strong>{lockedPicks?.selected_count || 0}/{lockedPicks?.required_count || categories.length}</strong>
      </div>
      <div className="locked-picks-groups">
        <LockedPickGroup title="Country Picks" categories={countryCategories} selections={selections} locked={locked} onSelect={onSelect} />
        <LockedPickGroup title="Player Picks" categories={playerCategories} selections={selections} locked={locked} onSelect={onSelect} />
      </div>
      {complete ? <LockedPickConfirmation categories={categories} /> : null}
      <button className="locked-picks-submit" type="button" disabled={busy || locked || !isLockedSelectionComplete(categories, selections)} onClick={onSubmit}>
        {locked ? "Locked" : complete ? "Update Locked Picks" : "Save Locked Picks"}
      </button>
    </article>
  );
}

function LockedPickGroup({ title, categories, selections, locked, onSelect }) {
  if (!categories.length) return null;
  return (
    <div className="locked-picks-group">
      <h4>{title}</h4>
      {categories.map((category) => (
        <div className="locked-pick-category" key={category.key}>
          <div className="locked-pick-category-copy">
            <strong>{category.label}</strong>
            <span>{category.description}</span>
          </div>
          <div className={category.group === "country" ? "locked-option-grid country-options" : "locked-option-grid player-options"}>
            {(category.options || []).map((option) => {
              const selected = selections?.[category.key] === option.option_key || selections?.[category.key] === option.id;
              return (
                <button
                  className={selected ? "selected" : ""}
                  type="button"
                  key={`${category.key}-${option.option_key || option.id}`}
                  disabled={locked}
                  onClick={() => onSelect(category.key, option.option_key || option.id)}
                >
                  {option.option_kind === "team" ? <span className="flag" aria-hidden="true">{flagForCode(option.team_code)}</span> : null}
                  <b>{option.label}</b>
                  <small>{formatPickPoints(option.points)}</small>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function LockedPickConfirmation({ categories }) {
  const selected = (categories || []).filter((category) => category.selected);
  if (!selected.length) return null;
  return (
    <div className="locked-pick-confirmation" aria-label="Locked picks confirmation">
      <strong>Locked Picks Confirmation</strong>
      <div>
        {selected.map((category) => (
          <span key={category.key}>
            <b>{category.label}</b>
            <em>{category.selected.label} {formatPickPoints(category.selected.points)}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

function WatchOutFor({ teamA, teamB, teamAPlayers = [], teamBPlayers = [] }) {
  if (!teamAPlayers.length && !teamBPlayers.length) return null;
  return (
    <div className="watchout-panel">
      <strong>Watch out for</strong>
      <div className="watchout-columns">
        {teamAPlayers.length ? <WatchOutSide team={teamA} players={teamAPlayers} /> : null}
        {teamBPlayers.length ? <WatchOutSide team={teamB} players={teamBPlayers} align="right" /> : null}
      </div>
    </div>
  );
}

function WatchOutSide({ team, players, align = "left" }) {
  return (
    <div className={`watchout-side watchout-side-${align}`}>
      <span className="watchout-team">
        <span className="flag" aria-hidden="true">{flagForTeam(team)}</span>
        {team?.name || "TBD"}
      </span>
      <span className="watchout-tags">
        {players.map((player) => (
          <em key={`${player.player_name}-${player.manager_name}`}>
            <b>{player.player_name}</b>
            <small>{player.manager_name}</small>
          </em>
        ))}
      </span>
    </div>
  );
}

function SavedPicksPreview({ picks, timezone }) {
  return (
    <article className="panel saved-picks-panel">
      <div className="rail-heading">
        <div>
          <p className="eyebrow">Saved picks</p>
          <h3>Current selections</h3>
        </div>
        <span>{picks.length ? `${picks.length} saved` : "None yet"}</span>
      </div>
      {picks.length ? (
        <div className="saved-picks-rail" aria-label="Saved prediction preview">
          {picks.map((pick) => (
            <div className="saved-pick-chip" key={pick.external_match_id}>
              <strong>{pick.pick_label}</strong>
              <span>{formatTeams(pick)}</span>
              {pick.risk_label ? <em>{pick.risk_label}</em> : null}
              {pick.first_score_risk_label ? <em>{pick.first_score_risk_label}</em> : null}
              <small>{formatTicketKickoff(pick.kickoff_at, timezone)}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="saved-picks-empty">Saved picks will appear here after you submit them.</p>
      )}
    </article>
  );
}

function RiskBonusButtons({ disabled, selected, onSelect }) {
  return (
    <div className="risk-bonus-panel" aria-label="Knockout risk bonus">
      <div>
        <strong>Risk Bonus</strong>
        <span>Optional gamble after picking a winner</span>
      </div>
      <div className="risk-buttons">
        <button
          className={selected === "ET" ? "selected" : ""}
          type="button"
          disabled={disabled}
          onClick={() => onSelect("ET")}
        >
          <strong>ET</strong>
          <span>Risk 2 to win 4</span>
        </button>
        <button
          className={selected === "Pens" ? "selected" : ""}
          type="button"
          disabled={disabled}
          onClick={() => onSelect("Pens")}
        >
          <strong>Pens</strong>
          <span>Risk 4 to win 8</span>
        </button>
      </div>
    </div>
  );
}

function FirstScoreRiskButtons({ disabled, selected, teamA, teamB, onSelect }) {
  return (
    <div className="risk-bonus-panel first-score-risk-panel" aria-label="Team to score first risk bonus">
      <div>
        <strong>Score First</strong>
        <span>Optional risk: right +3, wrong -1</span>
      </div>
      <div className="risk-buttons first-score-risk-buttons">
        <button
          className={selected === "team_a" ? "selected" : ""}
          type="button"
          disabled={disabled}
          onClick={() => onSelect("team_a")}
        >
          <strong>{teamA?.name || "Team A"}</strong>
          <span>+3 / -1</span>
        </button>
        <button
          className={selected === "team_b" ? "selected" : ""}
          type="button"
          disabled={disabled}
          onClick={() => onSelect("team_b")}
        >
          <strong>{teamB?.name || "Team B"}</strong>
          <span>+3 / -1</span>
        </button>
      </div>
    </div>
  );
}

function TeamVersus({ teamA, teamB, teamADrafters = [], teamBDrafters = [] }) {
  return (
    <div className="team-versus">
      <TeamBadge team={teamA} drafters={teamADrafters} />
      <span className="versus-mark" aria-hidden="true">V</span>
      <TeamBadge team={teamB} drafters={teamBDrafters} align="right" />
    </div>
  );
}

function TeamBadge({ team, drafters = [], align = "left" }) {
  return (
    <div className={`team-badge team-badge-${align}`}>
      <div className="team-badge-main">
        <span className="flag" aria-hidden="true">{flagForTeam(team)}</span>
        <strong>{team?.name || "TBD"}</strong>
      </div>
      <DraftManagerTags managers={drafters} />
    </div>
  );
}

function DraftManagerTags({ managers }) {
  const names = [...new Set((managers || []).filter(Boolean))];
  if (!names.length) return <span className="draft-tags empty">No drafted team</span>;
  return (
    <span className="draft-tags">
      {names.map((name) => (
        <em key={name}>{name}</em>
      ))}
    </span>
  );
}

function PickButton({ disabled, isSelected, label, points, team, onClick }) {
  const pointsLabel = formatPickPoints(points);
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
          <span className="pick-button-label">
            <span>{team.name}</span>
            {pointsLabel ? <small>{pointsLabel}</small> : null}
          </span>
        </>
      ) : label}
    </button>
  );
}

function formatPickPoints(points) {
  if (points === null || points === undefined || points === "") return null;
  const value = Number(points);
  if (!Number.isFinite(value)) return null;
  return `+${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)} pts`;
}

function formatLockedPickConfirmation(lockedPicks) {
  const selected = (lockedPicks?.categories || [])
    .filter((category) => category.selected)
    .map((category) => `${category.label}: ${category.selected.label} ${formatPickPoints(category.selected.points)}`);
  return selected.length
    ? `Semi-Final Locked Picks saved. ${selected.join(" | ")}`
    : "Semi-Final Locked Picks saved. Match predictions are unlocked.";
}

function formatParlayConfirmation(match, parlaySlips) {
  const savedMatch = (parlaySlips?.matches || []).find((item) => item.external_match_id === match.external_match_id);
  const selected = (savedMatch?.markets || [])
    .filter((market) => market.selected || hasCompleteExactScore(market.exact_score))
    .map((market) => {
      if (market.market_type === "exact_score") {
        return `${market.label}: ${market.exact_score.team_a_score}-${market.exact_score.team_b_score} ${formatPickPoints(market.points)}`;
      }
      return `${market.label}: ${market.selected.label} ${formatPickPoints(market.selected.points)}`;
    });
  return selected.length
    ? `${savedMatch?.stage || match.stage} slip saved. ${selected.join(" | ")}`
    : `${match.stage} slip saved.`;
}

function buildLockedSelections(lockedPicks) {
  return (lockedPicks?.categories || []).reduce((selections, category) => {
    if (category.selected?.option_key) selections[category.key] = category.selected.option_key;
    return selections;
  }, {});
}

function buildParlaySelections(parlaySlips) {
  return (parlaySlips?.matches || []).reduce((matchSelections, match) => {
    const selections = {};
    for (const market of match.markets || []) {
      if (market.selected?.option_key) selections[market.market_key] = market.selected.option_key;
      if (market.market_type === "exact_score" && hasCompleteExactScore(market.exact_score)) {
        selections[market.market_key] = market.exact_score;
      }
    }
    if (Object.keys(selections).length) matchSelections[match.external_match_id] = selections;
    return matchSelections;
  }, {});
}

function isLockedSelectionComplete(categories, selections) {
  if (!categories?.length) return false;
  return categories.every((category) => Boolean(selections?.[category.key]));
}

function isParlaySelectionComplete(match, selections) {
  const markets = match?.markets || [];
  if (!markets.length) return false;
  return markets.every((market) => {
    if (market.market_type === "exact_score") return hasCompleteExactScore(selections?.[market.market_key]);
    return Boolean(selections?.[market.market_key]);
  });
}

function countParlaySelections(match, selections) {
  return (match?.markets || []).filter((market) => {
    if (market.market_type === "exact_score") return hasCompleteExactScore(selections?.[market.market_key]);
    return Boolean(selections?.[market.market_key]);
  }).length;
}

function hasCompleteExactScore(value) {
  if (!value || typeof value !== "object") return false;
  return value.team_a_score !== null
    && value.team_a_score !== undefined
    && value.team_a_score !== ""
    && value.team_b_score !== null
    && value.team_b_score !== undefined
    && value.team_b_score !== "";
}

function requiresLockedPicksForStage(stage) {
  return String(stage || "").trim().toLowerCase() === "semifinal";
}

function flagForCode(code) {
  return flagForTeam({ fifa_code: code });
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

function formatShortDeadline(value, timezone) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatTicketKickoff(value, timezone) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function groupMatches(matches, timezone) {
  const buckets = { [TODAY]: [], [TOMORROW]: [], [LATER]: [] };
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
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

function getCurrentPredictionRoundMatches(matches) {
  const sorted = [...matches].sort((left, right) => {
    return new Date(left.kickoff_at).getTime() - new Date(right.kickoff_at).getTime();
  });
  const firstMatch = sorted[0];
  if (!firstMatch) return [];
  const stageGroup = getPredictionStageGroup(firstMatch.stage);
  return sorted.filter((match) => getPredictionStageGroup(match.stage) === stageGroup);
}

function getPredictionRoundLabel(matches) {
  const stage = getPredictionStageGroup(matches[0]?.stage);
  if (!stage) return null;
  if (stage === "Group Stage") return "Open Picks";
  if (stage === "Final Weekend") return "Final Weekend Picks";
  return `${stage} Picks`;
}

function getPredictionStageGroup(stage) {
  const label = String(stage || "").trim();
  if (label === "Final" || label === "Third Place") return "Final Weekend";
  return label;
}

function getDeadline(kickoffAt, lockMinutesBeforeKickoff, stage) {
  const lockMs = getLockMinutesBeforeKickoff({ stage, lockMinutesBeforeKickoff }) * 60 * 1000;
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

function formatSavedAt(value, timezone) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatTeams(match) {
  return `${match.team_a?.name || "TBD"} vs ${match.team_b?.name || "TBD"}`;
}

function getTeamCode(team) {
  return String(team?.fifa_code || "").toUpperCase();
}

function getPickLabel(match, pickType) {
  if (pickType === "tie") return "Tie";
  if (pickType === "team_a") return match.team_a?.name || "Team A";
  if (pickType === "team_b") return match.team_b?.name || "Team B";
  return "Pick";
}

function formatSaveStatus({
  match,
  pickType,
  lengthPick,
  savedLengthPick,
  firstScorePick,
  savedFirstScorePick,
  savedAt,
  timezone,
}) {
  const pickLabel = getPickLabel(match, pickType);
  const timeLabel = formatSavedAt(savedAt, timezone);
  if (lengthPick && !savedLengthPick) {
    return `Saved: ${pickLabel}. Risk Bonus needs the latest database migration.`;
  }
  if (firstScorePick && !savedFirstScorePick) {
    return `Saved: ${pickLabel}. First-score risk needs the latest database migration.`;
  }
  const riskLabel = formatRiskPickLabel(savedLengthPick);
  const firstScoreRiskLabel = formatFirstScoreRiskPickLabel(match, savedFirstScorePick);
  const extras = [riskLabel, firstScoreRiskLabel].filter(Boolean);
  return extras.length
    ? `Saved: ${pickLabel} with ${extras.join(" and ")} at ${timeLabel}`
    : `Saved: ${pickLabel} at ${timeLabel}`;
}

function formatRiskPickLabel(lengthPick) {
  if (lengthPick === "ET") return "ET risk: +4 / -2";
  if (lengthPick === "Pens") return "Pens risk: +8 / -4";
  return null;
}

function formatFirstScoreRiskPickLabel(match, firstScorePick) {
  if (firstScorePick === "team_a") return `${match.team_a?.name || "Team A"} first score: +3 / -1`;
  if (firstScorePick === "team_b") return `${match.team_b?.name || "Team B"} first score: +3 / -1`;
  return null;
}

function groupClass(group) {
  return group ? `group-chip group-${String(group).toLowerCase()}` : "group-chip";
}

function flagForTeam(team) {
  const code = String(team?.fifa_code || "").toUpperCase();
  const flags = {
    ALG: "🇩🇿",
    ARG: "🇦🇷",
    AUS: "🇦🇺",
    AUT: "🇦🇹",
    BEL: "🇧🇪",
    BIH: "🇧🇦",
    BRA: "🇧🇷",
    CAN: "🇨🇦",
    CIV: "🇨🇮",
    COL: "🇨🇴",
    COD: "🇨🇩",
    CPV: "🇨🇻",
    CRO: "🇭🇷",
    CUW: "🇨🇼",
    CZE: "🇨🇿",
    ECU: "🇪🇨",
    EGY: "🇪🇬",
    ENG: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    ESP: "🇪🇸",
    FRA: "🇫🇷",
    GER: "🇩🇪",
    GHA: "🇬🇭",
    HAI: "🇭🇹",
    IRN: "🇮🇷",
    IRQ: "🇮🇶",
    JOR: "🇯🇴",
    JPN: "🇯🇵",
    KOR: "🇰🇷",
    KSA: "🇸🇦",
    MAR: "🇲🇦",
    MEX: "🇲🇽",
    NED: "🇳🇱",
    NOR: "🇳🇴",
    NZL: "🇳🇿",
    PAN: "🇵🇦",
    PAR: "🇵🇾",
    POR: "🇵🇹",
    QAT: "🇶🇦",
    RSA: "🇿🇦",
    SCO: "🏴",
    SEN: "🇸🇳",
    SUI: "🇨🇭",
    SWE: "🇸🇪",
    TUN: "🇹🇳",
    TUR: "🇹🇷",
    URU: "🇺🇾",
    USA: "🇺🇸",
    UZB: "🇺🇿",
  };
  return flags[code] || "🏳";
}
