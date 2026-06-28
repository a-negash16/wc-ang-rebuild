export function isPredictionLocked({ kickoffAt, lockMinutesBeforeKickoff, now = new Date() }) {
  const kickoff = new Date(kickoffAt).getTime();
  if (!Number.isFinite(kickoff)) return true;
  const lockMs = Number(lockMinutesBeforeKickoff || 60) * 60 * 1000;
  return now.getTime() >= kickoff - lockMs;
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
