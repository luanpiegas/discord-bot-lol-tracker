/**
 * Command Manager
 * Manages all slash commands and their registration
 */
const SetupCommand = require('./SetupCommand');
const CheckCommand = require('./CheckCommand');
const ConfigCommand = require('./ConfigCommand');
const StatusCommand = require('./StatusCommand');
const RefreshCommand = require('./RefreshCommand');

class CommandManager {
  constructor() {
    this.commands = new Map();
    this.registerCommands();
  }

  /**
   * Register all available commands
   * @private
   */
  registerCommands() {
    const commandInstances = [
      new SetupCommand(),
      new CheckCommand(),
      new ConfigCommand(),
      new StatusCommand(),
      new RefreshCommand()
    ];

    commandInstances.forEach(command => {
      this.commands.set(command.name, command);
    });
  }

  /**
   * Get all command builders for registration
   * @returns {Array} - Array of SlashCommandBuilder instances
   */
  getCommandBuilders() {
    return Array.from(this.commands.values()).map(command => command.getBuilder());
  }

  /**
   * Get a command by name
   * @param {string} name - Command name
   * @returns {BaseCommand|null} - Command instance or null
   */
  getCommand(name) {
    return this.commands.get(name) || null;
  }

  /**
   * Register commands for a specific guild
   * @param {Object} guild - Discord guild object
   * @returns {Promise} - Registration result
   */
  async registerGuildCommands(guild) {
    const commands = this.getCommandBuilders();
    return await guild.commands.set(commands);
  }

  /**
   * Register commands globally
   * @param {Object} client - Discord client
   * @returns {Promise} - Registration result
   */
  async registerGlobalCommands(client) {
    const commands = this.getCommandBuilders();
    return await client.application.commands.set(commands);
  }

  /**
   * Register commands for all guilds and globally
   * @param {Object} client - Discord client
   * @returns {Promise} - Registration result
   */
  async registerAllCommands(client) {
    try {
      console.log('Registering slash commands...');
      const commandNames = Array.from(this.commands.keys());
      console.log(`Commands to register: ${commandNames.join(', ')}`);
      
      // Register as guild commands first (faster, immediate availability)
      const guilds = client.guilds.cache;
      if (guilds.size > 0) {
        console.log(`Registering commands for ${guilds.size} guild(s)...`);
        for (const [guildId, guild] of guilds) {
          try {
            await guild.commands.set(this.getCommandBuilders());
            console.log(`✅ Commands registered for guild: ${guild.name} (${guildId})`);
          } catch (guildError) {
            console.error(`❌ Error registering commands for guild ${guild.name}:`, guildError.message);
          }
        }
        console.log('✅ All guild commands registered successfully!');
        console.log('Commands registered:', commandNames);
      } else {
        console.log('⚠️ No guilds found, registering globally...');
        await client.application.commands.set(this.getCommandBuilders());
        console.log('✅ Global slash commands registered successfully!');
      }
    } catch (error) {
      console.error('Error registering commands:', error);
      console.error('Error details:', error.message);
    }
  }

  /**
   * Handle command interaction
   * @param {Object} interaction - Discord interaction
   * @param {Object} services - Service objects
   * @returns {Promise} - Command execution result
   */
  async handleInteraction(interaction, services) {
    if (!interaction.isChatInputCommand()) return;

    const command = this.getCommand(interaction.commandName);
    if (!command) {
      console.error(`Unknown command: ${interaction.commandName}`);
      return;
    }

    // Note: Discord.js handles permissions automatically via setDefaultMemberPermissions
    // No need to manually check permissions here

    try {
      await command.execute(interaction, services);
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);
      await command.sendError(interaction, `An error occurred while executing the command: ${error.message}`);
    }
  }

  /**
   * Get command statistics
   * @returns {Object} - Command statistics
   */
  getStats() {
    return {
      totalCommands: this.commands.size,
      commandNames: Array.from(this.commands.keys())
    };
  }
}

module.exports = CommandManager;
