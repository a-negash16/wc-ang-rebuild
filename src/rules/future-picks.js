export const LOCKED_FUTURE_STAGE = "Semifinal";
export const LOCKED_FUTURE_DEADLINE_AT = "2026-07-14T19:15:00.000Z";

export const LOCKED_FUTURE_CATEGORIES = Object.freeze([
  {
    key: "best_offense",
    label: "Best Offense",
    group: "country",
    description: "Most goals from the semi-finals onward.",
  },
  {
    key: "best_defense",
    label: "Best Defense",
    group: "country",
    description: "Fewest goals allowed from the semi-finals onward.",
  },
  {
    key: "champion",
    label: "Champion",
    group: "country",
    description: "Tournament winner.",
  },
  {
    key: "third_place",
    label: "3rd Place",
    group: "country",
    description: "Team that finishes third.",
  },
  {
    key: "golden_boot",
    label: "Golden Boot",
    group: "player",
    description: "Tournament top scorer.",
  },
  {
    key: "most_assists",
    label: "Most Assists",
    group: "player",
    description: "Tournament assist leader.",
  },
  {
    key: "player_of_tournament",
    label: "Player of the Tournament",
    group: "player",
    description: "Official tournament best player.",
  },
]);

export const LOCKED_FUTURE_OPTIONS = Object.freeze({
  best_offense: [
    teamOption("FRA", "France", 8, 1),
    teamOption("ESP", "Spain", 9, 2),
    teamOption("ENG", "England", 10, 3),
    teamOption("ARG", "Argentina", 10, 4),
  ],
  best_defense: [
    teamOption("FRA", "France", 8, 1),
    teamOption("ESP", "Spain", 9, 2),
    teamOption("ENG", "England", 10, 3),
    teamOption("ARG", "Argentina", 10, 4),
  ],
  champion: [
    teamOption("FRA", "France", 18, 1),
    teamOption("ESP", "Spain", 24, 3),
    teamOption("ENG", "England", 20, 2),
    teamOption("ARG", "Argentina", 26, 4),
  ],
  third_place: [
    teamOption("FRA", "France", 10, 1),
    teamOption("ESP", "Spain", 14, 3),
    teamOption("ENG", "England", 11, 2),
    teamOption("ARG", "Argentina", 15, 4),
  ],
  golden_boot: [
    playerOption("messi", "Messi", 14, 3),
    playerOption("mbappe", "Mbappe", 12, 2),
    playerOption("kane", "Kane", 10, 1),
    playerOption("bellingham", "Bellingham", 22, 4),
    playerOption("dembele", "Dembele", 24, 5),
  ],
  most_assists: [
    playerOption("olise", "Olise", 12, 2),
    playerOption("gordon", "Gordon", 20, 6),
    playerOption("saka", "Saka", 14, 3),
    playerOption("messi", "Messi", 10, 1),
    playerOption("mbappe", "Mbappe", 18, 5),
    playerOption("dembele", "Dembele", 16, 4),
  ],
  player_of_tournament: [
    playerOption("mbappe", "Mbappe", 14, 1),
    playerOption("messi", "Messi", 16, 2),
    playerOption("kane", "Kane", 20, 3),
    playerOption("bellingham", "Bellingham", 22, 4),
  ],
});

export function getRequiredLockedFutureCategoryKeys() {
  return LOCKED_FUTURE_CATEGORIES.map((category) => category.key);
}

export function requiresLockedFuturePicksForStage(stage) {
  return normalizeStage(stage) === normalizeStage(LOCKED_FUTURE_STAGE);
}

export function isLockedFuturePickDeadlinePassed({ now = new Date(), deadlineAt = LOCKED_FUTURE_DEADLINE_AT } = {}) {
  const deadline = new Date(deadlineAt).getTime();
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(deadline) || !Number.isFinite(current)) return true;
  return current >= deadline;
}

export function buildDefaultLockedFutureCategories() {
  return LOCKED_FUTURE_CATEGORIES.map((category) => ({
    ...category,
    options: sortOptionsByPoints(LOCKED_FUTURE_OPTIONS[category.key] || []),
  }));
}

export function validateLockedFutureSelections(selections, categories = buildDefaultLockedFutureCategories()) {
  const available = new Map(categories.map((category) => [category.key, category]));
  const cleaned = {};
  const missing = [];
  const invalid = [];

  for (const categoryKey of getRequiredLockedFutureCategoryKeys()) {
    const category = available.get(categoryKey);
    const selected = String(selections?.[categoryKey] || "").trim();
    if (!selected) {
      missing.push(categoryKey);
      continue;
    }
    const option = category?.options?.find((item) => item.option_key === selected || item.id === selected);
    if (!option) {
      invalid.push(categoryKey);
      continue;
    }
    cleaned[categoryKey] = option;
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    cleaned,
    missing,
    invalid,
    message: missing.length
      ? "Complete all semi-final locked picks before saving."
      : invalid.length
        ? "One or more locked pick selections are invalid."
        : "Locked picks are valid.",
  };
}

function teamOption(code, label, points, sortOrder) {
  return {
    option_key: code,
    option_kind: "team",
    team_code: code,
    label,
    points,
    sort_order: sortOrder,
  };
}

function playerOption(key, label, points, sortOrder) {
  return {
    option_key: key,
    option_kind: "player",
    team_code: null,
    label,
    points,
    sort_order: sortOrder,
  };
}

function sortOptionsByPoints(options) {
  return [...options].sort((left, right) => {
    const pointDiff = Number(left.points || 0) - Number(right.points || 0);
    if (pointDiff) return pointDiff;
    return String(left.label || "").localeCompare(String(right.label || ""));
  });
}

function normalizeStage(stage) {
  return String(stage || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}
