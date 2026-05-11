/**
 * Unit tests for YouTube+ Module Registry
 */

describe('YouTubePlusRegistry', () => {
  /**
   * @typedef {{
   *  register: (name: string | null, mod: unknown) => void,
   *  get: (name: string) => unknown,
   *  has: (name: string) => boolean,
   *  list: () => string[],
   *  onReady: (name: string, cb: (mod: unknown) => void) => void,
   *  unregister: (name: string) => void,
   *  getStats: () => { totalModules: number, moduleNames: string[] },
   *  clear: () => void
   * }} RegistryApi
   */

  /** @type {RegistryApi | null} */
  let registry = null;

  beforeEach(() => {
    Object.defineProperty(window, 'YouTubePlusRegistry', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    // Reset module cache so the IIFE re-executes
    jest.resetModules();

    require('../src/module-registry');
    registry = /** @type {RegistryApi | null} */ (window.YouTubePlusRegistry || null);
  });

  afterEach(() => {
    if (registry) registry.clear();
  });

  test('should be exported to window.YouTubePlusRegistry', () => {
    expect(registry).toBeDefined();
    if (!registry) throw new Error('registry not initialized');
    expect(typeof registry.register).toBe('function');
    expect(typeof registry.get).toBe('function');
    expect(typeof registry.has).toBe('function');
  });

  test('should register and retrieve modules', () => {
    if (!registry) throw new Error('registry not initialized');
    const myModule = { hello: 'world' };
    registry.register('test', myModule);
    expect(registry.get('test')).toBe(myModule);
  });

  test('should check if module exists', () => {
    if (!registry) throw new Error('registry not initialized');
    expect(registry.has('nonexistent')).toBe(false);
    registry.register('exists', {});
    expect(registry.has('exists')).toBe(true);
  });

  test('should list registered modules', () => {
    if (!registry) throw new Error('registry not initialized');
    registry.register('mod1', {});
    registry.register('mod2', {});
    const list = registry.list();
    expect(list).toContain('mod1');
    expect(list).toContain('mod2');
  });

  test('should handle onReady for already registered module', () => {
    if (!registry) throw new Error('registry not initialized');
    const handler = jest.fn();
    const mod = { data: 42 };
    registry.register('ready', mod);
    registry.onReady('ready', handler);
    expect(handler).toHaveBeenCalledWith(mod);
  });

  test('should handle onReady for future module', () => {
    if (!registry) throw new Error('registry not initialized');
    const handler = jest.fn();
    registry.onReady('future', handler);
    expect(handler).not.toHaveBeenCalled();
    const mod = { data: 'hello' };
    registry.register('future', mod);
    expect(handler).toHaveBeenCalledWith(mod);
  });

  test('should unregister modules', () => {
    if (!registry) throw new Error('registry not initialized');
    registry.register('temp', { value: 1 });
    expect(registry.has('temp')).toBe(true);
    registry.unregister('temp');
    expect(registry.has('temp')).toBe(false);
  });

  test('should provide stats', () => {
    if (!registry) throw new Error('registry not initialized');
    registry.register('a', {});
    registry.register('b', {});
    const stats = registry.getStats();
    expect(stats.totalModules).toBe(2);
    expect(stats.moduleNames).toContain('a');
    expect(stats.moduleNames).toContain('b');
  });

  test('should clear all modules', () => {
    if (!registry) throw new Error('registry not initialized');
    registry.register('x', {});
    registry.register('y', {});
    registry.clear();
    expect(registry.list()).toHaveLength(0);
    expect(registry.getStats().totalModules).toBe(0);
  });

  test('should warn on invalid module name', () => {
    if (!registry) throw new Error('registry not initialized');
    registry.register('', {});
    registry.register(null, {});
    expect(registry.list()).toHaveLength(0);
  });

  test('should set backward-compatible window globals for known aliases', () => {
    if (!registry) throw new Error('registry not initialized');
    const loggerMod = { log: jest.fn() };
    registry.register('logger', loggerMod);
    expect(window.YouTubePlusLogger).toBe(loggerMod);
  });
});
