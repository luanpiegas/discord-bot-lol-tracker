export const config = {
  RIOT_API_KEY: process.env.RIOT_API_KEY,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DB_PATH: process.env.DB_PATH,
  REGION: 'americas', // Region for account-v1 (americas, asia, europe, sea)
  PLATFORM: 'br1', // Platform for match data (na1, euw1, kr, etc.)
  BASE_CHECK_INTERVAL: 30 * 1000, // Base interval of 30 seconds
  RIOT_API: {
    LIMIT_1S: 20, // 20 requests per 1 second
    LIMIT_2M: 100, // 100 requests per 2 minutes
  },
  BATCH_SIZE: 10, // Process players in batches
  DDRAGON_CACHE_MS: 10 * 60 * 1000, // refresh every 10 minutes
};