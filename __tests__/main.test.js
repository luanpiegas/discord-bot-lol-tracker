const https = require('https');

// Mock the environment variables
process.env.RIOT_API_KEY = 'test-api-key';
process.env.DISCORD_TOKEN = 'test-discord-token';
process.env.DB_PATH = ':memory:'; // Use in-memory SQLite for testing

// Mock https.get
jest.mock('https');

// Import the functions to test
const { Client } = require('discord.js');
const Database = require('better-sqlite3');

describe('Riot API Helper Functions', () => {
  let mockResponse;
  
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Setup default mock response
    mockResponse = {
      statusCode: 200,
      on: jest.fn(),
    };
    
    https.get.mockImplementation((options, callback) => {
      callback(mockResponse);
      return {
        on: jest.fn(),
      };
    });
  });

  describe('riotApiRequest', () => {
    it('should make a successful API request', async () => {
      const testData = { test: 'data' };
      mockResponse.on.mockImplementation((event, callback) => {
        if (event === 'data') callback(JSON.stringify(testData));
        if (event === 'end') callback();
      });

      const { riotApiRequest } = require('../main.js');
      const result = await riotApiRequest('/test/path');

      expect(https.get).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'br1.api.riotgames.com',
          path: '/test/path',
          headers: { 'X-Riot-Token': 'test-api-key' }
        }),
        expect.any(Function)
      );
      expect(result).toEqual(testData);
    });

    it('should handle API errors', async () => {
      mockResponse.statusCode = 404;
      mockResponse.on.mockImplementation((event, callback) => {
        if (event === 'data') callback('Not Found');
        if (event === 'end') callback();
      });

      const { riotApiRequest } = require('../main.js');
      await expect(riotApiRequest('/test/path')).rejects.toThrow('API Error: 404');
    });
  });

  describe('getPuuid', () => {
    it('should return PUUID for valid Riot ID', async () => {
      const mockPuuid = 'test-puuid-123';
      mockResponse.on.mockImplementation((event, callback) => {
        if (event === 'data') callback(JSON.stringify({ puuid: mockPuuid }));
        if (event === 'end') callback();
      });

      const { getPuuid } = require('../main.js');
      const result = await getPuuid('TestPlayer', 'TAG');

      expect(result).toBe(mockPuuid);
    });

    it('should return null for invalid Riot ID', async () => {
      mockResponse.statusCode = 404;
      mockResponse.on.mockImplementation((event, callback) => {
        if (event === 'data') callback('Player not found');
        if (event === 'end') callback();
      });

      const { getPuuid } = require('../main.js');
      const result = await getPuuid('InvalidPlayer', 'TAG');

      expect(result).toBeNull();
    });
  });

  describe('getLastMatch', () => {
    it('should return match data for valid PUUID', async () => {
      const mockMatchId = 'BR1_123456';
      const mockMatchData = {
        info: {
          participants: [
            { puuid: 'test-puuid', championName: 'Ahri', kills: 10 }
          ]
        }
      };

      let callCount = 0;
      mockResponse.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callCount++;
          if (callCount === 1) {
            callback(JSON.stringify([mockMatchId]));
          } else {
            callback(JSON.stringify(mockMatchData));
          }
        }
        if (event === 'end') callback();
      });

      const { getLastMatch } = require('../main.js');
      const result = await getLastMatch('test-puuid');

      expect(result).toBeDefined();
      expect(result.matchId).toBe(mockMatchId);
    });

    it('should return null when no matches found', async () => {
      mockResponse.on.mockImplementation((event, callback) => {
        if (event === 'data') callback(JSON.stringify([]));
        if (event === 'end') callback();
      });

      const { getLastMatch } = require('../main.js');
      const result = await getLastMatch('test-puuid');

      expect(result).toBeNull();
    });
  });
});