/**
 * Embed Builder Utilities
 * Creates Discord embeds for match data and bot information
 */
const { EmbedBuilder } = require('discord.js');

class EmbedUtils {
  /**
   * Create a match embed
   * @param {Object} match - Match data object
   * @returns {EmbedBuilder} - Discord embed
   */
  static createMatchEmbed(match) {
    return new EmbedBuilder()
      .setTitle(`${match.gameName} (${match.championName})`)
      .setDescription(`${match.gameMode} (${Math.floor(match.gameDuration / 60)}:${(match.gameDuration % 60).toString().padStart(2, '0')})`)
      .setImage(`https://ddragon.leagueoflegends.com/cdn/12.18.1/img/champion/${match.championName}.png`)
      .addFields(
        { name: 'Match ID', value: match.matchId, inline: false },
        { name: 'KDA', value: `${match.kills}/${match.deaths}/${match.assists}`, inline: true },
        { name: 'DMG', value: `${match.totalDamageDealtToChampions}`, inline: true },
        { name: 'Result', value: match.win ? 'Victory' : 'Defeat', inline: true }
      )
      .setColor(match.win ? 0x00FF00 : 0xFF0000)
      .setTimestamp(match.gameEndTimestamp);
  }

  /**
   * Create a player list embed
   * @param {Array} players - Array of player objects
   * @param {string} guildName - Guild name
   * @returns {EmbedBuilder} - Discord embed
   */
  static createPlayerListEmbed(players, guildName) {
    const embed = new EmbedBuilder()
      .setTitle(`Tracked Players - ${guildName}`)
      .setColor(0x0099FF)
      .setTimestamp();

    if (players.length === 0) {
      embed.setDescription('No players are currently being tracked.');
      return embed;
    }

    const playerList = players.map((player, index) => 
      `${index + 1}. **${player.game_name}#${player.tag_line}**`
    ).join('\n');

    embed.setDescription(playerList);
    embed.setFooter({ text: `Total: ${players.length} players` });

    return embed;
  }

  /**
   * Create a rate limiter status embed
   * @param {Object} status - Rate limiter status
   * @param {Object} stats - Bot statistics
   * @returns {EmbedBuilder} - Discord embed
   */
  static createStatusEmbed(status, stats) {
    return new EmbedBuilder()
      .setTitle('🤖 Bot Status')
      .setColor(0x00FF00)
      .addFields(
        {
          name: '📊 Queue Status',
          value: [
            `• Requests in queue: **${status.queueLength}**`,
            `• Requests in last second: **${status.requestsLastSecond}/20**`,
            `• Requests in last 2 minutes: **${status.requestsLastTwoMinutes}/100**`,
            `• Processing: **${status.isProcessing ? 'Yes' : 'No'}**`
          ].join('\n'),
          inline: false
        },
        {
          name: '📈 Bot Statistics',
          value: [
            `• Total guilds: **${stats.guildCount}**`,
            `• Total players: **${stats.totalPlayers}**`,
            `• Check interval: **${stats.checkInterval}s** (dynamic)`,
            `• Base interval: **${stats.baseInterval}s**`,
            `• Max interval: **${stats.maxInterval}s**`
          ].join('\n'),
          inline: false
        },
        {
          name: '⚡ Rate Limits',
          value: [
            `• Max 20 requests/second`,
            `• Max 100 requests/2 minutes`,
            `• Optimized for **${stats.totalPlayers}+** accounts`
          ].join('\n'),
          inline: false
        }
      )
      .setTimestamp();
  }

  /**
   * Create an error embed
   * @param {string} title - Error title
   * @param {string} message - Error message
   * @returns {EmbedBuilder} - Discord embed
   */
  static createErrorEmbed(title, message) {
    return new EmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(message)
      .setColor(0xFF0000)
      .setTimestamp();
  }

  /**
   * Create a success embed
   * @param {string} title - Success title
   * @param {string} message - Success message
   * @returns {EmbedBuilder} - Discord embed
   */
  static createSuccessEmbed(title, message) {
    return new EmbedBuilder()
      .setTitle(`✅ ${title}`)
      .setDescription(message)
      .setColor(0x00FF00)
      .setTimestamp();
  }

  /**
   * Create a configuration embed
   * @param {Object} config - Guild configuration
   * @param {Array} players - Array of players
   * @param {number} checkInterval - Check interval in seconds
   * @returns {EmbedBuilder} - Discord embed
   */
  static createConfigEmbed(config, players, checkInterval) {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Bot Configuration')
      .setColor(0x0099FF)
      .addFields(
        {
          name: '📺 Channel',
          value: config.channel ? config.channel.toString() : 'Not found',
          inline: false
        },
        {
          name: '👥 Tracked Players',
          value: players.length > 0 
            ? players.map(p => `• ${p.game_name}#${p.tag_line}`).join('\n')
            : 'No players tracked',
          inline: false
        },
        {
          name: '🔄 Auto-check',
          value: `Every **${checkInterval}** seconds (dynamic)`,
          inline: false
        }
      )
      .setTimestamp();

    if (players.length > 0) {
      embed.setFooter({ text: `Total: ${players.length} players` });
    }

    return embed;
  }

  /**
   * Create a help embed
   * @returns {EmbedBuilder} - Discord embed
   */
  static createHelpEmbed() {
    return new EmbedBuilder()
      .setTitle('🤖 Bot Commands')
      .setDescription('Here are all available commands:')
      .setColor(0x0099FF)
      .addFields(
        {
          name: '/setup',
          value: 'Set up the bot configuration and add players to track',
          inline: false
        },
        {
          name: '/check',
          value: 'Manually check for new matches from all tracked players',
          inline: false
        },
        {
          name: '/config',
          value: 'Show current bot configuration and tracked players',
          inline: false
        },
        {
          name: '/status',
          value: 'Show rate limiter status and bot statistics',
          inline: false
        },
        {
          name: '/refresh',
          value: 'Refresh slash commands (admin only)',
          inline: false
        }
      )
      .setFooter({ text: 'All commands require Administrator permissions' })
      .setTimestamp();
  }
}

module.exports = EmbedUtils;
