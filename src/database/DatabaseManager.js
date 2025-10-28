/**
 * Database Manager
 * Handles all database operations for the Discord bot
 */
const Database = require('better-sqlite3');
const config = require('../config');

class DatabaseManager {
  constructor() {
    this.db = new Database(config.database.path);
    this.initializeTables();
    this.prepareStatements();
  }

  /**
   * Initialize database tables
   * @private
   */
  initializeTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_configs (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tracked_players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        game_name TEXT NOT NULL,
        tag_line TEXT NOT NULL,
        puuid TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES guild_configs(guild_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS last_matches (
        guild_id TEXT NOT NULL,
        puuid TEXT NOT NULL,
        match_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, puuid)
      );
    `);
  }

  /**
   * Prepare database statements for better performance
   * @private
   */
  prepareStatements() {
    this.stmts = {
      // Guild configuration
      setGuildConfig: this.db.prepare('INSERT OR REPLACE INTO guild_configs (guild_id, channel_id) VALUES (?, ?)'),
      getGuildConfig: this.db.prepare('SELECT * FROM guild_configs WHERE guild_id = ?'),
      getAllGuildConfigs: this.db.prepare('SELECT * FROM guild_configs'),
      deleteGuildConfig: this.db.prepare('DELETE FROM guild_configs WHERE guild_id = ?'),

      // Player management
      addPlayer: this.db.prepare('INSERT INTO tracked_players (guild_id, game_name, tag_line, puuid) VALUES (?, ?, ?, ?)'),
      getPlayers: this.db.prepare('SELECT * FROM tracked_players WHERE guild_id = ?'),
      getAllPlayers: this.db.prepare('SELECT * FROM tracked_players'),
      deleteGuildPlayers: this.db.prepare('DELETE FROM tracked_players WHERE guild_id = ?'),
      deletePlayer: this.db.prepare('DELETE FROM tracked_players WHERE guild_id = ? AND puuid = ?'),
      updatePlayer: this.db.prepare('UPDATE tracked_players SET game_name = ?, tag_line = ? WHERE guild_id = ? AND puuid = ?'),

      // Match tracking
      setLastMatch: this.db.prepare('INSERT OR REPLACE INTO last_matches (guild_id, puuid, match_id) VALUES (?, ?, ?)'),
      getLastMatch: this.db.prepare('SELECT match_id FROM last_matches WHERE guild_id = ? AND puuid = ?'),
      deleteLastMatch: this.db.prepare('DELETE FROM last_matches WHERE guild_id = ? AND puuid = ?'),
      deleteGuildLastMatches: this.db.prepare('DELETE FROM last_matches WHERE guild_id = ?'),

      // Statistics
      getPlayerCount: this.db.prepare('SELECT COUNT(*) as count FROM tracked_players'),
      getGuildPlayerCount: this.db.prepare('SELECT COUNT(*) as count FROM tracked_players WHERE guild_id = ?'),
      getTotalPlayerCount: this.db.prepare(`
        SELECT 
          COUNT(DISTINCT guild_id) as guild_count,
          COUNT(*) as total_players 
        FROM tracked_players
      `)
    };
  }

  // Guild Configuration Methods
  setGuildConfig(guildId, channelId) {
    return this.stmts.setGuildConfig.run(guildId, channelId);
  }

  getGuildConfig(guildId) {
    return this.stmts.getGuildConfig.get(guildId);
  }

  getAllGuildConfigs() {
    return this.stmts.getAllGuildConfigs.all();
  }

  deleteGuildConfig(guildId) {
    const transaction = this.db.transaction(() => {
      this.stmts.deleteGuildConfig.run(guildId);
      this.stmts.deleteGuildPlayers.run(guildId);
      this.stmts.deleteGuildLastMatches.run(guildId);
    });
    return transaction();
  }

  // Player Management Methods
  addPlayer(guildId, gameName, tagLine, puuid) {
    return this.stmts.addPlayer.run(guildId, gameName, tagLine, puuid);
  }

  getPlayers(guildId) {
    return this.stmts.getPlayers.all(guildId);
  }

  getAllPlayers() {
    return this.stmts.getAllPlayers.all();
  }

  deleteGuildPlayers(guildId) {
    return this.stmts.deleteGuildPlayers.run(guildId);
  }

  deletePlayer(guildId, puuid) {
    return this.stmts.deletePlayer.run(guildId, puuid);
  }

  updatePlayer(guildId, puuid, gameName, tagLine) {
    return this.stmts.updatePlayer.run(gameName, tagLine, guildId, puuid);
  }

  // Match Tracking Methods
  setLastMatch(guildId, puuid, matchId) {
    return this.stmts.setLastMatch.run(guildId, puuid, matchId);
  }

  getLastMatch(guildId, puuid) {
    return this.stmts.getLastMatch.get(guildId, puuid);
  }

  deleteLastMatch(guildId, puuid) {
    return this.stmts.deleteLastMatch.run(guildId, puuid);
  }

  // Statistics Methods
  getPlayerCount() {
    return this.stmts.getPlayerCount.get().count;
  }

  getGuildPlayerCount(guildId) {
    return this.stmts.getGuildPlayerCount.get(guildId).count;
  }

  getTotalPlayerCount() {
    return this.stmts.getTotalPlayerCount.get();
  }

  // Transaction Methods
  transaction(callback) {
    return this.db.transaction(callback);
  }

  // Cleanup Methods
  close() {
    this.db.close();
  }

  // Health Check
  healthCheck() {
    try {
      this.db.prepare('SELECT 1').get();
      return { status: 'healthy', message: 'Database connection is working' };
    } catch (error) {
      return { status: 'unhealthy', message: error.message };
    }
  }
}

module.exports = DatabaseManager;
