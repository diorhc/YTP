/**
 * Settings management utilities for YouTube+ userscript
 * Provides centralized settings loading, saving, and validation
 * @module settings-utils
 * @version 1.0.0
 */

(function () {
  'use strict';

  /**
   * Settings schema validator
   * @typedef {Object} SettingSchema
   * @property {string} type - Data type: 'boolean', 'string', 'number', 'object', 'array'
   * @property {*} [default] - Default value
   * @property {Function} [validator] - Custom validation function
   * @property {*} [min] - Minimum value (for numbers)
   * @property {*} [max] - Maximum value (for numbers)
   * @property {Array} [enum] - Allowed values
   */

  /**
   * Load settings from localStorage with schema validation
   * @param {string} storageKey - LocalStorage key
   * @param {Object<string, SettingSchema>} schema - Settings schema
   * @param {Object} [defaults={}] - Default settings object
   * @returns {Object} Validated settings object
   */
  const loadSettings = (storageKey, schema, defaults = {}) => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) {
        return { ...defaults };
      }

      const parsed = JSON.parse(saved);
      if (typeof parsed !== 'object' || parsed === null) {
        console.warn('[SettingsUtils] Invalid settings format, using defaults');
        return { ...defaults };
      }

      // Validate and merge with defaults
      const validated = { ...defaults };

      for (const [key, fieldSchema] of Object.entries(schema)) {
        if (!(key in parsed)) {
          // Use default if not in saved settings
          continue;
        }

        const value = parsed[key];
        const validatedValue = validateField(value, fieldSchema, defaults[key]);

        if (validatedValue !== undefined) {
          validated[key] = validatedValue;
        }
      }

      return validated;
    } catch (error) {
      console.error('[SettingsUtils] Error loading settings:', error);
      return { ...defaults };
    }
  };

  /**
   * Validate type match
   * @param {*} value - Value to check
   * @param {string} expectedType - Expected type
   * @returns {boolean} True if type matches
   * @private
   */
  const isValidType = (value, expectedType) => {
    if (!expectedType) return true;
    const valueType = Array.isArray(value) ? 'array' : typeof value;
    return valueType === expectedType;
  };

  /**
   * Validate number constraints
   * @param {number} value - Number to validate
   * @param {Object} schema - Schema with min/max
   * @returns {boolean} True if valid
   * @private
   */
  const isValidNumber = (value, schema) => {
    if (typeof schema.min === 'number' && value < schema.min) return false;
    if (typeof schema.max === 'number' && value > schema.max) return false;
    return true;
  };

  /**
   * Validate string constraints
   * @param {string} value - String to validate
   * @param {Object} schema - Schema with minLength/maxLength
   * @returns {boolean} True if valid
   * @private
   */
  const isValidString = (value, schema) => {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
    return true;
  };

  /**
   * Validate enum membership
   * @param {*} value - Value to check
   * @param {Array} enumValues - Allowed values
   * @returns {boolean} True if value is in enum
   * @private
   */
  const isValidEnum = (value, enumValues) => {
    if (!enumValues || !Array.isArray(enumValues)) return true;
    return enumValues.includes(value);
  };

  /**
   * Validate a single field against schema
   * @param {*} value - Value to validate
   * @param {SettingSchema} schema - Field schema
   * @param {*} defaultValue - Default value to return on validation failure
   * @returns {*} Validated value or undefined if invalid
   */
  const validateField = (value, schema, defaultValue) => {
    // Type validation
    if (!isValidType(value, schema.type)) {
      return defaultValue;
    }

    // Custom validator
    if (schema.validator && typeof schema.validator === 'function') {
      if (!schema.validator(value)) {
        return defaultValue;
      }
    }

    // Type-specific validation
    if (schema.type === 'number' && !isValidNumber(value, schema)) {
      return defaultValue;
    }

    if (schema.type === 'string' && !isValidString(value, schema)) {
      return defaultValue;
    }

    // Enum validation
    if (!isValidEnum(value, schema.enum)) {
      return defaultValue;
    }

    return value;
  };

  /**
   * Validate all settings against schema
   * @param {Object} settings - Settings object
   * @param {Object<string, SettingSchema>} schema - Schema
   * @returns {Object} Validated settings
   * @private
   */
  const validateSettingsAgainstSchema = (settings, schema) => {
    const validated = {};

    for (const [key, value] of Object.entries(settings)) {
      if (!schema[key]) {
        validated[key] = value;
        continue;
      }

      const validatedValue = validateField(value, schema[key], value);
      if (validatedValue === undefined) {
        console.warn(`[SettingsUtils] Invalid value for ${key}, skipping`);
      } else {
        validated[key] = validatedValue;
      }
    }

    return validated;
  };

  /**
   * Save settings to localStorage with error handling
   * @param {string} storageKey - LocalStorage key
   * @param {Object} settings - Settings object to save
   * @param {Object<string, SettingSchema>} [schema] - Optional schema for validation before save
   * @returns {boolean} True if save succeeded
   */
  const saveSettings = (storageKey, settings, schema = null) => {
    try {
      if (typeof settings !== 'object' || settings === null) {
        throw new Error('Settings must be an object');
      }

      // Validate before saving if schema provided
      if (schema) {
        const validatedSettings = validateSettingsAgainstSchema(settings, schema);
        Object.assign(settings, validatedSettings);
      }

      localStorage.setItem(storageKey, JSON.stringify(settings));
      return true;
    } catch (error) {
      console.error('[SettingsUtils] Error saving settings:', error);
      return false;
    }
  };

  /**
   * Update specific setting and save
   * @param {string} storageKey - LocalStorage key
   * @param {string} key - Setting key to update
   * @param {*} value - New value
   * @param {Object<string, SettingSchema>} [schema] - Optional schema for validation
   * @returns {boolean} True if update succeeded
   */
  const updateSetting = (storageKey, key, value, schema = null) => {
    try {
      const settings = loadSettings(storageKey, schema || {});

      // Validate if schema provided
      if (schema && schema[key]) {
        const validated = validateField(value, schema[key], settings[key]);
        if (validated === undefined) {
          console.warn(`[SettingsUtils] Invalid value for ${key}`);
          return false;
        }
        settings[key] = validated;
      } else {
        settings[key] = value;
      }

      return saveSettings(storageKey, settings, schema);
    } catch (error) {
      console.error('[SettingsUtils] Error updating setting:', error);
      return false;
    }
  };

  /**
   * Get specific setting value
   * @param {string} storageKey - LocalStorage key
   * @param {string} key - Setting key to get
   * @param {*} [defaultValue] - Default value if not found
   * @returns {*} Setting value or default
   */
  const getSetting = (storageKey, key, defaultValue = null) => {
    try {
      const settings = loadSettings(storageKey, {});
      return key in settings ? settings[key] : defaultValue;
    } catch (error) {
      console.error('[SettingsUtils] Error getting setting:', error);
      return defaultValue;
    }
  };

  /**
   * Delete specific setting
   * @param {string} storageKey - LocalStorage key
   * @param {string} key - Setting key to delete
   * @returns {boolean} True if delete succeeded
   */
  const deleteSetting = (storageKey, key) => {
    try {
      const settings = loadSettings(storageKey, {});
      delete settings[key];
      return saveSettings(storageKey, settings);
    } catch (error) {
      console.error('[SettingsUtils] Error deleting setting:', error);
      return false;
    }
  };

  /**
   * Reset settings to defaults
   * @param {string} storageKey - LocalStorage key
   * @param {Object} defaults - Default settings object
   * @returns {boolean} True if reset succeeded
   */
  const resetSettings = (storageKey, defaults = {}) => {
    try {
      return saveSettings(storageKey, defaults);
    } catch (error) {
      console.error('[SettingsUtils] Error resetting settings:', error);
      return false;
    }
  };

  /**
   * Check if settings exist in localStorage
   * @param {string} storageKey - LocalStorage key
   * @returns {boolean} True if settings exist
   */
  const hasSettings = storageKey => {
    try {
      return localStorage.getItem(storageKey) !== null;
    } catch {
      return false;
    }
  };

  /**
   * Migrate settings from old key to new key
   * @param {string} oldKey - Old storage key
   * @param {string} newKey - New storage key
   * @param {Function} [transformer] - Optional function to transform settings
   * @returns {boolean} True if migration succeeded
   */
  const migrateSettings = (oldKey, newKey, transformer = null) => {
    try {
      const oldSettings = localStorage.getItem(oldKey);
      if (!oldSettings) {
        return false;
      }

      let settings = JSON.parse(oldSettings);

      // Apply transformer if provided
      if (transformer && typeof transformer === 'function') {
        settings = transformer(settings);
      }

      localStorage.setItem(newKey, JSON.stringify(settings));
      localStorage.removeItem(oldKey);

      return true;
    } catch (error) {
      console.error('[SettingsUtils] Error migrating settings:', error);
      return false;
    }
  };

  /**
   * Export settings as JSON string
   * @param {string} storageKey - LocalStorage key
   * @param {boolean} [pretty=false] - Format with indentation
   * @returns {string|null} JSON string or null on error
   */
  const exportSettings = (storageKey, pretty = false) => {
    try {
      const settings = loadSettings(storageKey, {});
      return JSON.stringify(settings, null, pretty ? 2 : 0);
    } catch (error) {
      console.error('[SettingsUtils] Error exporting settings:', error);
      return null;
    }
  };

  /**
   * Import settings from JSON string
   * @param {string} storageKey - LocalStorage key
   * @param {string} jsonString - JSON string to import
   * @param {Object<string, SettingSchema>} [schema] - Optional schema for validation
   * @returns {boolean} True if import succeeded
   */
  const importSettings = (storageKey, jsonString, schema = null) => {
    try {
      const settings = JSON.parse(jsonString);

      if (typeof settings !== 'object' || settings === null) {
        throw new Error('Invalid settings format');
      }

      return saveSettings(storageKey, settings, schema);
    } catch (error) {
      console.error('[SettingsUtils] Error importing settings:', error);
      return false;
    }
  };

  /**
   * Watch for changes to settings (polls localStorage)
   * @param {string} storageKey - LocalStorage key
   * @param {Function} callback - Callback function (newSettings, oldSettings)
   * @param {number} [interval=1000] - Polling interval in ms
   * @returns {Function} Cleanup function to stop watching
   */
  const watchSettings = (storageKey, callback, interval = 1000) => {
    let lastValue = localStorage.getItem(storageKey);
    let stopped = false;

    const poll = () => {
      if (stopped) return;

      const currentValue = localStorage.getItem(storageKey);

      if (currentValue !== lastValue) {
        try {
          const oldSettings = lastValue ? JSON.parse(lastValue) : {};
          const newSettings = currentValue ? JSON.parse(currentValue) : {};
          callback(newSettings, oldSettings);
          lastValue = currentValue;
        } catch (error) {
          console.error('[SettingsUtils] Error in settings watcher:', error);
        }
      }

      setTimeout(poll, interval);
    };

    poll();

    // Return cleanup function
    return () => {
      stopped = true;
    };
  };

  /**
   * Create settings schema builder for common patterns
   * @returns {Object} Schema builder methods
   */
  const createSchemaBuilder = () => {
    return {
      boolean: (defaultValue = false) => ({
        type: 'boolean',
        default: defaultValue,
      }),
      string: (defaultValue = '', options = {}) => ({
        type: 'string',
        default: defaultValue,
        ...options,
      }),
      number: (defaultValue = 0, options = {}) => ({
        type: 'number',
        default: defaultValue,
        ...options,
      }),
      enum: (allowedValues, defaultValue) => ({
        type: typeof defaultValue,
        enum: allowedValues,
        default: defaultValue,
      }),
      object: (defaultValue = {}) => ({
        type: 'object',
        default: defaultValue,
      }),
      array: (defaultValue = []) => ({
        type: 'array',
        default: defaultValue,
      }),
    };
  };

  // Export utilities
  const SettingsUtils = {
    loadSettings,
    saveSettings,
    validateField,
    updateSetting,
    getSetting,
    deleteSetting,
    resetSettings,
    hasSettings,
    migrateSettings,
    exportSettings,
    importSettings,
    watchSettings,
    createSchemaBuilder,
  };

  // Make available globally
  if (typeof window !== 'undefined') {
    window.YouTubePlusSettingsUtils = SettingsUtils;
  }

  // Support module exports
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SettingsUtils;
  }
})();
