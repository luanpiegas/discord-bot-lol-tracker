class RateLimiter {
  constructor(limitPerSecond, limitPerTwoMin) {
    this.limitPerSecond = limitPerSecond;
    this.limitPerTwoMin = limitPerTwoMin;
    this.tokensPerSecond = limitPerSecond;
    this.tokensPerTwoMin = limitPerTwoMin;
    this.lastRefillTimeSecond = Date.now();
    this.lastRefillTimeTwoMin = Date.now();
    this.queue = [];
    this.processing = false;
  }

  async waitForToken() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    
    // Refill tokens based on time passed
    this.refillTokens();

    if (this.tokensPerSecond > 0 && this.tokensPerTwoMin > 0) {
      const resolve = this.queue.shift();
      this.tokensPerSecond--;
      this.tokensPerTwoMin--;
      resolve();

      // Process next request after a small delay
      setTimeout(() => this.processQueue(), 50);
    } else {
      // Wait for the shorter refill time
      const waitTime = Math.min(
        this.getTimeUntilNextRefill(1000, this.lastRefillTimeSecond),
        this.getTimeUntilNextRefill(120000, this.lastRefillTimeTwoMin)
      );
      
      setTimeout(() => this.processQueue(), waitTime);
    }
  }

  refillTokens() {
    const now = Date.now();
    
    // Refill 1-second bucket
    const elapsedSecond = now - this.lastRefillTimeSecond;
    if (elapsedSecond >= 1000) {
      this.tokensPerSecond = this.limitPerSecond;
      this.lastRefillTimeSecond = now;
    }

    // Refill 2-minute bucket
    const elapsedTwoMin = now - this.lastRefillTimeTwoMin;
    if (elapsedTwoMin >= 120000) {
      this.tokensPerTwoMin = this.limitPerTwoMin;
      this.lastRefillTimeTwoMin = now;
    }
  }

  getTimeUntilNextRefill(interval, lastRefill) {
    const now = Date.now();
    const timeSinceLastRefill = now - lastRefill;
    return Math.max(0, interval - timeSinceLastRefill);
  }
}