export type Config = import("@eslint/core").ConfigObject;
export type LegacyConfig = import("@eslint/core").LegacyConfigObject;
export type Plugin = import("@eslint/core").Plugin;
export type RuleConfig = import("@eslint/core").RuleConfig;
export type ExtendsElement = import("./types.ts").ExtendsElement;
export type SimpleExtendsElement = import("./types.ts").SimpleExtendsElement;
export type ConfigWithExtends = import("./types.ts").ConfigWithExtends;
export type InfiniteConfigArray = import("./types.ts").InfiniteArray<Config>;
export type ConfigWithExtendsArray = import("./types.ts").ConfigWithExtendsArray;
/**
 * Helper function to define a config array.
 * @param {ConfigWithExtendsArray} args The arguments to the function.
 * @returns {Config[]} The config array.
 * @throws {TypeError} If no arguments are provided or if an argument is not an object.
 */
export function defineConfig(...args: ConfigWithExtendsArray): Config[];
/**
 * Creates a global ignores config with the given patterns.
 * @param {string[]} ignorePatterns The ignore patterns.
 * @param {string} [name] The name of the global ignores config.
 * @returns {Config} The global ignores config.
 * @throws {TypeError} If ignorePatterns is not an array or if it is empty.
 */
export function globalIgnores(ignorePatterns: string[], name?: string): Config;
