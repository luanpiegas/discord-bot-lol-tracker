import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config/config.js';
import { db } from './services/database.js';
import { riotAPI } from './services/riotAPI.js';
import { setupCommand, trackCommand, listCommand, removeCommand } from './commands/commands.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [setupCommand, trackCommand, listCommand, removeCommand];

client.once('clientReady', () => {
  console.log('Bot is ready!');
  processMatches();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const command = commands.find(cmd => cmd.data.name === interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const reply = {
      content: 'There was an error executing this command.',
      ephemeral: true
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

async function processMatches() {
  try {
    const configs = db.getAllGuildConfigs();
    for (const config of configs) {
      const players = await db.getPlayers(config.guild_id);
      
      for (let i = 0; i < players.length; i += config.BATCH_SIZE) {
        const batch = players.slice(i, i + config.BATCH_SIZE);
        await Promise.all(batch.map(player => checkPlayerMatch(config, player)));
      }
    }
  } catch (error) {
    console.error('Error processing matches:', error);
  } finally {
    setTimeout(processMatches, config.BASE_CHECK_INTERVAL);
  }
}

async function checkPlayerMatch(guildConfig, player) {
  try {
    const matches = await riotAPI.getMatchHistory(player.puuid);
    if (!matches || matches.length === 0) return;

    const lastMatch = await db.getLastMatch(guildConfig.guild_id, player.puuid);
    const latestMatchId = matches[0];

    if (lastMatch?.match_id === latestMatchId) return;

    const matchDetails = await riotAPI.getMatchDetails(latestMatchId);
    if (!matchDetails) return;

    await db.setLastMatch(guildConfig.guild_id, player.puuid, latestMatchId);
    await sendMatchNotification(guildConfig.channel_id, player, matchDetails);
  } catch (error) {
    console.error(`Error checking matches for ${player.game_name}#${player.tag_line}:`, error);
  }
}

async function sendMatchNotification(channelId, player, match) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  const playerData = match.info.participants.find(p => p.puuid === player.puuid);
  if (!playerData) return;

  const ddragonVersion = await riotAPI.getDDragonVersion();
  const gameLength = Math.floor(match.info.gameDuration / 60);
  const isWin = playerData.win;

  const embed = {
    color: isWin ? 0x00ff00 : 0xff0000,
    title: `${player.game_name} ${isWin ? 'won' : 'lost'} a match!`,
    thumbnail: {
      url: `http://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${playerData.championName}.png`
    },
    fields: [
      {
        name: 'Champion',
        value: playerData.championName,
        inline: true
      },
      {
        name: 'K/D/A',
        value: `${playerData.kills}/${playerData.deaths}/${playerData.assists}`,
        inline: true
      },
      {
        name: 'Duration',
        value: `${gameLength} minutes`,
        inline: true
      }
    ],
    timestamp: new Date(match.info.gameEndTimestamp)
  };

  await channel.send({ embeds: [embed] });
}

// Initialize database and start the bot
async function start() {
  try {
    await client.login(config.DISCORD_TOKEN);
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await db.close();
  client.destroy();
  process.exit(0);
});

start();