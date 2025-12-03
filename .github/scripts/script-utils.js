/**
 * Utility functions for GitHub Actions scripts
 * Provides common error handling, logging, and helper functions
 */
'use strict';

/**
 * Wraps an async function with error handling
 * @param {Function} fn - Async function to wrap
 * @param {string} name - Name of the operation for logging
 * @returns {Function} Wrapped function
 */
function withErrorHandling(fn, name) {
  return async (...args) => {
    try {
      console.log(`🚀 Starting: ${name}`);
      const result = await fn(...args);
      console.log(`✅ Completed: ${name}`);
      return result;
    } catch (error) {
      console.error(`❌ Failed: ${name}`);
      console.error(`Error: ${error.message}`);
      if (error.stack) {
        console.error(`Stack trace:\n${error.stack}`);
      }
      throw error;
    }
  };
}

/**
 * Retry a function multiple times with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} Result of the function
 */
async function retry(fn, options = {}) {
  const { maxAttempts = 3, delay = 1000, backoff = 2, onRetry = null } = options;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const waitTime = delay * Math.pow(backoff, attempt - 1);
        if (onRetry) {
          onRetry(attempt, maxAttempts, waitTime, error);
        } else {
          console.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${waitTime}ms...`);
        }
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  throw lastError;
}

/**
 * Validate required environment variables
 * @param {string[]} vars - Array of required variable names
 * @throws {Error} If any required variable is missing
 */
function validateEnv(vars) {
  const missing = vars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Safe file read with error handling
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} File contents
 */
async function safeReadFile(filePath) {
  const fs = require('fs/promises');
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error.message}`);
  }
}

/**
 * Safe file write with error handling
 * @param {string} filePath - Path to file
 * @param {string} content - Content to write
 * @returns {Promise<void>}
 */
async function safeWriteFile(filePath, content) {
  const fs = require('fs/promises');
  try {
    await fs.writeFile(filePath, content, 'utf8');
  } catch (error) {
    throw new Error(`Failed to write file ${filePath}: ${error.message}`);
  }
}

/**
 * Check if running in GitHub Actions
 * @returns {boolean}
 */
function isGitHubActions() {
  return process.env.GITHUB_ACTIONS === 'true';
}

/**
 * Log a GitHub Actions warning
 * @param {string} message - Warning message
 */
function logWarning(message) {
  if (isGitHubActions()) {
    console.log(`::warning::${message}`);
  } else {
    console.warn(message);
  }
}

/**
 * Log a GitHub Actions error
 * @param {string} message - Error message
 */
function logError(message) {
  if (isGitHubActions()) {
    console.log(`::error::${message}`);
  } else {
    console.error(message);
  }
}

/**
 * Set a GitHub Actions output
 * @param {string} name - Output name
 * @param {string} value - Output value
 */
function setOutput(name, value) {
  if (isGitHubActions()) {
    console.log(`::set-output name=${name}::${value}`);
  } else {
    console.log(`Output: ${name}=${value}`);
  }
}

module.exports = {
  withErrorHandling,
  retry,
  validateEnv,
  safeReadFile,
  safeWriteFile,
  isGitHubActions,
  logWarning,
  logError,
  setOutput,
};
