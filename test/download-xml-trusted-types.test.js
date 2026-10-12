/**
 * XML subtitles under Trusted Types: the plain-string DOMParser sink throws a
 * TypeError and is caught silently (it is an expected platform rejection, not
 * an error to journal), so it must not reach U.logSuppressed / ErrorBoundary.
 * Any other parser failure still goes through the error journal. Real
 * CleanupManager, utils, safe-dom and download module.
 * @jest-environment jsdom
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/design-system.js');
  require('../src/download.js');
}

const XML = '<?xml version="1.0"?><transcript><text start="0" dur="1">hi</text></transcript>';
const request = () => ({
  videoId: 'xmltt000001',
  url: 'https://www.youtube.com/api/timedtext?v=xmltt000001&lang=en',
  languageCode: 'en',
  format: 'srt',
});

const serveXml = () => {
  globalThis.GM_xmlhttpRequest = jest.fn(options => {
    options.onload?.({ status: 200, responseText: XML });
    return { abort: jest.fn() };
  });
};

describe('XML subtitle parsing under Trusted Types', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=xmltt000001',
      href: 'https://www.youtube.com/watch?v=xmltt000001',
    });
    loadChain();
    window.YouTubeUtils.logSuppressed = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete globalThis.GM_xmlhttpRequest;
  });

  test('the expected Trusted Types rejection stays out of the ErrorBoundary', async () => {
    window.DOMParser = class {
      parseFromString() {
        throw new TypeError("This document requires 'TrustedHTML' assignments.");
      }
    };
    serveXml();

    await window.YouTubePlusDownload.downloadSubtitle(request());

    // The regex fallback still produced cues, and the TypeError was silent.
    expect(window.YouTubeUtils.logSuppressed).not.toHaveBeenCalled();
  });

  test('an unexpected parser failure is still journaled', async () => {
    window.DOMParser = class {
      parseFromString() {
        throw new Error('unexpected parser failure');
      }
    };
    serveXml();

    await window.YouTubePlusDownload.downloadSubtitle(request());

    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
  });
});
