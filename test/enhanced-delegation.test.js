/**
 * @jest-environment jsdom
 *
 * Tests exercise the real event-delegation.js service on
 * window.YouTubePlusEventDelegation. Earlier versions of this file only tested
 * locally wired addEventListener snippets; now every assertion uses the real
 * delegator surface.
 */

// Ensure the real event-delegation.js module is loaded in the jsdom environment.
// Required inside beforeEach so the facade re-inits after the global
// afterEach in test/setup.js wipes window.YouTubePlus* keys.
describe('Enhanced Module - Event Delegation (real)', () => {
  beforeEach(() => {
    jest.resetModules();
    require('../src/event-delegation.js');
    document.body.innerHTML = '';
    localStorage.clear();
    jest.spyOn(console, 'error').mockImplementation(() => {
      /* mock */
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {
      /* mock */
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Play All Button Delegation', () => {
    test('real delegator invokes handler for play all buttons on mobile', () => {
      const parent = document.createElement('div');
      parent.id = 'test-parent';
      document.body.appendChild(parent);

      const btn = document.createElement('a');
      btn.className = 'yp-btn';
      btn.href = '/playlist?list=test';
      parent.appendChild(btn);

      const mockNavigate = jest.fn();
      window.YouTubePlusEventDelegation.on(
        parent,
        'click',
        '.yp-btn',
        /** @param {MouseEvent} event */ event => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const button = target.closest('.yp-btn');
          if (button instanceof HTMLAnchorElement && button.href) {
            event.preventDefault();
            mockNavigate(button.href);
          }
        }
      );

      btn.click();

      expect(mockNavigate).toHaveBeenCalled();
      expect(mockNavigate.mock.calls[0][0]).toContain('playlist?list=test');
    });

    test('real delegator invokes handler for desktop buttons', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const btn = document.createElement('a');
      btn.className = 'yp-play-all-btn';
      btn.href = '/playlist?list=testlist';
      parent.appendChild(btn);

      const mockNavigate = jest.fn();
      window.YouTubePlusEventDelegation.on(
        parent,
        'click',
        '.yp-play-all-btn:not(.yp-unsupported)',
        /** @param {MouseEvent} event */ event => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const button = target.closest('.yp-play-all-btn:not(.yp-unsupported)');
          if (button instanceof HTMLAnchorElement && button.href) {
            event.preventDefault();
            event.stopPropagation();
            mockNavigate(button.href);
          }
        }
      );

      btn.click();

      expect(mockNavigate).toHaveBeenCalled();
      expect(mockNavigate.mock.calls[0][0]).toContain('playlist?list=testlist');
    });

    test('real delegator does not trigger on unsupported buttons', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const btn = document.createElement('a');
      btn.className = 'yp-play-all-btn yp-unsupported';
      btn.href = 'https://github.com/issue/39';
      parent.appendChild(btn);

      const mockNavigate = jest.fn();
      window.YouTubePlusEventDelegation.on(
        parent,
        'click',
        '.yp-play-all-btn:not(.yp-unsupported)',
        /** @param {MouseEvent} event */ event => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const button = target.closest('.yp-play-all-btn:not(.yp-unsupported)');
          if (button instanceof HTMLAnchorElement && button.href) {
            event.preventDefault();
            mockNavigate(button.href);
          }
        }
      );

      btn.click();

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Random Play Button Delegation', () => {
    test('real delegator handles random popover link clicks', () => {
      const popover = document.createElement('div');
      popover.className = 'yp-random-popover';
      document.body.appendChild(popover);

      const link = document.createElement('a');
      link.href = '/playlist?list=test&ytp-random=prefer-newest';
      link.textContent = 'Prefer newest';
      popover.appendChild(link);

      const mockNavigate = jest.fn();
      window.YouTubePlusEventDelegation.on(
        popover,
        'click',
        'a',
        /** @param {MouseEvent} event */ event => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const a = target.closest('a');
          if (a instanceof HTMLAnchorElement && a.href) {
            event.preventDefault();
            event.stopPropagation();
            mockNavigate(a.href);
          }
        }
      );

      link.click();

      expect(mockNavigate).toHaveBeenCalled();
      expect(mockNavigate.mock.calls[0][0]).toContain('playlist?list=test');
      expect(mockNavigate.mock.calls[0][0]).toContain('ytp-random=prefer-newest');
    });

    test('real delegator can be removed with off', () => {
      const popover = document.createElement('div');
      popover.className = 'yp-random-popover';
      document.body.appendChild(popover);

      const link = document.createElement('a');
      link.href = '/playlist?list=test';
      popover.appendChild(link);

      const mockNavigate = jest.fn();
      const handler = /** @param {MouseEvent} event */ event => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const a = target.closest('a');
        if (a instanceof HTMLAnchorElement && a.href) {
          event.preventDefault();
          mockNavigate(a.href);
        }
      };

      window.YouTubePlusEventDelegation.on(popover, 'click', 'a', handler);
      window.YouTubePlusEventDelegation.off(popover, 'click', 'a', handler);

      link.click();

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Random Video Link Delegation', () => {
    test('real delegator marks and delegates video links with random play', () => {
      const container = document.createElement('div');
      container.id = 'playlist-container';
      document.body.appendChild(container);

      const link = document.createElement('a');
      link.href = '/watch?v=testVideoId&list=testList';
      link.setAttribute('data-yp-random-link', 'true');
      container.appendChild(link);

      const mockNavigate = jest.fn();
      window.YouTubePlusEventDelegation.on(
        container,
        'click',
        'a[data-yp-random-link]',
        /** @param {MouseEvent} event */ event => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const a = target.closest('a[data-yp-random-link]');
          if (a instanceof HTMLAnchorElement && a.href) {
            event.preventDefault();
            mockNavigate(a.href);
          }
        }
      );

      link.click();

      expect(mockNavigate).toHaveBeenCalled();
      expect(mockNavigate.mock.calls[0][0]).toContain('watch?v=testVideoId');
      expect(mockNavigate.mock.calls[0][0]).toContain('list=testList');
    });

    test('real delegator only processes links with data-yp-random-link attribute', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const randomLink = document.createElement('a');
      randomLink.setAttribute('data-yp-random-link', 'true');
      randomLink.href = '/watch?v=random';
      container.appendChild(randomLink);

      const normalLink = document.createElement('a');
      normalLink.href = '/watch?v=normal';
      container.appendChild(normalLink);

      const mockNavigate = jest.fn();
      window.YouTubePlusEventDelegation.on(
        container,
        'click',
        'a[data-yp-random-link]',
        /** @param {MouseEvent} event */ event => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const a = target.closest('a[data-yp-random-link]');
          if (a instanceof HTMLAnchorElement && a.href) {
            event.preventDefault();
            mockNavigate(a.href);
          }
        }
      );

      normalLink.click();
      expect(mockNavigate).not.toHaveBeenCalled();

      randomLink.click();
      expect(mockNavigate).toHaveBeenCalled();
      expect(mockNavigate.mock.calls[0][0]).toContain('watch?v=random');
    });
  });

  describe('Event Delegation Best Practices', () => {
    test('real delegator supports multiple handlers for the same selector', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const button = document.createElement('button');
      button.className = 'target-button';
      parent.appendChild(button);

      const first = jest.fn();
      const second = jest.fn();

      window.YouTubePlusEventDelegation.on(parent, 'click', '.target-button', first);
      window.YouTubePlusEventDelegation.on(parent, 'click', '.target-button', second);

      button.click();

      expect(first).toHaveBeenCalled();
      expect(second).toHaveBeenCalled();
    });

    test('real delegator uses closest() for event target matching', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const button = document.createElement('button');
      button.className = 'target-button';
      container.appendChild(button);

      const span = document.createElement('span');
      span.textContent = 'Click me';
      button.appendChild(span);

      /** @type {Element | null} */
      let clickedElement = null;
      window.YouTubePlusEventDelegation.on(
        container,
        'click',
        '.target-button',
        /** @param {MouseEvent} event */ event => {
          const eventTarget = event.target;
          if (!(eventTarget instanceof Element)) return;
          const target = eventTarget.closest('.target-button');
          if (target) {
            clickedElement = target;
          }
        }
      );

      // Click on span inside button
      span.click();

      expect(clickedElement).toBe(button);
      expect(button.className).toBe('target-button');
    });
  });
});
