/**
 * Status Command
 * Shows rate limiter status and bot statistics
 */
const BaseCommand = require('./BaseCommand');
const config = require('../config');

class StatusCommand extends BaseCommand {
  constructor() {
    super('status', 'Show rate limiter status and queue information');
  }

  async execute(interaction, services) {
    const { database, riotApi } = services;
    const EmbedUtils = require('../utils/EmbedBuilder');

    const status = riotApi.getRateLimiterStatus();
    const guildConfigs = database.getAllGuildConfigs();
    const totalPlayers = database.getTotalPlayerCount();

    // Calculate current dynamic interval
    const dynamicInterval = config.getDynamicInterval(totalPlayers.total_players);

    const stats = {
      guildCount: totalPlayers.guild_count,
      totalPlayers: totalPlayers.total_players,
      checkInterval: Math.round(dynamicInterval / 1000),
      baseInterval: Math.round(config.intervals.baseCheckInterval / 1000),
      maxInterval: Math.round(config.intervals.maxCheckInterval / 1000)
    };

    const embed = EmbedUtils.createStatusEmbed(status, stats);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = StatusCommand;
