// @ts-check
const { describe, test, expect, beforeEach } = require('@jest/globals');
require('../src/registry.js');

const reg = window.YouTubePlusRegistry;

describe('YouTubePlusRegistry', () => {
  beforeEach(() => {
    reg.clear();
  });

  describe('module registration', () => {
    test('register and get a module', () => {
      const mod = { name: 'test' };
      reg.register('myMod', mod);
      expect(reg.get('myMod')).toBe(mod);
    });

    test('has returns true for registered modules', () => {
      reg.register('exists', 42);
      expect(reg.has('exists')).toBe(true);
      expect(reg.has('nope')).toBe(false);
    });

    test('unregister removes a module', () => {
      reg.register('remove-me', true);
      reg.unregister('remove-me');
      expect(reg.has('remove-me')).toBe(false);
    });

    test('list returns all module names', () => {
      reg.register('a', 1);
      reg.register('b', 2);
      expect(reg.list()).toEqual(expect.arrayContaining(['a', 'b']));
    });

    test('getStats returns counts', () => {
      reg.register('m', 1);
      reg.set('f', 2);
      const stats = reg.getStats();
      expect(stats.modules).toBeGreaterThanOrEqual(1);
      expect(stats.flags).toBeGreaterThanOrEqual(1);
    });

    test('onReady fires immediately if module already registered', () => {
      reg.register('ready', 'yes');
      const cb = jest.fn();
      reg.onReady('ready', cb);
      expect(cb).toHaveBeenCalledWith('yes');
    });

    test('onReady fires when module is later registered', () => {
      const cb = jest.fn();
      reg.onReady('pending', cb);
      expect(cb).not.toHaveBeenCalled();
      reg.register('pending', 'done');
      expect(cb).toHaveBeenCalledWith('done');
    });

    test('clear removes everything', () => {
      reg.register('m', 1);
      reg.set('f', 2);
      reg.clear();
      expect(reg.list()).toEqual([]);
      expect(reg.all()).toEqual({});
    });
  });

  describe('flag operations', () => {
    test('set and get a flag via get()', () => {
      reg.set('foo', 'bar');
      expect(reg.get('foo')).toBe('bar');
    });

    test('has returns true for flags', () => {
      reg.set('exists', 42);
      expect(reg.has('exists')).toBe(true);
    });

    test('all() returns a plain object snapshot', () => {
      reg.set('a', 1);
      reg.set('b', 2);
      expect(reg.all()).toEqual({ a: 1, b: 2 });
    });

    test('onChange fires immediately if value already exists', () => {
      reg.set('existing', 'hello');
      const cb = jest.fn();
      reg.onChange('existing', cb);
      expect(cb).toHaveBeenCalledWith('hello');
    });

    test('onChange fires on subsequent changes', () => {
      const cb = jest.fn();
      reg.onChange('track', cb);
      expect(cb).not.toHaveBeenCalled();
      reg.set('track', 'first');
      expect(cb).toHaveBeenCalledWith('first');
      reg.set('track', 'second');
      expect(cb).toHaveBeenCalledWith('second');
    });

    test('onChange unsubscribe stops future callbacks', () => {
      const cb = jest.fn();
      const unsub = reg.onChange('unsub', cb);
      reg.set('unsub', 'v1');
      expect(cb).toHaveBeenCalledTimes(1);
      unsub();
      reg.set('unsub', 'v2');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('deleteFlag removes a flag', () => {
      reg.set('rm', 10);
      reg.deleteFlag('rm');
      expect(reg.has('rm')).toBe(false);
    });

    test('onChange callback errors do not propagate', () => {
      reg.onChange('err', () => {
        throw new Error('boom');
      });
      expect(() => reg.set('err', 'x')).not.toThrow();
    });
  });

  describe('lazyLoader', () => {
    test('register and load a module', async () => {
      const fn = jest.fn();
      reg.lazyLoader.register('lazy1', fn);
      const result = await reg.lazyLoader.load('lazy1');
      expect(result).toBe(true);
      expect(fn).toHaveBeenCalled();
    });

    test('loadAll loads all registered entries', async () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();
      reg.lazyLoader.register('l1', fn1);
      reg.lazyLoader.register('l2', fn2);
      const count = await reg.lazyLoader.loadAll();
      expect(count).toBe(2);
      expect(fn1).toHaveBeenCalled();
      expect(fn2).toHaveBeenCalled();
    });

    test('getStatus returns loaded state', async () => {
      reg.lazyLoader.register('pending1', jest.fn());
      const status = reg.lazyLoader.getStatus();
      expect(status.pending1).toBe('pending');
      await reg.lazyLoader.load('pending1');
      const statusAfter = reg.lazyLoader.getStatus();
      expect(statusAfter.pending1).toBe('loaded');
    });
  });

  test('exposed on window', () => {
    expect(window.YouTubePlusRegistry).toBe(reg);
  });
});
