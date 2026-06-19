const DEFAULT_BASE_URL = "https://api.the-odds-api.com/v4";

export class OddsApiClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
    if (!apiKey) {
      throw new Error("ODDS_API_KEY is required");
    }
    if (!fetchImpl) {
      throw new Error("fetch is required");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  async getSports() {
    return this.#get("/sports");
  }

  async getOdds({
    sport = "soccer_fifa_world_cup",
    regions = "us",
    markets = "h2h",
    oddsFormat = "american",
    dateFormat = "iso",
  } = {}) {
    return this.#get(`/sports/${encodeURIComponent(sport)}/odds`, {
      regions,
      markets,
      oddsFormat,
      dateFormat,
    });
  }

  async #get(path, params = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("apiKey", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetch(url);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || `Odds API request failed with HTTP ${response.status}`);
    }
    return {
      data: payload,
      remainingRequests: response.headers?.get?.("x-requests-remaining") || null,
      usedRequests: response.headers?.get?.("x-requests-used") || null,
    };
  }
}

export function createOddsApiClientFromEnv(env = process.env) {
  return new OddsApiClient({
    apiKey: env.ODDS_API_KEY,
    baseUrl: env.ODDS_API_BASE_URL || DEFAULT_BASE_URL,
  });
}
