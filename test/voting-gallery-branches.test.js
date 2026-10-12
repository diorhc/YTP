/**
 * @jest-environment jsdom
 */

/**
 * Shared image gallery (lightbox).
 *
 * The gallery is a reusable runtime surface for feature photos, comment
 * attachments and preview images: it opens on a bounded initial index, walks
 * its items with keyboard and buttons, hides navigation for a lone item and
 * always returns focus to the element that opened it.
 */

describe('Voting gallery branches', () => {
  const installGlobals = () => {
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        byId: id => document.getElementById(id),
        $: (selector, root) => (root || document).querySelector(selector),
        t: key => key,
        setSafeHTML: (el, html) => {
          if (el) el.innerHTML = html;
        },
        cleanupManager: null,
        logSuppressed: jest.fn(),
        onSectionActive: jest.fn(),
        isSettingsModalOpen: jest.fn(() => false),
        safeRequestAnimationFrame: jest.fn(cb => cb(0)),
      },
    });
    Object.defineProperty(window, 'YouTubeSafeDOM', {
      configurable: true,
      writable: true,
      value: {
        escapeHTML: text => text,
        renderTemplateClone: (container, html) => {
          if (!container || container.nodeType !== 1) return;
          const tpl = document.createElement('template');
          tpl.innerHTML = String(html ?? '');
          container.replaceChildren(tpl.content.cloneNode(true));
        },
      },
    });
    if (!window.YouTubePlus) window.YouTubePlus = {};
  };

  const boot = () => {
    jest.resetModules();
    require('../src/voting.js');
    return window.YouTubePlusVoting.VotingGallery;
  };

  const items = count =>
    Array.from({ length: count }, (_, i) => ({ url: `https://vote.diorhc.space/img-${i}.png` }));

  const press = key => window.dispatchEvent(new window.KeyboardEvent('keydown', { key }));

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    if (!window.YouTubePlus) window.YouTubePlus = {};
    mockLocation({ href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', pathname: '/watch' });
    installGlobals();
  });

  test('opening walks the items with the buttons and the keyboard, then restores focus', () => {
    const opener = document.createElement('button');
    opener.textContent = 'open';
    document.body.appendChild(opener);
    opener.focus();

    const gallery = boot();
    gallery.open({ items: items(3), initialIndex: 0 });

    const modal = document.getElementById('yp-gallery-modal');
    expect(gallery.isOpen()).toBe(true);
    expect(modal.style.display).toBe('flex');
    expect(modal.querySelector('.yp-gallery-counter').textContent).toBe('1 / 3');
    expect(modal.querySelector('.yp-gallery-img').getAttribute('src')).toContain('img-0');

    modal.querySelector('.yp-gallery-next').click();
    expect(modal.querySelector('.yp-gallery-counter').textContent).toBe('2 / 3');
    press('ArrowRight');
    expect(modal.querySelector('.yp-gallery-counter').textContent).toBe('3 / 3');
    // Wraps forward from the last item.
    press('ArrowRight');
    expect(modal.querySelector('.yp-gallery-counter').textContent).toBe('1 / 3');
    // And backward past the first item.
    press('ArrowLeft');
    expect(modal.querySelector('.yp-gallery-counter').textContent).toBe('3 / 3');
    press('ArrowLeft');
    expect(modal.querySelector('.yp-gallery-counter').textContent).toBe('2 / 3');

    press('Escape');
    expect(gallery.isOpen()).toBe(false);
    expect(gallery.items).toEqual([]);
    expect(document.activeElement).toBe(opener);
  });

  test('the backdrop and the close button both dismiss the gallery', () => {
    const gallery = boot();
    gallery.open({ items: items(2) });
    const modal = document.getElementById('yp-gallery-modal');

    modal.querySelector('.yp-gallery-backdrop').click();
    expect(gallery.isOpen()).toBe(false);

    gallery.open({ items: items(2) });
    modal.querySelector('.yp-gallery-close').click();
    expect(gallery.isOpen()).toBe(false);
  });

  test('opening without items leaves the gallery closed', () => {
    const gallery = boot();

    gallery.open({ items: [] });
    expect(gallery.isOpen()).toBe(false);
    gallery.open();
    expect(gallery.isOpen()).toBe(false);
  });

  test('the initial index is clamped to the available items', () => {
    const gallery = boot();
    const modal = () => document.getElementById('yp-gallery-modal');

    gallery.open({ items: items(2), initialIndex: 99 });
    expect(modal().querySelector('.yp-gallery-counter').textContent).toBe('2 / 2');

    gallery.open({ items: items(2), initialIndex: -5 });
    expect(modal().querySelector('.yp-gallery-counter').textContent).toBe('1 / 2');
  });

  test('a lone item hides the navigation controls and captions fall back', () => {
    const gallery = boot();
    gallery.open({ items: [{ url: 'https://vote.diorhc.space/only.png' }] });
    const modal = document.getElementById('yp-gallery-modal');

    const img = modal.querySelector('.yp-gallery-img');
    expect(img.getAttribute('alt')).toBe('Image 1');
    expect(modal.querySelector('.yp-gallery-caption').textContent).toBe('');
    expect(modal.querySelector('.yp-gallery-prev').style.display).toBe('none');
    expect(modal.querySelector('.yp-gallery-next').style.display).toBe('none');

    // A single item is not navigable.
    gallery.next();
    gallery.prev();
    expect(modal.querySelector('.yp-gallery-counter').textContent).toBe('1 / 1');
  });

  test('an explicit caption is shown on the image and in the caption row', () => {
    const gallery = boot();
    gallery.open({ items: [{ url: 'https://vote.diorhc.space/c.png', caption: 'After' }] });
    const modal = document.getElementById('yp-gallery-modal');

    expect(modal.querySelector('.yp-gallery-img').getAttribute('alt')).toBe('After');
    expect(modal.querySelector('.yp-gallery-caption').textContent).toBe('After');
  });

  test('keyboard navigation is inert while the gallery is closed', () => {
    const gallery = boot();
    gallery.open({ items: items(2) });
    gallery.close();
    gallery.items = items(2);
    gallery.currentIndex = 0;

    press('Escape');
    press('ArrowLeft');
    press('ArrowRight');
    expect(gallery.currentIndex).toBe(0);
    expect(gallery.isOpen()).toBe(false);
  });

  test('an existing modal element is reused instead of duplicated', () => {
    const existing = document.createElement('div');
    existing.id = 'yp-gallery-modal';
    existing.className = 'yp-gallery-modal';
    existing.style.display = 'none';
    document.body.appendChild(existing);

    const gallery = boot();
    gallery.ensureDom();

    expect(document.querySelectorAll('#yp-gallery-modal').length).toBe(1);
    expect(gallery.modalEl).toBe(existing);
    // A second ensureDom call is a no-op.
    gallery.ensureDom();
    expect(document.querySelectorAll('#yp-gallery-modal').length).toBe(1);
  });

  test('the modal is owned by the runtime context that created it', () => {
    const gallery = boot();
    const owned = [];
    const ctx = {
      own: node => owned.push(node),
      listen: (target, type, handler) => {
        target.addEventListener(type, handler);
        return Symbol('listener');
      },
    };

    gallery.ensureDom(ctx);

    expect(owned).toEqual([document.getElementById('yp-gallery-modal')]);
  });

  test('updateView without items or modal leaves the view untouched', () => {
    const gallery = boot();
    gallery.open({ items: items(1) });
    gallery.updateView();

    gallery.items = [];
    gallery.updateView();
    gallery.close();

    const previousModal = gallery.modalEl;
    gallery.modalEl = null;
    gallery.updateView();
    gallery.modalEl = previousModal;
    expect(gallery.items).toEqual([]);
  });
});
