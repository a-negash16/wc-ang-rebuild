const FINAL_WEEKEND_LOCK_MINUTES = 10;
const DEFAULT_LOCK_MINUTES = 60;

export function isPredictionLocked({ kickoffAt, lockMinutesBeforeKickoff, stage, now = new Date() }) {
  const kickoff = new Date(kickoffAt).getTime();
  if (!Number.isFinite(kickoff)) return true;
  const lockMs = getLockMinutesBeforeKickoff({ stage, lockMinutesBeforeKickoff }) * 60 * 1000;
  return now.getTime() >= kickoff - lockMs;
}

export function getLockMinutesBeforeKickoff({ stage, lockMinutesBeforeKickoff } = {}) {
  if (isFinalWeekendStage(stage)) return FINAL_WEEKEND_LOCK_MINUTES;
  return Number(lockMinutesBeforeKickoff || DEFAULT_LOCK_MINUTES);
}

export function isFinalWeekendStage(stage) {
  const normalized = String(stage || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return normalized === "final" || normalized === "third place";
}

export function validatePickForMatch({ pickType, match }) {
  const allowed = match.stage === "Group Stage"
    ? ["team_a", "team_b", "tie"]
    : ["team_a", "team_b"];

  if (!allowed.includes(pickType)) {
    return {
      ok: false,
      message: match.stage === "Group Stage"
        ? "Pick must be Team A, Team B, or Tie"
        : "Knockout picks must choose a winner",
    };
  }

  if (pickType === "team_a" && !match.team_a) {
    return { ok: false, message: "Team A is not set for this match" };
  }
  if (pickType === "team_b" && !match.team_b) {
    return { ok: false, message: "Team B is not set for this match" };
  }

  return { ok: true };
}

export function validateLengthPickForMatch({ lengthPick, match }) {
  if (!lengthPick) return { ok: true };

  if (!["ET", "Pens"].includes(lengthPick)) {
    return { ok: false, message: "Risk pick must be ET or Pens" };
  }

  if (match.stage === "Group Stage") {
    return { ok: false, message: "Risk picks are only available for knockout matches" };
  }

  return { ok: true };
}

export function validateFirstScorePickForMatch({ firstScorePick, match }) {
  if (!firstScorePick) return { ok: true };

  if (!["team_a", "team_b"].includes(firstScorePick)) {
    return { ok: false, message: "First score risk must be Team A or Team B" };
  }

  if (match.stage === "Group Stage") {
    return { ok: false, message: "First score risk is only available for knockout matches" };
  }

  if (firstScorePick === "team_a" && !match.team_a) {
    return { ok: false, message: "Team A is not set for this match" };
  }
  if (firstScorePick === "team_b" && !match.team_b) {
    return { ok: false, message: "Team B is not set for this match" };
  }

  return { ok: true };
}
