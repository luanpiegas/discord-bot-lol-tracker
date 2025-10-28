/**
 * Refresh Command
 * Refreshes slash commands for the current guild
 */
const BaseCommand = require('./BaseCommand');

class RefreshCommand extends BaseCommand {
  constructor() {
    super('refresh', 'Refresh slash commands (admin only)');
  }

  async execute(interaction, services) {
    const { commandManager } = services;

    try {
      await interaction.deferReply({ ephemeral: true });
      
      // Re-register commands for current guild
      const guild = interaction.guild;
      if (guild) {
        await commandManager.registerGuildCommands(guild);
        await this.sendSuccess(
          interaction,
          'Commands Refreshed!',
          `Slash commands refreshed for **${guild.name}**! All commands should now be available.`
        );
      } else {
        await this.sendError(interaction, 'This command can only be used in a server.');
      }
    } catch (error) {
      console.error('Error refreshing commands:', error);
      await this.sendError(interaction, `Error refreshing commands: ${error.message}`);
    }
  }
}

module.exports = RefreshCommand;
