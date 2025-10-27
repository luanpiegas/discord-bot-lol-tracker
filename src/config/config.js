export const config = {
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

export const schema = `
CREATE TABLE IF NOT EXISTS guild_configs (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracked_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    game_name TEXT NOT NULL,
    tag_line TEXT NOT NULL,
    puuid TEXT NOT NULL,
    FOREIGN KEY (guild_id) REFERENCES guild_configs(guild_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS last_matches (
    guild_id TEXT NOT NULL,
    puuid TEXT NOT NULL,
    match_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, puuid)
);
`;