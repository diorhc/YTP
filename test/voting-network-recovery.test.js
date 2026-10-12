/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const cleanupManagerSource = fs.readFileSync(
  path.join(__dirname, '../src/cleanup-manager.js'),
  'utf8'
);
const utilsSource = fs.readFileSync(path.join(__dirname, '../src/utils.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../src/voting.js'), 'utf8');
let dom, win, api;
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://www.youtube.com/',
    runScripts: 'outside-only',
  });
  win = dom.window;
  Object.defineProperty(win, 'crypto', { value: webcrypto });
  win.TextEncoder = TextEncoder;
  win.Headers = class extends Map {
    constructor(init) {
      super(
        init && typeof init[Symbol.iterator] === 'function' ? init : Object.entries(init || {})
      );
    }
  };
  const storage = new Map();
  win.eval(cleanupManagerSource);
  win.eval(utilsSource);
  win.YouTubePlus = {};
  win.YouTubePlusConfig = { communityWritesEnabled: true };
  win.YouTubePlusSettingsStore = {
    readRaw: key => storage.get(key),
    writeRaw: (key, value) => storage.set(key, value),
  };
  win.eval(source);
  api = win.YouTubePlusVoting.VotingApi;
  // The voting transport prefers GM_xmlhttpRequest; emulate the
  // manager by delegating GM requests to the per-test win.fetch mock.
  win.GM_xmlhttpRequest = options => {
    const { method = 'GET', url, headers = {}, data, onload, onerror, onabort, signal } = options;
    let settled = false;
    win
      .fetch(url, { method, headers, body: data, signal })
      .then(async res => {
        if (settled) return;
        settled = true;
        let text = '';
        try {
          if (typeof res.json === 'function') text = JSON.stringify(await res.json());
          else if (typeof res.text === 'function') text = await res.text();
        } catch (_e) {
          text = '';
        }
        onload?.({ status: res.status, response: text, responseText: text });
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        onerror?.();
      });
    return { abort: () => onabort?.() };
  };
});
afterEach(() => dom.window.close());

test('community writes never contact the actor registration endpoint', async () => {
  const urls = [];
  win.fetch = async url => {
    const target = String(url);
    urls.push(target);
    if (target.includes('rpc/cast_vote')) return response({ action: 'added' });
    if (target.includes('rpc/submit_feature')) return response({ id: 'f-1' });
    if (target.includes('rpc/submit_comment')) {
      return response({
        id: 'c-1',
        featureId: 'feature',
        comment: 'Comment',
        createdAt: '2026-01-01T00:00:00Z',
      });
    }
    return response({});
  };
  expect((await api.castVote('feature', 1)).success).toBe(true);
  expect((await api.submitFeature('Title', 'Description')).success).toBe(true);
  expect((await api.submitComment('feature', 'Comment')).success).toBe(true);
  expect(urls.some(u => u.includes('rpc/cast_vote'))).toBe(true);
  expect(urls.some(u => u.includes('rpc/submit_feature'))).toBe(true);
  expect(urls.some(u => u.includes('rpc/submit_comment'))).toBe(true);
  expect(urls.every(u => !u.includes('ytplus-actor-register'))).toBe(true);
});

test('bare array cannot silently become an empty valid page', async () => {
  win.fetch = async () => response([{ id: 'existing-feature' }]);
  expect((await api.getFeatureRequests()).error).toBe('Malformed list response');
});

test('unparseable aggregate cannot silently become zero votes', async () => {
  win.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('bad JSON');
    },
  });
  expect((await api.getVoteCounts(['feature'])).error).toBe('Malformed JSON response');
});

test('voting init at document-start waits for <body> instead of throwing', () => {
  const early = new JSDOM('<!doctype html><html><head></head></html>', {
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    runScripts: 'outside-only',
  });
  const w = early.window;
  w.document.documentElement.removeChild(w.document.body);
  Object.defineProperty(w, 'crypto', { value: webcrypto });
  w.TextEncoder = TextEncoder;
  const storage = new Map();
  w.YouTubePlus = {};
  w.YouTubePlusConfig = { communityWritesEnabled: true };
  w.YouTubePlusSettingsStore = {
    readRaw: key => storage.get(key),
    writeRaw: (key, value) => storage.set(key, value),
  };
  let onStart = null;
  w.YouTubePlusFeatureRegistry = {
    FeatureLifecycle: {
      define: def => {
        onStart = def.start;
        return { sync: jest.fn(), isRunning: () => true, restart: jest.fn() };
      },
      isRunning: () => true,
      list: () => [],
      _reset: jest.fn(),
      createContext: jest.fn(),
    },
  };
  w.YouTubeUtils = {
    onSectionActive: jest.fn(),
    logSuppressed: jest.fn(),
  };
  w.eval(source);
  expect(w.document.body).toBeNull();
  expect(() => onStart()).not.toThrow();

  w.document.documentElement.appendChild(w.document.createElement('body'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  expect(w.document.getElementById('yp-comments-panel')).not.toBeNull();
  early.window.close();
});
