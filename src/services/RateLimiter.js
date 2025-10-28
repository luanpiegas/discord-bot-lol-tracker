/**
 * Rate Limiter Service
 * Manages API request rate limiting for Riot Games API
 * Respects 20 requests/second and 100 requests/2 minutes limits
 */
class RateLimiter {
  constructor() {
    this.requestsPerSecond = 20;
    this.requestsPerTwoMinutes = 100;
    this.requestQueue = [];
    this.requestTimes = [];
    this.twoMinuteRequests = [];
    this.isProcessing = false;
  }

  /**
   * Add a request to the queue
   * @param {Function} requestFn - The function that makes the API request
   * @returns {Promise} - Resolves when the request is processed
   */
  async addRequest(requestFn) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ requestFn, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process the request queue with rate limiting
   * @private
   */
  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      // Clean old request times (older than 1 second)
      const now = Date.now();
      this.requestTimes = this.requestTimes.filter(time => now - time < 1000);
      this.twoMinuteRequests = this.twoMinuteRequests.filter(time => now - time < 120000);

      // Check if we can make a request
      if (this.requestTimes.length >= this.requestsPerSecond || 
          this.twoMinuteRequests.length >= this.requestsPerTwoMinutes) {
        // Wait for the oldest request to expire
        const waitTime = this.requestTimes.length > 0 ? 
          1000 - (now - this.requestTimes[0]) + 10 : // Wait for 1-second window to reset
          120000 - (now - this.twoMinuteRequests[0]) + 10; // Wait for 2-minute window to reset
        
        await new Promise(resolve => setTimeout(resolve, Math.max(waitTime, 50)));
        continue;
      }

      // Make the request
      const { requestFn, resolve, reject } = this.requestQueue.shift();
      this.requestTimes.push(now);
      this.twoMinuteRequests.push(now);

      try {
        const result = await requestFn();
        resolve(result);
      } catch (error) {
        // If it's a rate limit error, retry after delay
        if (error.message.includes('429') || error.message.includes('rate limit')) {
          this.requestQueue.unshift({ requestFn, resolve, reject });
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          reject(error);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Get current queue status
   * @returns {Object} - Status information
   */
  getQueueStatus() {
    return {
      queueLength: this.requestQueue.length,
      requestsLastSecond: this.requestTimes.length,
      requestsLastTwoMinutes: this.twoMinuteRequests.length,
      isProcessing: this.isProcessing
    };
  }

  /**
   * Clear the request queue (useful for testing or emergency situations)
   */
  clearQueue() {
    this.requestQueue = [];
    this.requestTimes = [];
    this.twoMinuteRequests = [];
    this.isProcessing = false;
  }
}

module.exports = RateLimiter;
