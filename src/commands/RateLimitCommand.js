/**
 * Rate Limit Status Command
 * Shows detailed information about the rate limiter status and metrics
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('./BaseCommand');

class RateLimitCommand extends BaseCommand {
  constructor() {
    super();
    this.data = new SlashCommandBuilder()
      .setName('ratelimit')
      .setDescription('Show rate limiter status and API usage metrics');
  }

  async execute(interaction, services) {
    const { riotApi } = services;
    
    try {
      const status = riotApi.getRateLimiterStatus();
      const metrics = riotApi.rateLimiter.getMetrics();
      
      // Create detailed embed
      const embed = new EmbedBuilder()
        .setTitle('🚦 Rate Limiter Status')
        .setColor(0x00ff00)
        .setTimestamp()
        .addFields(
          {
            name: '📊 Queue Status',
            value: `**Total Queued:** ${status.totalQueued}\n` +
                   `**Priority Queues:**\n` +
                   `• High (4): ${status.priorityQueues[4]}\n` +
                   `• Medium (3): ${status.priorityQueues[3]}\n` +
                   `• Low (2): ${status.priorityQueues[2]}\n` +
                   `• Background (1): ${status.priorityQueues[1]}`,
            inline: true
          },
          {
            name: '⏱️ Rate Limits',
            value: `**Last Second:** ${status.requestsLastSecond}/${riotApi.rateLimiter.requestsPerSecond}\n` +
                   `**Last 2 Minutes:** ${status.requestsLastTwoMinutes}/${riotApi.rateLimiter.requestsPerTwoMinutes}\n` +
                   `**Processing:** ${status.isProcessing ? '✅ Yes' : '❌ No'}`,
            inline: true
          },
          {
            name: '📈 Performance Metrics',
            value: `**Total Requests:** ${metrics.totalRequests}\n` +
                   `**Success Rate:** ${metrics.successRate.toFixed(1)}%\n` +
                   `**Cache Hit Rate:** ${metrics.cacheHitRate.toFixed(1)}%\n` +
                   `**Avg Response Time:** ${metrics.averageResponseTime.toFixed(0)}ms`,
            inline: true
          },
          {
            name: '⚠️ Error Status',
            value: `**Consecutive Errors:** ${status.consecutiveErrors}\n` +
                   `**Rate Limit Hits:** ${metrics.rateLimitHits}\n` +
                   `**Backoff Multiplier:** ${status.backoffMultiplier.toFixed(2)}x\n` +
                   `**Cache Size:** ${status.cacheSize} entries`,
            inline: true
          },
          {
            name: '📊 Throughput',
            value: `**Requests/Minute:** ${metrics.requestsPerMinute.toFixed(1)}\n` +
                   `**Uptime:** ${Math.floor(metrics.uptime / 1000 / 60)} minutes\n` +
                   `**Failed Requests:** ${metrics.failedRequests}`,
            inline: true
          }
        );

      // Add warning if approaching limits
      if (status.requestsLastSecond > riotApi.rateLimiter.requestsPerSecond * 0.8) {
        embed.setColor(0xffaa00);
        embed.addFields({
          name: '⚠️ Warning',
          value: 'Approaching per-second rate limit!',
          inline: false
        });
      }

      if (status.requestsLastTwoMinutes > riotApi.rateLimiter.requestsPerTwoMinutes * 0.8) {
        embed.setColor(0xff0000);
        embed.addFields({
          name: '🚨 Critical',
          value: 'Approaching per-2-minute rate limit!',
          inline: false
        });
      }

      if (status.consecutiveErrors > 3) {
        embed.setColor(0xff0000);
        embed.addFields({
          name: '🔴 High Error Rate',
          value: `${status.consecutiveErrors} consecutive errors detected!`,
          inline: false
        });
      }

      await interaction.reply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in rate limit command:', error);
      await interaction.reply({ 
        content: '❌ Error retrieving rate limiter status.', 
        ephemeral: true 
      });
    }
  }
}

module.exports = RateLimitCommand;
