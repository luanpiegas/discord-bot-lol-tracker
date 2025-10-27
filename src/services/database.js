'use strict';

import { DatabaseSync } from 'node:sqlite';
import { config, schema } from '../config/config.js';

let _db = new DatabaseSync(process.env.DB_PATH);

_db.exec(schema);

export function setGuildConfig(guildId, channelId) {
  let query = _db.prepare('INSERT OR REPLACE INTO guild_configs (guild_id, channel_id) VALUES (?, ?)');
  return query.run(guildId, channelId);
}

export function getGuildConfig(guildId) {
  let query = _db.prepare('SELECT * FROM guild_configs WHERE guild_id = ?');
  return query.run(guildId);
}

export function getAllGuildConfigs() {
  let query = _db.prepare('SELECT * FROM guild_configs');
  return query.all();
}

export function deleteGuildPlayers(guildId) {
  let query = _db.prepare('DELETE FROM tracked_players WHERE guild_id = ?');
  return query.run(guildId);
}

export function addPlayer(guildId, gameName, tagLine, puuid) {
  let query = _db.prepare('INSERT INTO tracked_players (guild_id, game_name, tag_line, puuid) VALUES (?, ?, ?, ?)');
  return query.run(guildId, gameName, tagLine, puuid);
}

export function getPlayers(guildId) {
  let query = _db.prepare('SELECT * FROM tracked_players WHERE guild_id = ?');
  return query.all(guildId);
}

export function setLastMatch(guildId, puuid, matchId) {
  let query = _db.prepare('INSERT OR REPLACE INTO last_matches (guild_id, puuid, match_id) VALUES (?, ?, ?)');
  return query.run(guildId, puuid, matchId);
}

export function getLastMatch(guildId, puuid) {
  let query = _db.prepare('SELECT match_id FROM last_matches WHERE guild_id = ? AND puuid = ?');
  return query.get(guildId, puuid);
}

// Export a compatibility object named `db` so existing imports continue to work
export const db = {
  setGuildConfig,
  getGuildConfig,
  getAllGuildConfigs,
  deleteGuildPlayers,
  addPlayer,
  getPlayers,
  setLastMatch,
  getLastMatch
};