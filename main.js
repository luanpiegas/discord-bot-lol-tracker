const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const https = require('https');

// Configuration
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const REGION = 'americas'; // Region for account-v1 (americas, asia, europe, sea)
const PLATFORM = 'br1'; // Platform for match data (na1, euw1, kr, etc.)

// In-memory storage (consider using a database for production)
const guildConfigs = new Map();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Riot API helper function
function riotApiRequest(path, region = PLATFORM) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${region}.api.riotgames.com`,
      path: path,
      headers: { 'X-Riot-Token': RIOT_API_KEY }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`API Error: ${res.statusCode} - ${data}`));
        }
      });
    }).on('error', reject);
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

    const matchData = await riotApiRequest(`/lol/match/v5/matches/${matchList[0]}`, REGION);
    const participant = matchData.info.participants.find(p => p.puuid === puuid);

    return {
      championName: participant.championName,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      win: participant.win,
      gameName: participant.riotIdGameName,
      tagLine: participant.riotIdTagline,
      gameEndTimestamp: matchData.info.gameEndTimestamp
    };
  } catch (error) {
    console.error(`Error fetching match for PUUID ${puuid}:`, error.message);
    return null;
  }
}

// Register slash commands
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

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
      }
    }

    if (players.length === 0) {
      return interaction.editReply('Could not find any valid Riot IDs. Please check the names and try again.');
    }

    guildConfigs.set(guildId, {
      channelId: channel.id,
      players
    });

    await interaction.editReply(`✅ Configuration saved!\n\nChannel: ${channel}\nPlayers tracked: ${players.length}\n\nUse /check to manually fetch matches.`);
  }

  if (commandName === 'check') {
    const config = guildConfigs.get(guildId);
    
    if (!config) {
      return interaction.reply({ content: 'Bot not configured. Use /setup first.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = await client.channels.fetch(config.channelId);
    let matchesFound = 0;

    for (const player of config.players) {
      const match = await getLastMatch(player.puuid);
      
      if (match) {
        const embed = new EmbedBuilder()
          .setTitle(`${match.gameName}#${match.tagLine}`)
          .setDescription(`**${match.championName}**`)
          .addFields(
            { name: 'KDA', value: `${match.kills}/${match.deaths}/${match.assists}`, inline: true },
            { name: 'Result', value: match.win ? '✅ Victory' : '❌ Defeat', inline: true }
          )
          .setColor(match.win ? 0x00FF00 : 0xFF0000)
          .setTimestamp(match.gameEndTimestamp);

        await channel.send({ embeds: [embed] });
        matchesFound++;
      }
    }

    await interaction.editReply(`✅ Checked ${config.players.length} players. Found ${matchesFound} matches.`);
  }

  if (commandName === 'config') {
    const config = guildConfigs.get(guildId);
    
    if (!config) {
      return interaction.reply({ content: 'Bot not configured. Use /setup first.', ephemeral: true });
    }

    const channel = await client.channels.fetch(config.channelId).catch(() => null);
    const playerList = config.players.map(p => `${p.gameName}#${p.tagLine}`).join('\n');

    await interaction.reply({
      content: `**Current Configuration**\n\nChannel: ${channel || 'Not found'}\n\n**Tracked Players:**\n${playerList}`,
      ephemeral: true
    });
  }
});

// Login
client.login(DISCORD_TOKEN);