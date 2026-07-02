const DEFAULT_SEASON_ID = "285023";
const DEFAULT_BASE_URL = "https://api.fifa.com/api/v3/calendar/matches";
const TIMELINE_BASE_URL = "https://api.fifa.com/api/v3/timelines";
const PLAYER_BASE_URL = "https://api.fifa.com/api/v3/players";
const CACHE_MS = 15 * 60 * 1000;

export const GOAL_EVENT_TYPE = 0;
export const ASSIST_EVENT_TYPE = 1;

let cache = null;
const playerCache = new Map();

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
    id_competition: match.IdCompetition ? String(match.IdCompetition) : null,
    id_season: match.IdSeason ? String(match.IdSeason) : null,
    id_stage: match.IdStage ? String(match.IdStage) : null,
    kickoff_at: match.Date || null,
    status,
    length: normalizeLength(match, status),
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

export async function getFifaMatchTimeline({ idCompetition, idSeason, idStage, externalMatchId }, { fetchImpl = globalThis.fetch } = {}) {
  if (!idCompetition || !idSeason || !idStage || !externalMatchId) {
    throw new Error("getFifaMatchTimeline requires idCompetition, idSeason, idStage, and externalMatchId");
  }

  const url = `${TIMELINE_BASE_URL}/${idCompetition}/${idSeason}/${idStage}/${externalMatchId}`;
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "wc-ang-rebuild/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`FIFA timeline request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  return normalizeFifaTimeline(payload);
}

export function normalizeFifaTimeline(payload) {
  const rawEvents = Array.isArray(payload?.Event) ? payload.Event : [];
  const events = rawEvents
    .filter((event) => event.Type === GOAL_EVENT_TYPE || event.Type === ASSIST_EVENT_TYPE)
    .map((event) => ({
      eventId: event.EventId ? String(event.EventId) : null,
      type: event.Type,
      playerId: event.IdPlayer ? String(event.IdPlayer) : null,
      teamId: event.IdTeam ? String(event.IdTeam) : null,
      isOwnGoal: isOwnGoalDescription(event.EventDescription),
    }))
    .filter((event) => event.playerId);

  return { events };
}

function isOwnGoalDescription(descriptions) {
  const text = Array.isArray(descriptions) ? descriptions[0]?.Description || "" : "";
  return /own goal/i.test(text);
}

export async function getFifaPlayer(playerId, { fetchImpl = globalThis.fetch } = {}) {
  if (!playerId) return null;
  if (playerCache.has(playerId)) return playerCache.get(playerId);

  const response = await fetchImpl(`${PLAYER_BASE_URL}/${playerId}?language=en`, {
    headers: {
      accept: "application/json",
      "user-agent": "wc-ang-rebuild/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`FIFA player request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const player = {
    id: playerId,
    name: payload?.Name?.[0]?.Description || null,
    countryCode: payload?.IdCountry || null,
  };
  playerCache.set(playerId, player);
  return player;
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

function normalizeLength(match, status) {
  if (status !== "finished") return null;

  const resultType = Number(match.ResultType);
  const hasPenaltyScore = match.HomeTeamPenaltyScore !== null
    && match.HomeTeamPenaltyScore !== undefined
    || match.AwayTeamPenaltyScore !== null
    && match.AwayTeamPenaltyScore !== undefined;
  if (resultType === 2 || hasPenaltyScore) return "Pens";

  const hasExtraTimePeriod = Boolean(match.FirstHalfExtraTime || match.SecondHalfExtraTime);
  const matchMinute = normalizeMatchMinute(match.MatchTime);
  if (hasExtraTimePeriod || matchMinute >= 120) return "ET";

  return "90";
}

function normalizeMatchMinute(value) {
  const minute = Number(String(value || "").match(/\d+/)?.[0] || 0);
  return Number.isFinite(minute) ? minute : 0;
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
