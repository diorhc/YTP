/**
 * Storage Helper Module
 * Provides safe localStorage wrapper with validation
 */

/**
 * Validate storage key format
 * @param {string} key - Key to validate
 * @returns {boolean} True if valid
 */
const isValidKey = key => {
  if (typeof key !== 'string' || !key) return false;
  // Alphanumeric, -, _, .
  return /^[a-zA-Z0-9_.-]+$/.test(key);
};

/**
 * Safe localStorage wrapper with enhanced validation
 */
const storage = {
  /**
   * Get item from localStorage with JSON parsing
   * @param {string} key - Storage key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @returns {*} Parsed value or default
   */
  get: (key, defaultValue = null) => {
    try {
      if (!isValidKey(key)) {
        console.warn(`[YouTube+][Storage] Invalid storage key: ${key}`);
        return defaultValue;
      }

      const value = localStorage.getItem(key);
      if (value === null) return defaultValue;

      // Validate JSON size before parsing (5MB limit)
      if (value.length > 5242880) {
        console.warn(`[YouTube+][Storage] Value exceeds 5MB limit for key: ${key}`);
        return defaultValue;
      }

      return JSON.parse(value);
    } catch (e) {
      console.error(`[YouTube+][Storage] Failed to get item: ${key}`, e);
      return defaultValue;
    }
  },

  /**
   * Set item to localStorage with JSON serialization and validation
   * @param {string} key - Storage key
   * @param {*} value - Value to store
   * @returns {boolean} Success status
   */
  set: (key, value) => {
    try {
      if (!isValidKey(key)) {
        console.warn(`[YouTube+][Storage] Invalid storage key: ${key}`);
        return false;
      }

      // Serialize and validate size (5MB limit)
      const serialized = JSON.stringify(value);
      if (serialized.length > 5242880) {
        console.warn(`[YouTube+][Storage] Serialized value exceeds 5MB limit for key: ${key}`);
        return false;
      }

      localStorage.setItem(key, serialized);
      return true;
    } catch (e) {
      console.error(`[YouTube+][Storage] Failed to set item: ${key}`, e);
      return false;
    }
  },

  /**
   * Remove item from localStorage
   * @param {string} key - Storage key
   * @returns {boolean} Success status
   */
  remove: key => {
    try {
      if (!isValidKey(key)) {
        console.warn(`[YouTube+][Storage] Invalid storage key: ${key}`);
        return false;
      }
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.error(`[YouTube+][Storage] Failed to remove item: ${key}`, e);
      return false;
    }
  },

  /**
   * Clear all localStorage items
   * @returns {boolean} Success status
   */
  clear: () => {
    try {
      localStorage.clear();
      return true;
    } catch (e) {
      console.error('[YouTube+][Storage] Failed to clear storage', e);
      return false;
    }
  },

  /**
   * Check if key exists
   * @param {string} key - Storage key
   * @returns {boolean} True if exists
   */
  has: key => {
    try {
      if (!isValidKey(key)) return false;
      return localStorage.getItem(key) !== null;
    } catch (e) {
      console.error(`[YouTube+][Storage] Failed to check key: ${key}`, e);
      return false;
    }
  },
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.YouTubePlusStorage = storage;
}
