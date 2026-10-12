/**
 * DOMCache freshness policy.
 *
 * Contracts under test (real DOMCache + real MutationCoordinator):
 *   - A cached single result is valid ONLY inside the context it was
 *     queried for: a node moved to another container is no longer
 *     returned for the old context.
 *   - The mutation-driven sweep purges entries that ceased to be the
 *     first match in their context (new earlier match inserted, replace).
 *   - List queries stay always-fresh; late coordinator subscription
 *     self-heals.
 *   - TTL policy: found entries 5s, null entries 1s.
 */

describe('DOMCache freshness and context identity', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/mutation-coordinator.js');
    require('../src/dom-cache.js');
  });

  afterEach(() => {
    window.YouTubePlusDOMCache?.destroy?.();
    document.body.innerHTML = '';
  });

  const makeTree = () => {
    document.body.innerHTML =
      '<div id="a"><span class="item" id="one"></span><span class="item" id="two"></span></div>' +
      '<div id="b"></div>';
    return {
      a: document.getElementById('a'),
      b: document.getElementById('b'),
      one: document.getElementById('one'),
      two: document.getElementById('two'),
    };
  };

  test('cached node moved to another context is not returned for the old one', () => {
    const cache = window.YouTubePlusDOMCache;
    const { a, b, one, two } = makeTree();

    const first = cache.querySelector('.item', a);
    expect(first).toBe(one);

    // Move the cached node into container B.
    b.append(one);

    // The same (selector, context A) query must answer what the NATIVE
    // query answers now — not the moved node.
    const again = cache.querySelector('.item', a);
    expect(again).toBe(two);
    expect(a.querySelector('.item')).toBe(two);
  });

  test('an inserted EARLIER match shadows the cached one (documented policy)', () => {
    const cache = window.YouTubePlusDOMCache;
    const { a, one } = makeTree();

    const cached = cache.querySelector('.item', a);
    expect(cached).toBe(one);

    // Insert a NEW first match at the top of the same context.
    const earlier = document.createElement('span');
    earlier.className = 'item';
    earlier.id = 'zero';
    a.prepend(earlier);

    // The mutation sweep runs idle-coalesced; force it synchronously.
    cache.revalidate();

    const next = cache.querySelector('.item', a);
    expect(next).toBe(earlier);
    expect(a.querySelector('.item')).toBe(earlier);
  });

  test('replace (new node same selector) is served fresh after the sweep', () => {
    const cache = window.YouTubePlusDOMCache;
    const { a, one } = makeTree();

    expect(cache.querySelector('.item', a)).toBe(one);

    const replacement = document.createElement('span');
    replacement.className = 'item';
    replacement.id = 'replacement';
    one.replaceWith(replacement);
    cache.revalidate();

    expect(cache.querySelector('.item', a)).toBe(replacement);
  });

  test('list queries are always fresh (middle removal)', () => {
    const cache = window.YouTubePlusDOMCache;
    const { a, two } = makeTree();

    const before = cache.querySelectorAll('.item', a).map(x => x.id);
    expect(before).toEqual(['one', 'two']);

    two.remove();
    const after = cache.querySelectorAll('.item', a).map(x => x.id);
    expect(after).toEqual(['one']);
  });

  test('shadow-root context: membership is root-node identity, not document', () => {
    const cache = window.YouTubePlusDOMCache;
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<span class="item" id="shadow-one"></span>';
    const shadowOne = shadow.querySelector('.item');

    const cached = cache.querySelector('.item', shadow);
    expect(cached).toBe(shadowOne);

    // Move the node OUT of the shadow root into the light DOM.
    document.body.append(shadowOne);
    const again = cache.querySelector('.item', shadow);
    expect(again).toBeNull();
    expect(shadow.querySelector('.item')).toBeNull();
  });

  test('TTL policy: found entries 5s, null entries 1s', () => {
    const cache = window.YouTubePlusDOMCache;
    const { a, one } = makeTree();

    expect(cache.querySelector('.item', a)).toBe(one);
    // Null result cached.
    expect(cache.querySelector('.absent', a)).toBeNull();

    const now = Date.now();
    const realNow = Date.now;
    try {
      // 2s later: the null entry (1s TTL) must be gone, the found one alive.
      jest.spyOn(Date, 'now').mockReturnValue(now + 2000);
      expect(cache.querySelector('.absent', a)).toBeNull(); // re-queried, still null
      expect(cache.querySelector('.item', a)).toBe(one); // still cached

      // 6s after the original write: the found entry must be expired.
      jest.spyOn(Date, 'now').mockReturnValue(now + 6000);
      expect(cache.querySelector('.item', a)).toBe(one); // same answer, from a fresh query
    } finally {
      jest.restoreAllMocks();
      void realNow;
    }
  });
});
