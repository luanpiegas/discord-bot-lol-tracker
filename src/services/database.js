import sqlite3 from 'node:sqlite3';
import { config } from '../config/config.js';

class Database {
  constructor() {
    this.db = null;
  }

  async connect() {
    try {
      this.db = new sqlite3.Database(config.DB_PATH);
      console.log(`Connected to database at ${config.DB_PATH}`);
      await this.initSchema();
    } catch (error) {
      console.error('Failed to connect to database:', error.message);
      throw error;
    }
  }

  // Promise wrappers for database operations
  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async initSchema() {
    await this.run(`
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

  // Database operations
  async setGuildConfig(guildId, channelId) {
    return this.run(
      'INSERT OR REPLACE INTO guild_configs (guild_id, channel_id) VALUES (?, ?)',
      [guildId, channelId]
    );
  }

  async getGuildConfig(guildId) {
    return this.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]);
  }

  async getAllGuildConfigs() {
    return this.all('SELECT * FROM guild_configs');
  }

  async deleteGuildPlayers(guildId) {
    return this.run('DELETE FROM tracked_players WHERE guild_id = ?', [guildId]);
  }

  async addPlayer(guildId, gameName, tagLine, puuid) {
    return this.run(
      'INSERT INTO tracked_players (guild_id, game_name, tag_line, puuid) VALUES (?, ?, ?, ?)',
      [guildId, gameName, tagLine, puuid]
    );
  }

  async getPlayers(guildId) {
    return this.all('SELECT * FROM tracked_players WHERE guild_id = ?', [guildId]);
  }

  async setLastMatch(guildId, puuid, matchId) {
    return this.run(
      'INSERT OR REPLACE INTO last_matches (guild_id, puuid, match_id) VALUES (?, ?, ?)',
      [guildId, puuid, matchId]
    );
  }

  async getLastMatch(guildId, puuid) {
    return this.get(
      'SELECT match_id FROM last_matches WHERE guild_id = ? AND puuid = ?',
      [guildId, puuid]
    );
  }

  async close() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
}

export const db = new Database();