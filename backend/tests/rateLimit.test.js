const { checkRateLimit } = require('../src/models/rateLimit');

describe('Rate Limiting', () => {
  describe('checkRateLimit function', () => {
    it('should allow first request', () => {
      const result = checkRateLimit('test-key', 10, 60);
      expect(result).toBe(true);
    });

    it('should allow requests within limit', () => {
      checkRateLimit('test-key', 10, 60);
      checkRateLimit('test-key', 10, 60);
      checkRateLimit('test-key', 10, 60);
      const result = checkRateLimit('test-key', 10, 60);
      expect(result).toBe(true);
    });

    it('should block requests exceeding limit', () => {
      for (let i = 0; i < 10; i++) {
        checkRateLimit('limit-test-key', 10, 60);
      }
      const result = checkRateLimit('limit-test-key', 10, 60);
      expect(result).toBe(false);
    });

    it('should track different keys separately', () => {
      for (let i = 0; i < 10; i++) {
        checkRateLimit('key-a', 10, 60);
      }
      const resultKeyA = checkRateLimit('key-a', 10, 60);
      const resultKeyB = checkRateLimit('key-b', 10, 60);
      
      expect(resultKeyA).toBe(false);
      expect(resultKeyB).toBe(true);
    });
  });
});
