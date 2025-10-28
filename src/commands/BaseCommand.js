/**
 * Base Command Class
 * Provides common functionality for all slash commands
 */
const { PermissionFlagsBits } = require('discord.js');

class BaseCommand {
  constructor(name, description, options = []) {
    this.name = name;
    this.description = description;
    this.options = options;
    this.defaultMemberPermissions = PermissionFlagsBits.Administrator;
  }

  /**
   * Get the slash command builder
   * @returns {SlashCommandBuilder} - Discord.js slash command builder
   */
  getBuilder() {
    const { SlashCommandBuilder } = require('discord.js');
    const builder = new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(this.description)
      .setDefaultMemberPermissions(this.defaultMemberPermissions);

    // Add options
    this.options.forEach(option => {
      if (option.type === 'string') {
        builder.addStringOption(opt => 
          opt.setName(option.name)
            .setDescription(option.description)
            .setRequired(option.required || false)
        );
      } else if (option.type === 'channel') {
        builder.addChannelOption(opt => 
          opt.setName(option.name)
            .setDescription(option.description)
            .setRequired(option.required || false)
        );
      } else if (option.type === 'user') {
        builder.addUserOption(opt => 
          opt.setName(option.name)
            .setDescription(option.description)
            .setRequired(option.required || false)
        );
      } else if (option.type === 'integer') {
        builder.addIntegerOption(opt => 
          opt.setName(option.name)
            .setDescription(option.description)
            .setRequired(option.required || false)
        );
      }
    });

    return builder;
  }

  /**
   * Execute the command
   * @param {Object} interaction - Discord interaction object
   * @param {Object} services - Service objects (database, riotApi, etc.)
   * @returns {Promise} - Command execution result
   */
  async execute(interaction, services) {
    throw new Error('Execute method must be implemented by subclasses');
  }

  /**
   * Check if user has required permissions
   * @param {Object} interaction - Discord interaction object
   * @returns {boolean} - Whether user has permissions
   */
  hasPermission(interaction) {
    if (!interaction.member) return false;
    // Use the correct Discord.js v14 permissions API
    return interaction.member.permissions.has(this.defaultMemberPermissions);
  }

  /**
   * Send error response
   * @param {Object} interaction - Discord interaction object
   * @param {string} message - Error message
   * @param {boolean} ephemeral - Whether to send as ephemeral
   */
  async sendError(interaction, message, ephemeral = true) {
    const { EmbedUtils } = require('../utils/EmbedBuilder');
    const embed = EmbedUtils.createErrorEmbed('Error', message);
    
    if (interaction.deferred) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral });
    }
  }

  /**
   * Send success response
   * @param {Object} interaction - Discord interaction object
   * @param {string} title - Success title
   * @param {string} message - Success message
   * @param {boolean} ephemeral - Whether to send as ephemeral
   */
  async sendSuccess(interaction, title, message, ephemeral = true) {
    const { EmbedUtils } = require('../utils/EmbedBuilder');
    const embed = EmbedUtils.createSuccessEmbed(title, message);
    
    if (interaction.deferred) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral });
    }
  }
}

module.exports = BaseCommand;
