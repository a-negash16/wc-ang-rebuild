const DEFAULT_SEASON_ID = "285023";
const DEFAULT_BASE_URL = "https://api.fifa.com/api/v3/calendar/matches";
const CACHE_MS = 15 * 60 * 1000;

let cache = null;

export async function getFifaMatchesById({ fetchImpl = globalThis.fetch } = {}) {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_MS) return cache.matchesById;

  const url = buildFifaMatchesUrl();
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "wc-ang-rebuild/1.0",
    },
    next: { revalidate: 15 * 60 },
  });

  if (!response.ok) {
    throw new Error(`FIFA matches request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rawMatches = Array.isArray(payload?.Results) ? payload.Results : [];
  const matchesById = new Map(rawMatches.map((match) => {
    const normalized = normalizeFifaMatch(match);
    return [normalized.external_match_id, normalized];
  }));

  cache = {
    fetchedAt: now,
    matchesById,
  };
  return matchesById;
}

export function normalizeFifaMatch(match) {
  const teamAScore = normalizeScore(match.HomeTeamScore ?? match.Home?.Score);
  const teamBScore = normalizeScore(match.AwayTeamScore ?? match.Away?.Score);
  const status = normalizeStatus(match);
  const winnerFifaId = match.Winner ? String(match.Winner) : null;
  const teamAId = match.Home?.IdTeam ? String(match.Home.IdTeam) : null;
  const teamBId = match.Away?.IdTeam ? String(match.Away.IdTeam) : null;

  return {
    external_match_id: String(match.IdMatch),
    kickoff_at: match.Date || null,
    status,
    team_a_code: match.Home?.Abbreviation || null,
    team_b_code: match.Away?.Abbreviation || null,
    team_a_score: teamAScore,
    team_b_score: teamBScore,
    winner_code: getWinnerCode({
      status,
      winnerFifaId,
      teamAId,
      teamBId,
      teamACode: match.Home?.Abbreviation || null,
      teamBCode: match.Away?.Abbreviation || null,
      teamAScore,
      teamBScore,
    }),
  };
}

function buildFifaMatchesUrl() {
  const url = new URL(process.env.FIFA_MATCHES_URL || DEFAULT_BASE_URL);
  if (!url.searchParams.has("language")) url.searchParams.set("language", "en");
  if (!url.searchParams.has("count")) url.searchParams.set("count", "500");
  if (!url.searchParams.has("idSeason")) {
    url.searchParams.set("idSeason", process.env.FIFA_SEASON_ID || DEFAULT_SEASON_ID);
  }
  return url;
}

function normalizeStatus(match) {
  if (match.MatchStatus === 0 && match.ResultType) return "finished";
  if (match.MatchStatus === 2 || match.MatchStatus === 3) return "live";
  return "scheduled";
}

function normalizeScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function getWinnerCode({
  status,
  winnerFifaId,
  teamAId,
  teamBId,
  teamACode,
  teamBCode,
  teamAScore,
  teamBScore,
}) {
  if (winnerFifaId && winnerFifaId === teamAId) return teamACode;
  if (winnerFifaId && winnerFifaId === teamBId) return teamBCode;
  if (status !== "finished" || teamAScore === null || teamBScore === null) return null;
  if (teamAScore === teamBScore) return null;
  return teamAScore > teamBScore ? teamACode : teamBCode;
}
