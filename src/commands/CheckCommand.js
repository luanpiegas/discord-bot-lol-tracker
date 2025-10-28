/**
 * Check Command
 * Manually checks for new matches from all tracked players
 */
const BaseCommand = require('./BaseCommand');
const config = require('../config');

class CheckCommand extends BaseCommand {
  constructor() {
    super('check', 'Manually check for last matches');
  }

  async execute(interaction, services) {
    const { database, riotApi } = services;
    const EmbedUtils = require('../utils/EmbedBuilder');

    const guildConfig = database.getGuildConfig(interaction.guildId);
    
    if (!guildConfig) {
      return this.sendError(interaction, 'Bot not configured. Use /setup first.');
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = await interaction.client.channels.fetch(guildConfig.channel_id);
    const players = database.getPlayers(interaction.guildId);
    let matchesFound = 0;

    // Process players in smaller batches for manual check
    const batchSize = config.batching.manualCheckBatchSize;
    
    for (let i = 0; i < players.length; i += batchSize) {
      const batch = players.slice(i, i + batchSize);
      
      const promises = batch.map(async (player) => {
        try {
          const match = await riotApi.getLastMatch(player.puuid);
          
          if (match) {
            const embed = EmbedUtils.createMatchEmbed(match);
            await channel.send({ embeds: [embed] });
            return 1;
          }
          return 0;
        } catch (error) {
          console.error(`Error checking match for player ${player.game_name}#${player.tag_line}:`, error.message);
          return 0;
        }
      });
      
      const results = await Promise.allSettled(promises);
      matchesFound += results.filter(r => r.status === 'fulfilled' && r.value === 1).length;
      
      // Update progress
      await interaction.editReply(`🔄 Checking players... ${Math.min(i + batchSize, players.length)}/${players.length} (${matchesFound} matches found so far)`);
      
      // Small delay between batches
      if (i + batchSize < players.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const embed = EmbedUtils.createSuccessEmbed(
      'Check Complete!',
      `Checked **${players.length}** players. Found **${matchesFound}** matches.`
    );

    await interaction.editReply({ embeds: [embed] });
  }
}

module.exports = CheckCommand;
