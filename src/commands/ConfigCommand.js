/**
 * Config Command
 * Shows current bot configuration and tracked players
 */
const BaseCommand = require('./BaseCommand');
const config = require('../config');

class ConfigCommand extends BaseCommand {
  constructor() {
    super('config', 'Show current bot configuration');
  }

  async execute(interaction, services) {
    const { database } = services;
    const EmbedUtils = require('../utils/EmbedBuilder');

    const guildConfig = database.getGuildConfig(interaction.guildId);
    
    if (!guildConfig) {
      return this.sendError(interaction, 'Bot not configured. Use /setup first.');
    }

    const channel = await interaction.client.channels.fetch(guildConfig.channel_id).catch(() => null);
    const players = database.getPlayers(interaction.guildId);
    
    // Calculate current dynamic interval for this guild
    const totalPlayers = players.length;
    const dynamicInterval = config.getDynamicInterval(totalPlayers);

    const embed = EmbedUtils.createConfigEmbed(
      { channel },
      players,
      dynamicInterval / 1000
    );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = ConfigCommand;
