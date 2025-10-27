import { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import sqlite3 from 'node:sqlite3';
import { RateLimiter } from './rateLimiter.js';

// Configuration
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const REGION = 'americas'; // Region for account-v1 (americas, asia, europe, sea)
const PLATFORM = 'br1'; // Platform for match data (na1, euw1, kr, etc.)
const BASE_CHECK_INTERVAL = 30 * 1000; // Base interval of 30 seconds
// Riot API rate limits
const LIMIT_1S = 20; // 20 requests per 1 second
const LIMIT_2M = 100; // 100 requests per 2 minutes
const BATCH_SIZE = 10; // Process players in batches

// Database
let db;
try {
  db = new sqlite3.Database(process.env.DB_PATH);
  console.log(`Connected to database at ${process.env.DB_PATH}`);
} catch (error) {
  console.error('Failed to connect to database:', error.message);
  process.exit(1);
}

// Database operations
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

// Initialize database schema
await dbRun(`
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
`);

// Database operations wrapper
const stmts = {
  setGuildConfig: (guildId, channelId) => 
    dbRun('INSERT OR REPLACE INTO guild_configs (guild_id, channel_id) VALUES (?, ?)', [guildId, channelId]),
  
  getGuildConfig: (guildId) => 
    dbGet('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]),
  
  getAllGuildConfigs: () => 
    dbAll('SELECT * FROM guild_configs'),
  
  deleteGuildPlayers: (guildId) => 
    dbRun('DELETE FROM tracked_players WHERE guild_id = ?', [guildId]),
  
  addPlayer: (guildId, gameName, tagLine, puuid) => 
    dbRun('INSERT INTO tracked_players (guild_id, game_name, tag_line, puuid) VALUES (?, ?, ?, ?)', 
      [guildId, gameName, tagLine, puuid]),
  
  getPlayers: (guildId) => 
    dbAll('SELECT * FROM tracked_players WHERE guild_id = ?', [guildId]),
  
  setLastMatch: (guildId, puuid, matchId) => 
    dbRun('INSERT OR REPLACE INTO last_matches (guild_id, puuid, match_id) VALUES (?, ?, ?)', 
      [guildId, puuid, matchId]),
  
  getLastMatch: (guildId, puuid) => 
    dbGet('SELECT match_id FROM last_matches WHERE guild_id = ? AND puuid = ?', [guildId, puuid])
};
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// DDragon (Data Dragon)
let ddragonVersion = null;
let ddragonLastFetch = 0;
const DDRAGON_CACHE_MS = 10 * 60 * 1000; // refresh every 10 minutes

async function getDDragonVersion() {
  const now = Date.now();
  if (ddragonVersion && (now - ddragonLastFetch) < DDRAGON_CACHE_MS) return ddragonVersion;
  try {
    const response = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const versions = await response.json();
    if (Array.isArray(versions) && versions.length > 0) {
      ddragonVersion = versions[0];
      ddragonLastFetch = now;
      return ddragonVersion;
    }
  } catch (e) {
    console.warn('Failed to fetch DDragon versions, using cached version if available:', e.message);
    if (ddragonVersion) return ddragonVersion;
  }
  // Fallback: attempt a commonly used recent version if nothing cached
  return '12.18.1';
}

// Initialize the rate limiter
console.log('Initializing rate limiter with limits:', { perSecond: LIMIT_1S, perTwoMinutes: LIMIT_2M });
const rateLimiter = new RateLimiter(LIMIT_1S, LIMIT_2M);

// Riot API helper function
async function riotApiRequest(path, region = PLATFORM) {
  await rateLimiter.waitForToken();

  const url = `https://${region}.api.riotgames.com${path}`;
  const options = {
    headers: { 'X-Riot-Token': RIOT_API_KEY }
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

// Get PUUID from Riot ID
async function getPuuid(gameName, tagLine) {
  try {
    const data = await riotApiRequest(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, REGION);
    return data.puuid;
  } catch (error) {
    console.error(`Error fetching PUUID for ${gameName}#${tagLine}:`, error.message);
    return null;
  }
}

// Get recent matches for a player
async function getRecentMatches(puuid, count = 5) {
  try {
    const matchList = await riotApiRequest(`/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`, REGION);
    if (matchList.length === 0) return [];

    const matches = [];
    for (const matchId of matchList) {
      try {
        const matchData = await riotApiRequest(`/lol/match/v5/matches/${matchId}`, REGION);
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
        console.error(`Error fetching match ${matchId} for PUUID ${puuid}:`, error.message);
        // Continue with next match even if one fails
      }
    }
    return matches;
  } catch (error) {
    console.error(`Error fetching matches for PUUID ${puuid}:`, error.message);
    return [];
  }
}

// Get last match for a player (for backward compatibility)
async function getLastMatch(puuid) {
  const matches = await getRecentMatches(puuid, 1);
  return matches[0] || null;
}

// Create match embed using latest DDragon version
async function createMatchEmbed(match) {
  const version = await getDDragonVersion();
  return new EmbedBuilder()
    .setTitle(`${match.gameName} (${match.championName})`)
    .setDescription(`${match.gameMode} (${match.gameDuration / 60 | 0}:${match.gameDuration % 60})`)
    .setImage(`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${match.championName}.png`)
    .addFields(
      { name: 'Match ID', value: match.matchId, inline: false },
      { name: 'KDA', value: `${match.kills}/${match.deaths}/${match.assists}`, inline: true },
      { name: 'DMG', value: `${match.totalDamageDealtToChampions}`, inline: true },
    )
    .setColor(match.win ? 0x00FF00 : 0xFF0000)
    .setTimestamp(match.gameEndTimestamp);
}

// Helper function to process players in batches
async function processBatch(players, channel, guildId) {
  for (const player of players) {
    try {
      const match = await getLastMatch(player.puuid);
      
      if (match) {
        const lastMatchRow = stmts.getLastMatch.get(guildId, player.puuid);
        const previousMatchId = lastMatchRow?.match_id;
        
        // If this is a new match (different from the last one we saw)
        if (previousMatchId !== match.matchId) {
          stmts.setLastMatch.run(guildId, player.puuid, match.matchId);
          
          // Only post if we had a previous match (avoid spam on bot restart)
          if (previousMatchId) {
            const embed = await createMatchEmbed(match);
            await channel.send({ embeds: [embed] });
            console.log(`New match posted for ${match.gameName}#${match.tagLine}`);
          }
        }
      }
    } catch (error) {
      console.error(`Error processing player ${player.game_name}#${player.tag_line}:`, error.message);
    }
  }
}

// Auto-check for new matches
async function autoCheckMatches() {
  const configs = stmts.getAllGuildConfigs.all();
  let totalPlayers = 0;
  
  // First, count total players across all guilds
  for (const config of configs) {
    const players = stmts.getPlayers.all(config.guild_id);
    totalPlayers += players.length;
  }
  
  // Calculate dynamic check interval based on total players
  // This ensures we stay within rate limits
  const dynamicInterval = Math.max(
    BASE_CHECK_INTERVAL,
    Math.ceil(totalPlayers / 50) * BASE_CHECK_INTERVAL // Increase interval for every 50 players
  );
  
  // Update check interval if needed
  if (global.checkInterval && global.checkInterval !== dynamicInterval) {
    clearInterval(global.checkInterval);
    global.checkInterval = setInterval(autoCheckMatches, dynamicInterval);
    console.log(`Adjusted check interval to ${dynamicInterval / 1000} seconds for ${totalPlayers} players`);
  }

  for (const config of configs) {
    try {
      const channel = await client.channels.fetch(config.channel_id);
      const players = stmts.getPlayers.all(config.guild_id);
      
      // Process players in batches
      for (let i = 0; i < players.length; i += BATCH_SIZE) {
        const batch = players.slice(i, i + BATCH_SIZE);
        await processBatch(batch, channel, config.guild_id);
        
        // Add a small delay between batches to help with rate limiting
        if (i + BATCH_SIZE < players.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error(`Error checking matches for guild ${config.guild_id}:`, error.message);
    }
  }
}

// Initialize tracked matches from database
async function initializeTracking() {
  const configs = stmts.getAllGuildConfigs.all();
  let initialized = 0;
  let errors = 0;

  console.log(`Loading configurations for ${configs.length} guilds...`);

  for (const config of configs) {
    try {
      // Verify if channel still exists
      const channel = await client.channels.fetch(config.channel_id);
      if (!channel) {
        console.warn(`Channel ${config.channel_id} not found for guild ${config.guild_id}`);
        continue;
      }

      const players = stmts.getPlayers.all(config.guild_id);
      console.log(`Guild ${config.guild_id}: Loading ${players.length} players...`);

      // Initialize last matches if they don't exist
      for (const player of players) {
        const lastMatchRow = stmts.getLastMatch.get(config.guild_id, player.puuid);
        
        if (!lastMatchRow) {
          try {
            const match = await getLastMatch(player.puuid);
            if (match) {
              stmts.setLastMatch.run(config.guild_id, player.puuid, match.matchId);
              console.log(`Initialized last match for ${player.game_name}#${player.tag_line}`);
            }
          } catch (error) {
            console.error(`Error initializing matches for ${player.game_name}#${player.tag_line}:`, error.message);
            errors++;
          }
        }
      }
      initialized++;
    } catch (error) {
      console.error(`Error initializing guild ${config.guild_id}:`, error.message);
      errors++;
    }
  }

  console.log(`Initialization complete: ${initialized} guilds loaded, ${errors} errors encountered`);
  return { initialized, errors };
}

// Register slash commands
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Initialize existing configurations
  console.log('Loading existing configurations...');
  const initResult = await initializeTracking();
  console.log(`Loaded ${initResult.initialized} guild configurations`);

  const commands = [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Set up the bot configuration')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Channel to post match updates')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('riot_ids')
          .setDescription('Comma-separated Riot IDs (format: Name#TAG,Name2#TAG2)')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('check')
      .setDescription('Manually check for last matches')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('config')
      .setDescription('Show current bot configuration')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ];

  try {
    console.log('Registering slash commands...');
    await client.application.commands.set(commands);
    console.log('Slash commands registered!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }

  // Start auto-checking for matches
  autoCheckMatches(); // Run once immediately to set up the proper interval
  global.checkInterval = setInterval(autoCheckMatches, BASE_CHECK_INTERVAL);
  console.log(`Auto-check started (base interval: ${BASE_CHECK_INTERVAL / 1000} seconds)`);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId } = interaction;

  if (commandName === 'setup') {
    const channel = interaction.options.getChannel('channel');
    const riotIdsString = interaction.options.getString('riot_ids');

    // Parse Riot IDs
    const riotIds = riotIdsString.split(',').map(id => {
      const [gameName, tagLine] = id.trim().split('#');
      return { gameName, tagLine };
    }).filter(id => id.gameName && id.tagLine);

    if (riotIds.length === 0) {
      return interaction.reply({ content: 'Invalid Riot ID format. Use: Name#TAG,Name2#TAG2', ephemeral: true });
    }

    // Get PUUIDs
    await interaction.deferReply({ ephemeral: true });
    const players = [];

    for (const { gameName, tagLine } of riotIds) {
      const puuid = await getPuuid(gameName, tagLine);
      if (puuid) {
        players.push({ gameName, tagLine, puuid });
        
        // Initialize last match tracking
        const match = await getLastMatch(puuid);
        if (match) {
          stmts.setLastMatch.run(guildId, puuid, match.matchId);
        }
      }
    }

    if (players.length === 0) {
      return interaction.editReply('Could not find any valid Riot IDs. Please check the names and try again.');
    }

    // Save to database using transaction
    try {
      await dbRun('BEGIN TRANSACTION');
      await stmts.setGuildConfig(guildId, channel.id);
      await stmts.deleteGuildPlayers(guildId);
      for (const player of players) {
        await stmts.addPlayer(guildId, player.gameName, player.tagLine, player.puuid);
      }
      await dbRun('COMMIT');
    } catch (error) {
      await dbRun('ROLLBACK');
      throw error;
    }

    await interaction.editReply(`✅ Configuration saved!\n\nChannel: ${channel}\nPlayers tracked: ${players.length}\n\n🔄 Auto-posting enabled - new matches will be posted automatically!\n\nUse /check to manually fetch matches.`);
  }

  if (commandName === 'check') {
    const config = stmts.getGuildConfig.get(guildId);
    
    if (!config) {
      return interaction.reply({ content: 'Bot not configured. Use /setup first.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = await client.channels.fetch(config.channel_id);
    const players = stmts.getPlayers.all(guildId);
    let matchesFound = 0;

    for (const player of players) {
      const match = await getLastMatch(player.puuid);
      
      if (match) {
        const embed = createMatchEmbed(match);
        await channel.send({ embeds: [embed] });
        matchesFound++;
      }
    }

    await interaction.editReply(`✅ Checked ${players.length} players. Found ${matchesFound} matches.`);
  }

  if (commandName === 'config') {
    const config = stmts.getGuildConfig.get(guildId);
    
    if (!config) {
      return interaction.reply({ content: 'Bot not configured. Use /setup first.', ephemeral: true });
    }

    const channel = await client.channels.fetch(config.channel_id).catch(() => null);
    const players = stmts.getPlayers.all(guildId);
    const playerList = players.map(p => `${p.game_name}#${p.tag_line}`).join('\n');

    await interaction.reply({
      content: `**Current Configuration**\n\nChannel: ${channel || 'Not found'}\n\n**Tracked Players:**\n${playerList}\n\n🔄 Auto-check: Every ${CHECK_INTERVAL / 1000} seconds`,
      ephemeral: true
    });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
      process.exit(1);
    }
    process.exit(0);
  });
});

// Login
client.login(DISCORD_TOKEN);