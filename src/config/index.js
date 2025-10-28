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

  // Rate Limiting Configuration
  rateLimiting: {
    requestsPerSecond: 20,
    requestsPerTwoMinutes: 100,
  },

  // Check Intervals
  intervals: {
    baseCheckInterval: 30 * 1000, // Base check interval: 30 seconds
    maxCheckInterval: 5 * 60 * 1000, // Maximum check interval: 5 minutes
  },

  // Batch Processing
  batching: {
    autoCheckBatchSize: 20, // Process 20 players at a time (1 second worth of requests)
    manualCheckBatchSize: 10, // Smaller batches for manual checks
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
