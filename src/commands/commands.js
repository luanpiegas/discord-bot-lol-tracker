import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { db } from '../services/database.js';
import { riotAPI } from '../services/riotAPI.js';

export const setupCommand = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set up the channel for match notifications')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to send match notifications to')
        .setRequired(true)),
  
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    await db.setGuildConfig(interaction.guildId, channel.id);
    await interaction.reply(`Match notifications will be sent to ${channel}`);
  }
};

export const trackCommand = {
  data: new SlashCommandBuilder()
    .setName('track')
    .setDescription('Track a League of Legends player')
    .addStringOption(option =>
      option.setName('gamename')
        .setDescription('The game name of the player')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('tagline')
        .setDescription('The tagline of the player')
        .setRequired(true)),
  
  async execute(interaction) {
    const guildConfig = await db.getGuildConfig(interaction.guildId);
    if (!guildConfig) {
      await interaction.reply('Please set up a notification channel first using /setup');
      return;
    }

    const gameName = interaction.options.getString('gamename');
    const tagLine = interaction.options.getString('tagline');

    const puuid = await riotAPI.getPuuid(gameName, tagLine);
    if (!puuid) {
      await interaction.reply('Player not found. Please check the game name and tagline.');
      return;
    }

    await db.addPlayer(interaction.guildId, gameName, tagLine, puuid);
    await interaction.reply(`Now tracking ${gameName}#${tagLine}`);
  }
};

export const listCommand = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('List all tracked players'),
  
  async execute(interaction) {
    const players = await db.getPlayers(interaction.guildId);
    if (players.length === 0) {
      await interaction.reply('No players are being tracked.');
      return;
    }

    const list = players.map(p => `${p.game_name}#${p.tag_line}`).join('\\n');
    await interaction.reply(`Tracked players:\\n${list}`);
  }
};

export const removeCommand = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove all tracked players')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  
  async execute(interaction) {
    await db.deleteGuildPlayers(interaction.guildId);
    await interaction.reply('Removed all tracked players.');
  }
};