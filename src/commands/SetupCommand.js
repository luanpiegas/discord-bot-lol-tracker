/**
 * Setup Command
 * Handles bot configuration and player setup
 */
const BaseCommand = require('./BaseCommand');

class SetupCommand extends BaseCommand {
  constructor() {
    super('setup', 'Set up the bot configuration', [
      {
        type: 'channel',
        name: 'channel',
        description: 'Channel to post match updates',
        required: true
      },
      {
        type: 'string',
        name: 'riot_ids',
        description: 'Comma-separated Riot IDs (format: Name#TAG,Name2#TAG2)',
        required: true
      }
    ]);
  }

  async execute(interaction, services) {
    const { database, riotApi } = services;
    const EmbedUtils = require('../utils/EmbedBuilder');

    const channel = interaction.options.getChannel('channel');
    const riotIdsString = interaction.options.getString('riot_ids');

    // Parse Riot IDs
    const riotIds = riotIdsString.split(',').map(id => {
      const [gameName, tagLine] = id.trim().split('#');
      return { gameName, tagLine };
    }).filter(id => id.gameName && id.tagLine);

    if (riotIds.length === 0) {
      return this.sendError(interaction, 'Invalid Riot ID format. Use: Name#TAG,Name2#TAG2');
    }

    await interaction.deferReply({ ephemeral: true });

    // Get PUUIDs
    const players = [];
    for (const { gameName, tagLine } of riotIds) {
      const puuid = await riotApi.getPuuid(gameName, tagLine);
      if (puuid) {
        players.push({ gameName, tagLine, puuid });
        
        // Initialize last match tracking
        const match = await riotApi.getLastMatch(puuid);
        if (match) {
          database.setLastMatch(interaction.guildId, puuid, match.matchId);
        }
      }
    }

    if (players.length === 0) {
      return this.sendError(interaction, 'Could not find any valid Riot IDs. Please check the names and try again.');
    }

    // Save to database
    const transaction = database.transaction(() => {
      database.setGuildConfig(interaction.guildId, channel.id);
      database.deleteGuildPlayers(interaction.guildId);
      for (const player of players) {
        database.addPlayer(interaction.guildId, player.gameName, player.tagLine, player.puuid);
      }
    });
    transaction();

    const embed = EmbedUtils.createSuccessEmbed(
      'Configuration Saved!',
      `**Channel:** ${channel}\n**Players tracked:** ${players.length}\n\n🔄 Auto-posting enabled - new matches will be posted automatically!\n\nUse /check to manually fetch matches.`
    );

    await interaction.editReply({ embeds: [embed] });
  }
}

module.exports = SetupCommand;
