import { config } from '../config/config.js';
import { RateLimiter } from '../utils/rateLimiter.js';

class RiotAPI {
  constructor() {
    this.rateLimiter = new RateLimiter(
      config.RIOT_API.LIMIT_1S,
      config.RIOT_API.LIMIT_2M
    );
    this.ddragonVersion = null;
    this.ddragonLastFetch = 0;
  }

  async request(path, region = config.PLATFORM) {
    await this.rateLimiter.waitForToken();

    const url = `https://${region}.api.riotgames.com${path}`;
    const options = {
      headers: { 'X-Riot-Token': config.RIOT_API_KEY }
    };

    const attempt = async (retryCount = 0) => {
      try {
        const response = await fetch(url, options);
        const status = response.status;

        if (status === 200) {
          return await response.json();
        }

        // Handle rate limiting and transient server errors with retries
        if (status === 429 || (status >= 500 && status < 600)) {
          const retryAfterSec = parseFloat(response.headers.get('retry-after') || 'NaN');
          const backoff = !isNaN(retryAfterSec)
            ? Math.max(1000, Math.floor(retryAfterSec * 1000))
            : Math.min(15000, 1000 * Math.pow(2, retryCount));
          
          if (retryCount < 5) {
            await new Promise(resolve => setTimeout(resolve, backoff));
            return attempt(retryCount + 1);
          }
        }

        const data = await response.text();
        throw new Error(`API Error: ${status} - ${data}`);
      } catch (err) {
        if (err.message.includes('API Error')) throw err;
        if (retryCount < 3) {
          await new Promise(resolve => setTimeout(resolve, 500 * (retryCount + 1)));
          return attempt(retryCount + 1);
        }
        throw err;
      }
    };

    return attempt(0);
  }

  async getDDragonVersion() {
    const now = Date.now();
    if (this.ddragonVersion && (now - this.ddragonLastFetch) < config.DDRAGON_CACHE_MS) {
      return this.ddragonVersion;
    }

    try {
      const response = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const versions = await response.json();
      if (Array.isArray(versions) && versions.length > 0) {
        this.ddragonVersion = versions[0];
        this.ddragonLastFetch = now;
        return this.ddragonVersion;
      }
    } catch (e) {
      console.warn('Failed to fetch DDragon versions, using cached version if available:', e.message);
      if (this.ddragonVersion) return this.ddragonVersion;
    }
    // Fallback: attempt a commonly used recent version if nothing cached
    return '12.18.1';
  }

  async getPuuid(gameName, tagLine) {
    try {
      const data = await this.request(
        `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
        config.REGION
      );
      return data.puuid;
    } catch (error) {
      console.error(`Error fetching PUUID for ${gameName}#${tagLine}:`, error.message);
      return null;
    }
  }

  async getMatchHistory(puuid) {
    try {
      return await this.request(
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=1`,
        config.REGION
      );
    } catch (error) {
      console.error(`Error fetching match history for ${puuid}:`, error.message);
      return [];
    }
  }

  async getMatchDetails(matchId) {
    try {
      return await this.request(`/lol/match/v5/matches/${matchId}`, config.REGION);
    } catch (error) {
      console.error(`Error fetching match details for ${matchId}:`, error.message);
      return null;
    }
  }
}

export const riotAPI = new RiotAPI();