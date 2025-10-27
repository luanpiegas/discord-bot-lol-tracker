const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const https = require('https');
const Database = require('better-sqlite3');
const RateLimiter = require('./rateLimiter');

// Configuration
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const REGION = 'americas'; // Region for account-v1 (americas, asia, europe, sea)
const PLATFORM = 'br1'; // Platform for match data (na1, euw1, kr, etc.)
const BASE_CHECK_INTERVAL = 30 * 1000; // Base interval of 30 seconds
// Riot API rate limits to enforce locally
const LIMIT_1S = 20; // 20 requests per 1 second
const LIMIT_2M = 100; // 100 requests per 2 minutes
const WINDOW_1S_MS = 1000;
const WINDOW_2M_MS = 2 * 60 * 1000;
const BATCH_SIZE = 10; // Process players in batches

// Initialize database
let db;
try {
  db = new Database(process.env.DB_PATH);
  console.log(`Connected to database at ${process.env.DB_PATH}`);
} catch (error) {
  console.error('Failed to connect to database:', error.message);
  process.exit(1);
}

// Create tables
db.exec(`
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

// Prepared statements
const stmts = {
  setGuildConfig: db.prepare('INSERT OR REPLACE INTO guild_configs (guild_id, channel_id) VALUES (?, ?)'),
  getGuildConfig: db.prepare('SELECT * FROM guild_configs WHERE guild_id = ?'),
  getAllGuildConfigs: db.prepare('SELECT * FROM guild_configs'),
  deleteGuildPlayers: db.prepare('DELETE FROM tracked_players WHERE guild_id = ?'),
  addPlayer: db.prepare('INSERT INTO tracked_players (guild_id, game_name, tag_line, puuid) VALUES (?, ?, ?, ?)'),
  getPlayers: db.prepare('SELECT * FROM tracked_players WHERE guild_id = ?'),
  setLastMatch: db.prepare('INSERT OR REPLACE INTO last_matches (guild_id, puuid, match_id) VALUES (?, ?, ?)'),
  getLastMatch: db.prepare('SELECT match_id FROM last_matches WHERE guild_id = ? AND puuid = ?')
};
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Export functions for testing
module.exports = {
  riotApiRequest,
  getPuuid,
  getLastMatch,
};

// ---- DDragon (Data Dragon) latest version helper ----
let ddragonVersion = null;
let ddragonLastFetch = 0;
const DDRAGON_CACHE_MS = 10 * 60 * 1000; // refresh every 10 minutes

function fetchJsonViaHttps(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'GET',
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function getDDragonVersion() {
  const now = Date.now();
  if (ddragonVersion && (now - ddragonLastFetch) < DDRAGON_CACHE_MS) return ddragonVersion;
  try {
    const versions = await fetchJsonViaHttps('https://ddragon.leagueoflegends.com/api/versions.json');
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
const rateLimiter = new RateLimiter(LIMIT_1S, LIMIT_2M);

// Riot API helper function
function riotApiRequest(path, region = PLATFORM) {
  return new Promise(async (resolve, reject) => {
    const options = {
      hostname: `${region}.api.riotgames.com`,
      path: path,
      headers: { 'X-Riot-Token': RIOT_API_KEY }
    };

    // Wait for rate limit token
    await rateLimiter.waitForToken();

    const attempt = (retryCount = 0) => {
      https.get(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`API Parse Error: ${e.message}`));
            }
            return;
          }

          // Handle rate limiting and transient server errors with retries
          if (status === 429 || (status >= 500 && status < 600)) {
            const retryAfterHeader = res.headers && (res.headers['retry-after'] || res.headers['Retry-After']);
            const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : NaN;
            const backoff = !isNaN(retryAfterSec)
              ? Math.max(1000, Math.floor(retryAfterSec * 1000))
              : Math.min(15000, 1000 * Math.pow(2, retryCount));
            if (retryCount < 5) {
              setTimeout(() => attempt(retryCount + 1), backoff);
              return;
            }
          }

          reject(new Error(`API Error: ${status} - ${data}`));
        });
      }).on('error', (err) => {
        if (retryCount < 3) {
          setTimeout(() => attempt(retryCount + 1), 500 * (retryCount + 1));
        } else {
          reject(err);
        }
      });
    };

    attempt(0);
  });
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

// Get last match for a player
async function getLastMatch(puuid) {
  try {
    const matchList = await riotApiRequest(`/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=1`, REGION);
    if (matchList.length === 0) return null;

    const matchId = matchList[0];
    const matchData = await riotApiRequest(`/lol/match/v5/matches/${matchId}`, REGION);
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

    // Save to database
    const transaction = db.transaction(() => {
      stmts.setGuildConfig.run(guildId, channel.id);
      stmts.deleteGuildPlayers.run(guildId);
      for (const player of players) {
        stmts.addPlayer.run(guildId, player.gameName, player.tagLine, player.puuid);
      }
    });
    transaction();

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
  db.close();
  process.exit(0);
});

// Login
client.login(DISCORD_TOKEN);