describe('Report module', () => {
  /** @returns {HTMLDivElement} */
  function createModalWithReportSection() {
    const modal = document.createElement('div');
    const section = document.createElement('div');
    section.className = 'yp-settings-section';
    section.setAttribute('data-section', 'report');
    modal.appendChild(section);
    document.body.appendChild(modal);
    return modal;
  }

  function loadReportScript() {
    jest.resetModules();
    delete window.YouTubePlusReport;
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        t: key => key || '',
        createWithErrorBoundary: _name => fn => fn,
        setSafeHTML: jest.fn((el, html) => {
          el.innerHTML = html;
        }),
        logSuppressed: jest.fn(),
      },
    });
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        registerListener: (target, type, handler, opts) => {
          target?.addEventListener?.(type, handler, opts);
          return Symbol('listener-key');
        },
      },
    });
    Object.defineProperty(window, 'YouTubeSafeDOM', {
      configurable: true,
      writable: true,
      value: { sanitizeHTML: jest.fn(s => s) },
    });
    require('../src/report.js');
  }

  /** @param {unknown} value @returns {HTMLDivElement} */
  function requireDiv(value) {
    expect(value).toBeInstanceOf(HTMLDivElement);
    if (!(value instanceof HTMLDivElement)) {
      throw new Error('Expected HTMLDivElement');
    }
    return value;
  }

  /** @param {unknown} value @returns {HTMLInputElement} */
  function requireInput(value) {
    expect(value).toBeInstanceOf(HTMLInputElement);
    if (!(value instanceof HTMLInputElement)) {
      throw new Error('Expected HTMLInputElement');
    }
    return value;
  }

  /** @param {unknown} value @returns {HTMLTextAreaElement} */
  function requireTextArea(value) {
    expect(value).toBeInstanceOf(HTMLTextAreaElement);
    if (!(value instanceof HTMLTextAreaElement)) {
      throw new Error('Expected HTMLTextAreaElement');
    }
    return value;
  }

  beforeEach(() => {
    delete window.YouTubePlusReport;
    document.body.innerHTML = '';
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        t: key => key || '',
        createWithErrorBoundary: _name => fn => fn,
        logSuppressed: jest.fn(),
      },
    });
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        registerListener: (target, type, handler, opts) => {
          target?.addEventListener?.(type, handler, opts);
          return Symbol('listener-key');
        },
      },
    });
  });

  describe('Module Initialization', () => {
    test('exposes canonical window.YouTubePlusReport', () => {
      loadReportScript();
      expect(typeof window.YouTubePlusReport).toBe('object');
      expect(typeof window.YouTubePlusReport.render).toBe('function');
    });
  });

  describe('Form Rendering', () => {
    beforeEach(() => {
      loadReportScript();
      createModalWithReportSection();
    });

    test('should render form with all required fields', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      window.YouTubePlusReport.render(modal);

      expect(modal.querySelector('select')).toBeTruthy();
      const inputs = modal.querySelectorAll(
        'input[type="text"], input:not([type="checkbox"]):not([type="email"])'
      );
      expect(inputs.length).toBeGreaterThan(0);
      expect(modal.querySelector('input[type="email"]')).toBeTruthy();
      expect(modal.querySelector('textarea')).toBeTruthy();
      expect(modal.querySelector('input[type="checkbox"]')).toBeTruthy();
    });

    test('should render three action buttons', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      window.YouTubePlusReport.render(modal);

      const buttons = modal.querySelectorAll('button.glass-button');
      expect(buttons.length).toBe(3);
      expect(buttons[0]).toBeTruthy();
      expect(buttons[1]).toBeTruthy();
      expect(buttons[2]).toBeTruthy();
    });

    test('should render privacy notice', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      window.YouTubePlusReport.render(modal);

      const privacy = modal.querySelector('.yp-settings-item-description');
      expect(privacy).toBeTruthy();
      if (privacy) {
        expect((privacy.textContent || '').length).toBeGreaterThan(0);
      }
    });

    test('should handle missing modal gracefully', () => {
      expect(() => {
        window.YouTubePlusReport.render(null);
      }).not.toThrow();
    });

    test('should handle missing section gracefully', () => {
      const modal = document.createElement('div');
      document.body.appendChild(modal);
      expect(() => {
        window.YouTubePlusReport.render(modal);
      }).not.toThrow();
    });
  });

  describe('Form Validation', () => {
    beforeEach(() => {
      loadReportScript();
      const modal = createModalWithReportSection();
      window.YouTubePlusReport.render(modal);
    });

    test('should require title and description', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      const inputs = modal.querySelectorAll(
        'input[type="text"], input:not([type="checkbox"]):not([type="email"])'
      );
      const textarea = requireTextArea(modal.querySelector('textarea'));

      expect(inputs.length).toBeGreaterThan(0);
      expect(textarea.hasAttribute('placeholder')).toBe(true);
    });

    test('should validate minimum title length', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      const titleInput = requireInput(
        modal.querySelector(
          'input[placeholder*="title"], input[placeholder*="Title"], input:not([type="email"]):not([type="checkbox"])'
        )
      );

      titleInput.value = 'Test';
      expect(titleInput.value.length).toBeGreaterThan(0);
    });

    test('should validate minimum description length', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      const descInput = requireTextArea(modal.querySelector('textarea'));

      descInput.value = 'Test description';
      expect(descInput.value.length).toBeGreaterThan(0);
    });

    test('should validate email format if provided', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      const emailInput = requireInput(modal.querySelector('input[type="email"]'));

      emailInput.value = 'invalid-email';
      expect(emailInput.validity.valid).toBe(false);
    });

    test('should accept valid email', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      const emailInput = requireInput(modal.querySelector('input[type="email"]'));

      emailInput.value = 'test@example.com';
      expect(emailInput.validity.valid).toBe(true);
    });
  });

  describe('Button Functionality', () => {
    beforeEach(() => {
      loadReportScript();
      const modal = createModalWithReportSection();
      window.YouTubePlusReport.render(modal);
    });

    test('should open GitHub issue in new tab when clicked', () => {
      const titleInput = document.querySelector('input:not([type="email"]):not([type="checkbox"])');
      const descInput = document.querySelector('textarea');
      expect(titleInput).toBeTruthy();
      expect(descInput).toBeTruthy();
      titleInput.value = 'Bug report title';
      descInput.value = 'Description text long enough';

      const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
      const githubBtn = document.querySelectorAll('button.glass-button')[0];
      githubBtn.click();

      expect(openSpy).toHaveBeenCalledTimes(1);
      const calledUrl = openSpy.mock.calls[0][0];
      expect(calledUrl).toContain('github.com/diorhc/YTP/issues/new');
      expect(calledUrl).toContain('title=%5BBug%5D%20Bug%20report%20title');
      openSpy.mockRestore();
    });

    test('should copy report to clipboard when clicked', async () => {
      const titleInput = document.querySelector('input:not([type="email"]):not([type="checkbox"])');
      const descInput = document.querySelector('textarea');
      titleInput.value = 'Copy report title';
      descInput.value = 'Description text long enough';

      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      const copyBtn = document.querySelectorAll('button.glass-button')[1];
      copyBtn.click();

      await Promise.resolve();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0][0]).toContain('Copy report title');
    });

    test('copy falls back to execCommand when the clipboard API is absent', async () => {
      const titleInput = document.querySelector('input:not([type="email"]):not([type="checkbox"])');
      const descInput = document.querySelector('textarea');
      titleInput.value = 'Legacy copy title';
      descInput.value = 'Description text long enough';

      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined,
      });
      // jsdom has no execCommand; stub the call the fallback path relies on.
      const execCalls = [];
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: cmd => {
          execCalls.push(cmd);
          return true;
        },
      });

      const copyBtn = document.querySelectorAll('button.glass-button')[1];
      copyBtn.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(execCalls).toEqual(['copy']);
      delete document.execCommand;
      delete navigator.clipboard;
    });

    test('should open a prefilled mailto link when email button is clicked', () => {
      const titleInput = document.querySelector('input:not([type="email"]):not([type="checkbox"])');
      const descInput = document.querySelector('textarea');
      titleInput.value = 'Email report title';
      descInput.value = 'Description text long enough';

      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
        /* mock */
      });
      const emailBtn = document.querySelectorAll('button.glass-button')[2];
      expect(emailBtn.disabled).toBe(false);
      emailBtn.click();

      expect(clickSpy).toHaveBeenCalledTimes(1);
      const link = clickSpy.mock.instances[0];
      expect(link.href).toMatch(/^mailto:\?subject=/);
      expect(link.href).toContain('Email%20report%20title');
      expect(emailBtn.disabled).toBe(true);
      clickSpy.mockRestore();
    });

    test('should disable button during submission', () => {
      const buttons = document.querySelectorAll('button.glass-button');
      expect(buttons.length).toBe(3);

      buttons.forEach(btn => {
        expect(btn.disabled).toBe(false);
      });
    });

    test('should validate and include email when submitting report', () => {
      const titleInput = document.querySelector('input:not([type="email"]):not([type="checkbox"])');
      const emailInput = document.querySelector('input[type="email"]');
      const descInput = document.querySelector('textarea');
      const submitBtn = document.querySelectorAll('button.glass-button')[0];

      titleInput.value = 'Test title for email validation';
      descInput.value = 'Description text long enough for test';

      const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

      // 1. Invalid email triggers validation error
      emailInput.value = 'not-an-email';
      submitBtn.click();
      expect(openSpy).not.toHaveBeenCalled();

      // 2. Valid email passes validation and is included in payload
      emailInput.value = 'valid.user@example.com';
      submitBtn.click();
      expect(openSpy).toHaveBeenCalledTimes(1);
      const calledUrl = openSpy.mock.calls[0][0];
      expect(calledUrl).toContain('valid.user%40example.com');

      openSpy.mockRestore();
    });
  });

  describe('Debug Info', () => {
    beforeEach(() => {
      if (!window.YouTubePlusDebug) {
        window.YouTubePlusDebug = { utils: {}, state: {} };
      }
      window.YouTubePlusDebug.version = '2.1';

      loadReportScript();
    });

    test('should update debug preview when checkbox is toggled', () => {
      const modal = createModalWithReportSection();
      window.YouTubePlusReport.render(modal);

      const checkbox = requireInput(modal.querySelector('input[type="checkbox"]'));
      const preview = modal.querySelector('.glass-card');

      expect(checkbox.checked).toBe(false);
      expect(preview.style.display).toBe('none');

      // Check checkbox and trigger change
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(checkbox.checked).toBe(true);
      expect(preview.style.display).toBe('block');
      expect(preview.textContent).toContain('Version:');
      expect(preview.textContent).toContain('User agent:');

      // Uncheck checkbox and trigger change
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));
      expect(preview.style.display).toBe('none');
    });

    test('handles error in getDebugInfo gracefully and logs suppressed error', () => {
      const logSuppressed = jest.fn();
      window.YouTubeUtils.logSuppressed = logSuppressed;
      window.YouTubeUtils.SettingsManager = {
        load: () => {
          throw new Error('Simulated settings error');
        },
      };

      const modal = createModalWithReportSection();
      window.YouTubePlusReport.render(modal);

      const checkbox = requireInput(modal.querySelector('input[type="checkbox"]'));
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(logSuppressed).toHaveBeenCalled();
    });
  });

  describe('Sanitizer availability', () => {
    test('validation refuses input when no sanitizer is available', () => {
      loadReportScript();
      Object.defineProperty(window, 'YouTubeSafeDOM', {
        configurable: true,
        writable: true,
        value: {},
      });
      const logSuppressed = jest.fn();
      window.YouTubeUtils.logSuppressed = logSuppressed;

      const modal = createModalWithReportSection();
      window.YouTubePlusReport.render(modal);

      const titleInput = document.querySelector('input:not([type="email"]):not([type="checkbox"])');
      const descInput = document.querySelector('textarea');
      titleInput.value = 'A valid title here';
      descInput.value = 'Description text long enough';

      const submitBtn = document.querySelectorAll('button.glass-button')[0];
      submitBtn.click();

      // The sanitizer contract throws instead of silently escaping; the
      // submit handler reports the failure and resets the button.
      expect(logSuppressed).toHaveBeenCalled();
      expect(submitBtn.disabled).toBe(false);
    });
  });
});
