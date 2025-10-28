/**
 * Riot API Service
 * Handles all interactions with the Riot Games API
 */
const https = require('https');
const config = require('../config');
const RateLimiter = require('./RateLimiter');

class RiotApiService {
  constructor() {
    this.rateLimiter = new RateLimiter();
  }

  /**
   * Make a rate-limited request to the Riot API
   * @param {string} path - API endpoint path
   * @param {string} region - API region (default: platform)
   * @returns {Promise} - API response
   */
  async request(path, region = config.riot.platform) {
    return this.rateLimiter.addRequest(() => {
      return new Promise((resolve, reject) => {
        const options = {
          hostname: `${region}.api.riotgames.com`,
          path: path,
          headers: { 'X-Riot-Token': config.riot.apiKey }
        };

        https.get(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else if (res.statusCode === 429) {
              // Rate limit exceeded
              const retryAfter = res.headers['retry-after'] || 1;
              reject(new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds`));
            } else {
              reject(new Error(`API Error: ${res.statusCode} - ${data}`));
            }
          });
        }).on('error', reject);
      });
    });
  }

  /**
   * Get PUUID from Riot ID
   * @param {string} gameName - Player's game name
   * @param {string} tagLine - Player's tag line
   * @returns {Promise<string|null>} - PUUID or null if not found
   */
  async getPuuid(gameName, tagLine) {
    try {
      const data = await this.request(
        `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
        config.riot.region
      );
      return data.puuid;
    } catch (error) {
      console.error(`Error fetching PUUID for ${gameName}#${tagLine}:`, error.message);
      return null;
    }
  }

  /**
   * Get last match for a player
   * @param {string} puuid - Player's PUUID
   * @returns {Promise<Object|null>} - Match data or null if not found
   */
  async getLastMatch(puuid) {
    try {
      const matchList = await this.request(
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?type=ranked&start=0&count=1`,
        config.riot.region
      );
      
      if (matchList.length === 0) return null;

      const matchId = matchList[0];
      const matchData = await this.request(`/lol/match/v5/matches/${matchId}`, config.riot.region);
      const participant = matchData.info.participants.find(p => p.puuid === puuid);

      return {
        matchId,
        championName: participant.championName,
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        win: participant.win,
        gameName: participant.riotIdGameName,
        tagLine: participant.riotIdTagline,
        gameEndTimestamp: matchData.info.gameEndTimestamp,
        gameMode: matchData.info.gameMode,
        gameDuration: matchData.info.gameDuration,
        totalDamageDealtToChampions: participant.totalDamageDealtToChampions
      };
    } catch (error) {
      console.error(`Error fetching match for PUUID ${puuid}:`, error.message);
      return null;
    }
  }

  /**
   * Get multiple matches for a player
   * @param {string} puuid - Player's PUUID
   * @param {number} count - Number of matches to fetch
   * @returns {Promise<Array>} - Array of match data
   */
  async getMatches(puuid, count = 5) {
    try {
      const matchList = await this.request(
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?type=ranked&start=0&count=${count}`,
        config.riot.region
      );

      const matches = [];
      for (const matchId of matchList) {
        try {
          const matchData = await this.request(`/lol/match/v5/matches/${matchId}`, config.riot.region);
          const participant = matchData.info.participants.find(p => p.puuid === puuid);

          matches.push({
            matchId,
            championName: participant.championName,
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
            win: participant.win,
            gameName: participant.riotIdGameName,
            tagLine: participant.riotIdTagline,
            gameEndTimestamp: matchData.info.gameEndTimestamp,
            gameMode: matchData.info.gameMode,
            gameDuration: matchData.info.gameDuration,
            totalDamageDealtToChampions: participant.totalDamageDealtToChampions
          });
        } catch (error) {
          console.error(`Error fetching match ${matchId}:`, error.message);
        }
      }

      return matches;
    } catch (error) {
      console.error(`Error fetching matches for PUUID ${puuid}:`, error.message);
      return [];
    }
  }

  /**
   * Get player's current rank
   * @param {string} puuid - Player's PUUID
   * @returns {Promise<Object|null>} - Rank data or null if not found
   */
  async getPlayerRank(puuid) {
    try {
      // First get summoner ID
      const summonerData = await this.request(`/lol/summoner/v4/summoners/by-puuid/${puuid}`, config.riot.platform);
      const summonerId = summonerData.id;

      // Then get rank data
      const rankData = await this.request(`/lol/league/v4/entries/by-summoner/${summonerId}`, config.riot.platform);
      
      if (rankData.length === 0) return null;

      const soloQueue = rankData.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
      return soloQueue || rankData[0];
    } catch (error) {
      console.error(`Error fetching rank for PUUID ${puuid}:`, error.message);
      return null;
    }
  }

  /**
   * Get rate limiter status
   * @returns {Object} - Rate limiter status
   */
  getRateLimiterStatus() {
    return this.rateLimiter.getQueueStatus();
  }

  /**
   * Clear rate limiter queue
   */
  clearRateLimiterQueue() {
    this.rateLimiter.clearQueue();
  }
}

module.exports = RiotApiService;
