/**
 * Match Checker Service
 * Handles automatic checking for new matches
 */
const config = require('../config');
const EmbedUtils = require('../utils/EmbedBuilder');

class MatchChecker {
  constructor(database, riotApi, client) {
    this.database = database;
    this.riotApi = riotApi;
    this.client = client;
    this.isRunning = false;
  }

  /**
   * Start the automatic match checking
   */
  start() {
    if (this.isRunning) {
      console.log('Match checker is already running');
      return;
    }

    this.isRunning = true;
    this.checkInterval = setInterval(() => {
      this.autoCheckMatches();
    }, config.intervals.baseCheckInterval);

    console.log(`Match checker started (every ${config.intervals.baseCheckInterval / 1000} seconds)`);
  }

  /**
   * Stop the automatic match checking
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('Match checker stopped');
  }

  /**
   * Check for new matches with optimized rate limiting
   * @private
   */
  async autoCheckMatches() {
    const configs = this.database.getAllGuildConfigs();
    
    // Collect all players from all guilds
    const allPlayers = [];
    const guildChannels = new Map();
    
    for (const config of configs) {
      try {
        const channel = await this.client.channels.fetch(config.channel_id);
        const players = this.database.getPlayers(config.guild_id);
        
        guildChannels.set(config.guild_id, channel);
        
        // Add guild_id to each player for tracking
        players.forEach(player => {
          allPlayers.push({ ...player, guild_id: config.guild_id });
        });
      } catch (error) {
        console.error(`Error fetching channel for guild ${config.guild_id}:`, error.message);
      }
    }

    if (allPlayers.length === 0) {
      return;
    }

    console.log(`Checking ${allPlayers.length} players across ${configs.length} guilds...`);
    
    // Use smaller batch size for better rate limiting
    const batchSize = Math.min(config.batching.autoCheckBatchSize, 10); // Max 10 per batch
    let processedCount = 0;
    let newMatchesFound = 0;
    
    for (let i = 0; i < allPlayers.length; i += batchSize) {
      const batch = allPlayers.slice(i, i + batchSize);
      
      // Process batch with priority 1 (lowest priority for background checks)
      const promises = batch.map(async (player) => {
        try {
          const match = await this.riotApi.getLastMatch(player.puuid, 1); // Priority 1 for background checks
          
          if (match) {
            const lastMatchRow = this.database.getLastMatch(player.guild_id, player.puuid);
            const previousMatchId = lastMatchRow?.match_id;
            
            // If this is a new match (different from the last one we saw)
            if (previousMatchId !== match.matchId) {
              this.database.setLastMatch(player.guild_id, player.puuid, match.matchId);
              
              // Only post if we had a previous match (avoid spam on bot restart)
              if (previousMatchId) {
                const channel = guildChannels.get(player.guild_id);
                if (channel) {
                  const embed = EmbedUtils.createMatchEmbed(match);
                  await channel.send({ embeds: [embed] });
                  console.log(`New match posted for ${match.gameName}#${match.tagLine} in guild ${player.guild_id}`);
                  newMatchesFound++;
                }
              }
            }
          }
          processedCount++;
        } catch (error) {
          console.error(`Error checking match for player ${player.game_name}#${player.tag_line}:`, error.message);
          processedCount++;
        }
      });
      
      // Wait for all requests in this batch to complete
      await Promise.allSettled(promises);
      
      // Get detailed rate limiter status
      const status = this.riotApi.getRateLimiterStatus();
      const metrics = this.riotApi.rateLimiter.getMetrics();
      
      console.log(`Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allPlayers.length/batchSize)} complete. ` +
        `Processed: ${processedCount}/${allPlayers.length}, ` +
        `New matches: ${newMatchesFound}, ` +
        `Queue: ${status.totalQueued}, ` +
        `Last second: ${status.requestsLastSecond}, ` +
        `Last 2min: ${status.requestsLastTwoMinutes}, ` +
        `Cache hits: ${metrics.cacheHitRate.toFixed(1)}%`);
      
      // Adaptive delay between batches based on rate limiter status
      let delay = 200; // Base delay
      
      // Increase delay if we're approaching rate limits
      if (status.requestsLastSecond > this.riotApi.rateLimiter.requestsPerSecond * 0.8) {
        delay = 500;
      }
      if (status.requestsLastTwoMinutes > this.riotApi.rateLimiter.requestsPerTwoMinutes * 0.8) {
        delay = 1000;
      }
      
      // Increase delay if we have consecutive errors
      if (status.consecutiveErrors > 0) {
        delay = Math.min(delay * (1 + status.consecutiveErrors), 2000);
      }
      
      // Only delay if there are more batches to process
      if (i + batchSize < allPlayers.length) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    console.log(`Auto-check complete. Processed ${processedCount} players, found ${newMatchesFound} new matches.`);
  }

  /**
   * Get match checker status
   * @returns {Object} - Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkInterval: config.intervals.baseCheckInterval,
      totalPlayers: this.database.getTotalPlayerCount().total_players,
      totalGuilds: this.database.getAllGuildConfigs().length
    };
  }

  /**
   * Update check interval based on player count
   */
  updateInterval() {
    if (!this.isRunning) return;

    const totalPlayers = this.database.getTotalPlayerCount().total_players;
    const newInterval = config.getDynamicInterval(totalPlayers);
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = setInterval(() => {
        this.autoCheckMatches();
      }, newInterval);
      
      console.log(`Match checker interval updated to ${newInterval / 1000} seconds for ${totalPlayers} players`);
    }
  }
}

module.exports = MatchChecker;
