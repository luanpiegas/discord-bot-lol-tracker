const { Client, GatewayIntentBits } = require('discord.js');

// Import modules
const config = require('./src/config');
const DatabaseManager = require('./src/database/DatabaseManager');
const RiotApiService = require('./src/services/RiotApiService');
const MatchChecker = require('./src/services/MatchChecker');
const CommandManager = require('./src/commands/CommandManager');

// Validate configuration
try {
  config.validate();
} catch (error) {
  console.error('Configuration error:', error.message);
  process.exit(1);
}

// Initialize services
const database = new DatabaseManager();
const riotApi = new RiotApiService();
const commandManager = new CommandManager();

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Initialize match checker
let matchChecker = null;

// Export functions for testing
module.exports = {
  riotApiRequest: (path, region) => riotApi.request(path, region),
  getPuuid: (gameName, tagLine) => riotApi.getPuuid(gameName, tagLine),
  getLastMatch: (puuid) => riotApi.getLastMatch(puuid),
  database,
  riotApi,
  commandManager
};

// Bot ready event
client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    // Register slash commands
    await commandManager.registerAllCommands(client);
    
    // Initialize match checker
    matchChecker = new MatchChecker(database, riotApi, client);
    matchChecker.start();
    
    console.log('✅ Bot is ready and running!');
  } catch (error) {
    console.error('Error during bot initialization:', error);
  }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  const services = {
    database,
    riotApi,
    commandManager
  };
  
  await commandManager.handleInteraction(interaction, services);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  
  if (matchChecker) {
    matchChecker.stop();
  }
  
  database.close();
  process.exit(0);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Login
client.login(config.discord.token);
