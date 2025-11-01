/**
 * Cache Manager for Module 3
 * Handles localStorage caching of perspectives based on input hash
 */

interface CachedData {
  perspectives: any[];
  finalOutput: {
    leftist: any[];
    rightist: any[];
    common: any[];
  };
  timestamp: number;
  inputHash: string;
}

const CACHE_KEY_PREFIX = 'module3_cache_';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Generate hash from input data for cache key
 */
export function generateInputHash(input: { topic: string; text: string }): string {
  const str = `${input.topic}||${input.text}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Save perspectives to cache
 */
export function savePerspectivesToCache(
  inputHash: string,
  perspectives: any[],
  finalOutput: { leftist: any[]; rightist: any[]; common: any[] }
): void {
  try {
    const cacheData: CachedData = {
      perspectives,
      finalOutput,
      timestamp: Date.now(),
      inputHash
    };
    
    const cacheKey = CACHE_KEY_PREFIX + inputHash;
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    
    // Save list of cache keys for cleanup
    const cacheKeys = getCacheKeys();
    if (!cacheKeys.includes(inputHash)) {
      cacheKeys.push(inputHash);
      localStorage.setItem('module3_cache_keys', JSON.stringify(cacheKeys));
    }
    
    console.log('[Cache] Saved perspectives for hash:', inputHash);
  } catch (error) {
    console.error('[Cache] Error saving to cache:', error);
  }
}

/**
 * Load perspectives from cache
 */
export function loadPerspectivesFromCache(inputHash: string): CachedData | null {
  try {
    const cacheKey = CACHE_KEY_PREFIX + inputHash;
    const cached = localStorage.getItem(cacheKey);
    
    if (!cached) {
      console.log('[Cache] No cache found for hash:', inputHash);
      return null;
    }
    
    const cacheData: CachedData = JSON.parse(cached);
    
    // Check if cache is expired
    const age = Date.now() - cacheData.timestamp;
    if (age > CACHE_EXPIRY_MS) {
      console.log('[Cache] Cache expired for hash:', inputHash);
      clearCacheForHash(inputHash);
      return null;
    }
    
    console.log('[Cache] Loaded perspectives from cache:', inputHash);
    return cacheData;
  } catch (error) {
    console.error('[Cache] Error loading from cache:', error);
    return null;
  }
}

/**
 * Check if cache exists for input hash
 */
export function hasCacheForHash(inputHash: string): boolean {
  const cacheKey = CACHE_KEY_PREFIX + inputHash;
  return localStorage.getItem(cacheKey) !== null;
}

/**
 * Clear cache for specific hash
 */
export function clearCacheForHash(inputHash: string): void {
  try {
    const cacheKey = CACHE_KEY_PREFIX + inputHash;
    localStorage.removeItem(cacheKey);
    
    // Remove from cache keys list
    const cacheKeys = getCacheKeys();
    const newKeys = cacheKeys.filter(key => key !== inputHash);
    localStorage.setItem('module3_cache_keys', JSON.stringify(newKeys));
    
    console.log('[Cache] Cleared cache for hash:', inputHash);
  } catch (error) {
    console.error('[Cache] Error clearing cache:', error);
  }
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  try {
    const cacheKeys = getCacheKeys();
    cacheKeys.forEach(hash => {
      const cacheKey = CACHE_KEY_PREFIX + hash;
      localStorage.removeItem(cacheKey);
    });
    localStorage.removeItem('module3_cache_keys');
    console.log('[Cache] Cleared all caches');
  } catch (error) {
    console.error('[Cache] Error clearing all caches:', error);
  }
}

/**
 * Get list of cache keys
 */
function getCacheKeys(): string[] {
  try {
    const keys = localStorage.getItem('module3_cache_keys');
    return keys ? JSON.parse(keys) : [];
  } catch {
    return [];
  }
}

/**
 * Clean up expired caches
 */
export function cleanupExpiredCaches(): void {
  try {
    const cacheKeys = getCacheKeys();
    const now = Date.now();
    
    cacheKeys.forEach(hash => {
      const cacheKey = CACHE_KEY_PREFIX + hash;
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
        const cacheData: CachedData = JSON.parse(cached);
        const age = now - cacheData.timestamp;
        
        if (age > CACHE_EXPIRY_MS) {
          clearCacheForHash(hash);
        }
      }
    });
    
    console.log('[Cache] Cleanup completed');
  } catch (error) {
    console.error('[Cache] Error during cleanup:', error);
  }
}

