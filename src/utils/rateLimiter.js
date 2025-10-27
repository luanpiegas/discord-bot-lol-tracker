export class RateLimiter {
  constructor(perSecondLimit, perTwoMinutesLimit) {
    // Initialize separate token buckets for 1s and 2m limits
    this.bucket1s = {
      tokens: perSecondLimit,
      lastRefill: Date.now(),
      limit: perSecondLimit,
      interval: 1000 // 1 second in ms
    };

    this.bucket2m = {
      tokens: perTwoMinutesLimit,
      lastRefill: Date.now(),
      limit: perTwoMinutesLimit,
      interval: 120000 // 2 minutes in ms
    };
  }

  refillBucket(bucket) {
    const now = Date.now();
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(timePassed / bucket.interval) * bucket.limit;

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(bucket.limit, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now - (timePassed % bucket.interval);
    }
  }

  async waitForToken() {
    const checkAndWait = async () => {
      this.refillBucket(this.bucket1s);
      this.refillBucket(this.bucket2m);

      if (this.bucket1s.tokens > 0 && this.bucket2m.tokens > 0) {
        this.bucket1s.tokens--;
        this.bucket2m.tokens--;
        return;
      }

      // Calculate minimum wait time based on both buckets
      const wait1s = this.bucket1s.tokens <= 0
        ? this.bucket1s.interval - (Date.now() - this.bucket1s.lastRefill)
        : 0;
      
      const wait2m = this.bucket2m.tokens <= 0
        ? this.bucket2m.interval - (Date.now() - this.bucket2m.lastRefill)
        : 0;

      const waitTime = Math.max(wait1s, wait2m);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return checkAndWait(); // Try again after waiting
    };

    return checkAndWait();
  }
}