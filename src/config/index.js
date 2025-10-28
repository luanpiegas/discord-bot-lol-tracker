/**
 * Configuration Management
 * Centralized configuration for the Discord bot
 */

const config = {
  // API Configuration
  riot: {
    apiKey: process.env.RIOT_API_KEY,
    region: 'americas', // Region for account-v1 (americas, asia, europe, sea)
    platform: 'br1', // Platform for match data (na1, euw1, kr, etc.)
  },

  // Discord Configuration
  discord: {
    token: process.env.DISCORD_TOKEN,
    intents: ['Guilds'], // Discord.js intents
  },

  // Database Configuration
  database: {
    path: process.env.DB_PATH || './bot-data.db',
  },

  // Rate Limiting Configuration (Conservative settings)
  rateLimiting: {
    requestsPerSecond: 18, // 18 instead of 20 for safety margin
    requestsPerTwoMinutes: 95, // 95 instead of 100 for safety margin
  },

  // Check Intervals (More conservative)
  intervals: {
    baseCheckInterval: 60 * 1000, // Base check interval: 60 seconds (was 30)
    maxCheckInterval: 10 * 60 * 1000, // Maximum check interval: 10 minutes (was 5)
  },

  // Batch Processing (Smaller batches)
  batching: {
    autoCheckBatchSize: 8, // Process 8 players at a time (was 20)
    manualCheckBatchSize: 5, // Smaller batches for manual checks (was 10)
  },

  // Validation
  validate() {
    const required = ['riot.apiKey', 'discord.token'];
    const missing = required.filter(key => {
      const value = key.split('.').reduce((obj, k) => obj?.[k], config);
      return !value;
    });

    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }

    return true;
  },

  // Get dynamic check interval based on player count
  getDynamicInterval(playerCount) {
    const { baseCheckInterval, maxCheckInterval } = config.intervals;
    return Math.min(
      maxCheckInterval,
      Math.max(baseCheckInterval, (playerCount / 100) * 120000)
    );
  }
};

module.exports = config;
