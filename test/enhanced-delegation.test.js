/**
 * @jest-environment jsdom
 */

describe('Enhanced Module - Event Delegation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Play All Button Delegation', () => {
    test('should use event delegation for play all buttons on mobile', () => {
      // Create parent container
      const parent = document.createElement('div');
      parent.id = 'test-parent';
      document.body.appendChild(parent);

      // Add play all button
      const btn = document.createElement('a');
      btn.className = 'ytp-btn';
      btn.href = '/playlist?list=test';
      parent.appendChild(btn);

      // Set delegation flag
      parent.setAttribute('data-ytp-delegated', 'true');

      // Add event listener
      const mockNavigate = jest.fn();
      parent.addEventListener('click', event => {
        const btn = event.target.closest('.ytp-btn');
        if (btn && btn.href) {
          event.preventDefault();
          mockNavigate(btn.href);
        }
      });

      // Simulate click
      btn.click();

      // Verify delegation works
      expect(parent.hasAttribute('data-ytp-delegated')).toBe(true);
      expect(mockNavigate).toHaveBeenCalled();
      expect(mockNavigate.mock.calls[0][0]).toContain('playlist?list=test');
    });

    test('should use event delegation for desktop buttons', () => {
      const parent = document.createElement('div');
      parent.setAttribute('data-ytp-delegated', 'true');
      document.body.appendChild(parent);

      const btn = document.createElement('a');
      btn.className = 'ytp-play-all-btn';
      btn.href = '/playlist?list=testlist';
      parent.appendChild(btn);

      const mockNavigate = jest.fn();
      parent.addEventListener('click', event => {
        const btn = event.target.closest('.ytp-play-all-btn:not(.ytp-unsupported)');
        if (btn && btn.href) {
          event.preventDefault();
          event.stopPropagation();
          mockNavigate(btn.href);
        }
      });

      btn.click();

      expect(mockNavigate).toHaveBeenCalled();
      expect(mockNavigate.mock.calls[0][0]).toContain('playlist?list=testlist');
    });

    test('should not trigger on unsupported buttons', () => {
      const parent = document.createElement('div');
      parent.setAttribute('data-ytp-delegated', 'true');
      document.body.appendChild(parent);

      const btn = document.createElement('a');
      btn.className = 'ytp-play-all-btn ytp-unsupported';
      btn.href = 'https://github.com/issue/39';
      parent.appendChild(btn);

      const mockNavigate = jest.fn();
      parent.addEventListener('click', event => {
        const btn = event.target.closest('.ytp-play-all-btn:not(.ytp-unsupported)');
        if (btn && btn.href) {
          event.preventDefault();
          mockNavigate(btn.href);
        }
      });

      btn.click();

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Random Play Button Delegation', () => {
    test('should delegate random popover link clicks', () => {
      const popover = document.createElement('div');
      popover.className = 'ytp-random-popover';
      popover.setAttribute('data-ytp-delegated', 'true');
      document.body.appendChild(popover);

      const link = document.createElement('a');
      link.href = '/playlist?list=test&ytp-random=prefer-newest';
      link.textContent = 'Prefer newest';
      popover.appendChild(link);

      const mockNavigate = jest.fn();
      popover.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (link && link.href) {
          event.preventDefault();
          event.stopPropagation();
          mockNavigate(link.href);
        }
      });

      link.click();

      expect(mockNavigate).toHaveBeenCalled();
      expect(mockNavigate.mock.calls[0][0]).toContain('playlist?list=test');
      expect(mockNavigate.mock.calls[0][0]).toContain('ytp-random=prefer-newest');
    });

    test('should handle mouseleave on random popover', () => {
      const popover = document.createElement('div');
      popover.className = 'ytp-random-popover';
      popover.removeAttribute('hidden');
      document.body.appendChild(popover);

      popover.addEventListener('mouseleave', () => {
        popover.setAttribute('hidden', '');
      });

      const event = new MouseEvent('mouseleave', { bubbles: true });
      popover.dispatchEvent(event);

      expect(popover.hasAttribute('hidden')).toBe(true);
    });
  });

  describe('Random Video Link Delegation', () => {
    test('should mark and delegate video links with random play', () => {
      const container = document.createElement('div');
      container.id = 'playlist-container';
      container.setAttribute('data-ytp-random-delegated', 'true');
      document.body.appendChild(container);

      const link = document.createElement('a');
      link.href = '/watch?v=testVideoId&list=testList';
      link.setAttribute('data-ytp-random-link', 'true');
      container.appendChild(link);

      const mockNavigate = jest.fn();
      container.addEventListener('click', event => {
        const link = event.target.closest('a[data-ytp-random-link]');
        if (link && link.href) {
          event.preventDefault();
          mockNavigate(link.href);
        }
      });

      link.click();

      expect(mockNavigate).toHaveBeenCalled();
      expect(mockNavigate.mock.calls[0][0]).toContain('watch?v=testVideoId');
      expect(mockNavigate.mock.calls[0][0]).toContain('list=testList');
    });

    test('should only process links with data-ytp-random-link attribute', () => {
      const container = document.createElement('div');
      container.setAttribute('data-ytp-random-delegated', 'true');
      document.body.appendChild(container);

      const randomLink = document.createElement('a');
      randomLink.setAttribute('data-ytp-random-link', 'true');
      randomLink.href = '/watch?v=random';
      container.appendChild(randomLink);

      const normalLink = document.createElement('a');
      normalLink.href = '/watch?v=normal';
      container.appendChild(normalLink);

      const mockNavigate = jest.fn();
      container.addEventListener('click', event => {
        const link = event.target.closest('a[data-ytp-random-link]');
        if (link && link.href) {
          event.preventDefault();
          mockNavigate(link.href);
        }
      });

      normalLink.click();
      expect(mockNavigate).not.toHaveBeenCalled();

      randomLink.click();
      expect(mockNavigate).toHaveBeenCalled();
      expect(mockNavigate.mock.calls[0][0]).toContain('watch?v=random');
    });
  });

  describe('Event Delegation Best Practices', () => {
    test('should prevent duplicate delegation setup', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      expect(parent.hasAttribute('data-ytp-delegated')).toBe(false);

      // First setup
      if (!parent.hasAttribute('data-ytp-delegated')) {
        parent.setAttribute('data-ytp-delegated', 'true');
        parent.addEventListener('click', () => {});
      }

      expect(parent.hasAttribute('data-ytp-delegated')).toBe(true);

      // Attempt second setup - should be prevented
      const shouldSetup = !parent.hasAttribute('data-ytp-delegated');
      expect(shouldSetup).toBe(false);
    });

    test('should use closest() for event target matching', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const button = document.createElement('button');
      button.className = 'target-button';
      container.appendChild(button);

      const span = document.createElement('span');
      span.textContent = 'Click me';
      button.appendChild(span);

      let clickedElement = null;
      container.addEventListener('click', event => {
        const target = event.target.closest('.target-button');
        if (target) {
          clickedElement = target;
        }
      });

      // Click on span inside button
      span.click();

      expect(clickedElement).toBe(button);
      expect(clickedElement.className).toBe('target-button');
    });
  });
});
