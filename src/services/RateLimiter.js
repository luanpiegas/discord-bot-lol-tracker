/**
 * Advanced Rate Limiter Service
 * Manages API request rate limiting for Riot Games API with intelligent queuing
 * Respects 20 requests/second and 100 requests/2 minutes limits
 */
class RateLimiter {
  constructor() {
    // Rate limits (conservative to avoid blocks)
    this.requestsPerSecond = 18; // 18 instead of 20 for safety margin
    this.requestsPerTwoMinutes = 95; // 95 instead of 100 for safety margin
    
    // Request tracking
    this.requestTimes = [];
    this.twoMinuteRequests = [];
    
    // Priority queues (higher number = higher priority)
    this.priorityQueues = {
      1: [], // Low priority (background checks)
      2: [], // Medium priority (manual commands)
      3: [], // High priority (critical operations)
      4: []  // Emergency priority (user interactions)
    };
    
    // Processing state
    this.isProcessing = false;
    this.consecutiveErrors = 0;
    this.lastErrorTime = 0;
    this.backoffMultiplier = 1;
    this.maxBackoffMultiplier = 8;
    
    // Request cache
    this.cache = new Map();
    this.cacheTimeout = 30000; // 30 seconds cache
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      cacheHits: 0,
      averageResponseTime: 0,
      lastResetTime: Date.now()
    };
    
    // Start processing loop
    this.startProcessing();
  }

  /**
   * Add a request to the queue with priority
   * @param {Function} requestFn - The function that makes the API request
   * @param {Object} options - Request options
   * @param {number} options.priority - Priority level (1-4, default: 1)
   * @param {string} options.cacheKey - Optional cache key for deduplication
   * @param {number} options.timeout - Request timeout in ms (default: 10000)
   * @returns {Promise} - Resolves when the request is processed
   */
  async addRequest(requestFn, options = {}) {
    const {
      priority = 1,
      cacheKey = null,
      timeout = 10000
    } = options;

    // Check cache first
    if (cacheKey && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        this.metrics.cacheHits++;
        return cached.data;
      }
      this.cache.delete(cacheKey);
    }

    return new Promise((resolve, reject) => {
      const request = {
        requestFn,
        resolve,
        reject,
        priority: Math.max(1, Math.min(4, priority)),
        cacheKey,
        timeout,
        timestamp: Date.now(),
        retryCount: 0
      };

      this.priorityQueues[request.priority].push(request);
      this.metrics.totalRequests++;
    });
  }

  /**
   * Start the processing loop
   * @private
   */
  startProcessing() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.processLoop();
  }

  /**
   * Main processing loop
   * @private
   */
  async processLoop() {
    while (this.isProcessing) {
      try {
        const request = this.getNextRequest();
        
        if (!request) {
          // No requests available, wait a bit
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // Check rate limits
        if (!this.canMakeRequest()) {
          await this.waitForRateLimit();
          continue;
        }

        // Execute request
        await this.executeRequest(request);
        
      } catch (error) {
        console.error('Rate limiter processing error:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Get the next request to process based on priority
   * @private
   */
  getNextRequest() {
    // Check queues in priority order (4 -> 3 -> 2 -> 1)
    for (let priority = 4; priority >= 1; priority--) {
      if (this.priorityQueues[priority].length > 0) {
        return this.priorityQueues[priority].shift();
      }
    }
    return null;
  }

  /**
   * Check if we can make a request without hitting rate limits
   * @private
   */
  canMakeRequest() {
    const now = Date.now();
    
    // Clean old request times
    this.requestTimes = this.requestTimes.filter(time => now - time < 1000);
    this.twoMinuteRequests = this.twoMinuteRequests.filter(time => now - time < 120000);
    
    // Check limits with safety margins
    const canMakeSecondRequest = this.requestTimes.length < this.requestsPerSecond;
    const canMakeTwoMinuteRequest = this.twoMinuteRequests.length < this.requestsPerTwoMinutes;
    
    return canMakeSecondRequest && canMakeTwoMinuteRequest;
  }

  /**
   * Wait for rate limit to reset
   * @private
   */
  async waitForRateLimit() {
    const now = Date.now();
    const timeUntilSecondReset = this.requestTimes.length > 0 ? 
      1000 - (now - this.requestTimes[0]) + 50 : 0;
    const timeUntilTwoMinuteReset = this.twoMinuteRequests.length > 0 ? 
      120000 - (now - this.twoMinuteRequests[0]) + 50 : 0;
    
    const waitTime = Math.max(timeUntilSecondReset, timeUntilTwoMinuteReset, 50);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  /**
   * Execute a request with proper error handling and retry logic
   * @private
   */
  async executeRequest(request) {
    const startTime = Date.now();
    const now = Date.now();
    
    try {
      // Add to rate limit tracking
      this.requestTimes.push(now);
      this.twoMinuteRequests.push(now);
      
      // Set up timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), request.timeout);
      });
      
      // Execute request with timeout
      const result = await Promise.race([
        request.requestFn(),
        timeoutPromise
      ]);
      
      // Update metrics
      const responseTime = Date.now() - startTime;
      this.updateMetrics(true, responseTime);
      
      // Cache result if cache key provided
      if (request.cacheKey) {
        this.cache.set(request.cacheKey, {
          data: result,
          timestamp: now
        });
      }
      
      request.resolve(result);
      
    } catch (error) {
      this.updateMetrics(false);
      
      // Handle rate limit errors with adaptive backoff
      if (error.message.includes('429') || error.message.includes('rate limit')) {
        this.metrics.rateLimitHits++;
        this.consecutiveErrors++;
        this.lastErrorTime = now;
        
        // Extract retry-after header if available
        let retryAfter = 1;
        if (error.message.includes('Retry after')) {
          const match = error.message.match(/Retry after (\d+)/);
          if (match) {
            retryAfter = parseInt(match[1]);
          }
        }
        
        // Adaptive backoff based on retry-after header
        const backoffTime = Math.min(
          Math.max(
            retryAfter * 1000, // Use retry-after if available
            1000 * Math.pow(2, this.consecutiveErrors) * this.backoffMultiplier
          ),
          30000 // Max 30 seconds
        );
        
        console.warn(`Rate limit hit. Backing off for ${backoffTime}ms (attempt ${request.retryCount + 1})`);
        
        // Adjust rate limits based on consecutive errors
        if (this.consecutiveErrors > 2) {
          this.requestsPerSecond = Math.max(10, this.requestsPerSecond - 2);
          this.requestsPerTwoMinutes = Math.max(50, this.requestsPerTwoMinutes - 10);
          console.warn(`Reducing rate limits due to consecutive errors: ${this.requestsPerSecond}/s, ${this.requestsPerTwoMinutes}/2min`);
        }
        
        // Retry with backoff
        if (request.retryCount < 3) {
          request.retryCount++;
          setTimeout(() => {
            this.priorityQueues[request.priority].unshift(request);
          }, backoffTime);
          return;
        }
      } else {
        // Reset backoff on non-rate-limit errors
        this.consecutiveErrors = 0;
        this.backoffMultiplier = 1;
        
        // Gradually restore rate limits after successful periods
        if (this.requestsPerSecond < 18) {
          this.requestsPerSecond = Math.min(18, this.requestsPerSecond + 1);
        }
        if (this.requestsPerTwoMinutes < 95) {
          this.requestsPerTwoMinutes = Math.min(95, this.requestsPerTwoMinutes + 5);
        }
      }
      
      request.reject(error);
    }
  }

  /**
   * Update metrics
   * @private
   */
  updateMetrics(success, responseTime = 0) {
    if (success) {
      this.metrics.successfulRequests++;
      this.consecutiveErrors = 0;
      this.backoffMultiplier = Math.max(1, this.backoffMultiplier * 0.9);
    } else {
      this.metrics.failedRequests++;
    }
    
    // Update average response time
    if (responseTime > 0) {
      const total = this.metrics.successfulRequests + this.metrics.failedRequests;
      this.metrics.averageResponseTime = 
        (this.metrics.averageResponseTime * (total - 1) + responseTime) / total;
    }
  }

  /**
   * Get comprehensive queue status
   * @returns {Object} - Status information
   */
  getQueueStatus() {
    const now = Date.now();
    const totalQueued = Object.values(this.priorityQueues).reduce((sum, queue) => sum + queue.length, 0);
    
    return {
      totalQueued,
      priorityQueues: {
        1: this.priorityQueues[1].length,
        2: this.priorityQueues[2].length,
        3: this.priorityQueues[3].length,
        4: this.priorityQueues[4].length
      },
      requestsLastSecond: this.requestTimes.length,
      requestsLastTwoMinutes: this.twoMinuteRequests.length,
      isProcessing: this.isProcessing,
      consecutiveErrors: this.consecutiveErrors,
      backoffMultiplier: this.backoffMultiplier,
      cacheSize: this.cache.size,
      metrics: { ...this.metrics }
    };
  }

  /**
   * Get detailed metrics
   * @returns {Object} - Detailed metrics
   */
  getMetrics() {
    const now = Date.now();
    const uptime = now - this.metrics.lastResetTime;
    
    return {
      ...this.metrics,
      uptime,
      requestsPerMinute: (this.metrics.totalRequests / uptime) * 60000,
      successRate: this.metrics.totalRequests > 0 ? 
        (this.metrics.successfulRequests / this.metrics.totalRequests) * 100 : 0,
      cacheHitRate: this.metrics.totalRequests > 0 ? 
        (this.metrics.cacheHits / this.metrics.totalRequests) * 100 : 0
    };
  }

  /**
   * Clear all queues and reset state
   */
  clearQueue() {
    Object.values(this.priorityQueues).forEach(queue => queue.length = 0);
    this.requestTimes = [];
    this.twoMinuteRequests = [];
    this.consecutiveErrors = 0;
    this.backoffMultiplier = 1;
    this.cache.clear();
  }

  /**
   * Stop processing and clear all queues
   */
  stop() {
    this.isProcessing = false;
    this.clearQueue();
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      cacheHits: 0,
      averageResponseTime: 0,
      lastResetTime: Date.now()
    };
  }

  /**
   * Reset rate limits to default values
   */
  resetRateLimits() {
    this.requestsPerSecond = 18;
    this.requestsPerTwoMinutes = 95;
    this.consecutiveErrors = 0;
    this.backoffMultiplier = 1;
    console.log('Rate limits reset to default values');
  }

  /**
   * Get current rate limit settings
   * @returns {Object} - Current rate limit settings
   */
  getRateLimitSettings() {
    return {
      requestsPerSecond: this.requestsPerSecond,
      requestsPerTwoMinutes: this.requestsPerTwoMinutes,
      consecutiveErrors: this.consecutiveErrors,
      backoffMultiplier: this.backoffMultiplier
    };
  }
}

module.exports = RateLimiter;
