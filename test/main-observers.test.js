/**
 * @jest-environment jsdom
 *
 * Tests the real MutationCoordinator DOM observer optimizations,
 * debounced dispatch, root subscription batching, and teardown.
 */

describe('DOM Observer Optimizations — Real MutationCoordinator', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="test-root"><div class="target-child">Initial</div></div>';

    // Load canonical modules
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/mutation-coordinator.js');
  });

  afterEach(() => {
    window.YouTubePlusMutationCoordinator?.cleanup?.();
    document.body.innerHTML = '';
  });

  test('exposes canonical window.YouTubePlusMutationCoordinator facade', () => {
    expect(window.YouTubePlusMutationCoordinator).toBeDefined();
    expect(typeof window.YouTubePlusMutationCoordinator.subscribeRoot).toBe('function');
    expect(typeof window.YouTubePlusMutationCoordinator.unsubscribe).toBe('function');
    expect(typeof window.YouTubePlusMutationCoordinator.getStats).toBe('function');
  });

  test('batches DOM mutations across subscribers', done => {
    const root = document.getElementById('test-root');
    const subscriberA = jest.fn();
    const subscriberB = jest.fn();

    window.YouTubePlusMutationCoordinator.subscribeRoot('subA', subscriberA);
    window.YouTubePlusMutationCoordinator.subscribeRoot('subB', subscriberB);

    // Trigger DOM mutations on root
    const child1 = document.createElement('div');
    child1.className = 'new-child-1';
    root.appendChild(child1);

    const child2 = document.createElement('div');
    child2.className = 'new-child-2';
    root.appendChild(child2);

    // Allow mutation observer loop / rAF to flush
    setTimeout(() => {
      expect(subscriberA).toHaveBeenCalled();
      expect(subscriberB).toHaveBeenCalled();

      const stats = window.YouTubePlusMutationCoordinator.getStats();
      expect(stats.rootSubscribers).toBeGreaterThanOrEqual(2);

      window.YouTubePlusMutationCoordinator.unsubscribe('subA');
      window.YouTubePlusMutationCoordinator.unsubscribe('subB');
      done();
    }, 50);
  });

  test('unsubscribing stops receiving mutation callbacks', done => {
    const root = document.getElementById('test-root');
    const subscriber = jest.fn();

    window.YouTubePlusMutationCoordinator.subscribeRoot('tempSub', subscriber);
    window.YouTubePlusMutationCoordinator.unsubscribe('tempSub');

    const newChild = document.createElement('div');
    root.appendChild(newChild);

    setTimeout(() => {
      expect(subscriber).not.toHaveBeenCalled();
      done();
    }, 50);
  });

  test('pause and resume correctly pause mutation dispatch', done => {
    const root = document.getElementById('test-root');
    const subscriber = jest.fn();

    window.YouTubePlusMutationCoordinator.subscribeRoot('pausedSub', subscriber);
    window.YouTubePlusMutationCoordinator.pause();

    const newChild = document.createElement('div');
    root.appendChild(newChild);

    setTimeout(() => {
      expect(subscriber).not.toHaveBeenCalled();

      // Resume and trigger another mutation
      window.YouTubePlusMutationCoordinator.resume();
      const anotherChild = document.createElement('div');
      root.appendChild(anotherChild);

      setTimeout(() => {
        expect(subscriber).toHaveBeenCalled();
        window.YouTubePlusMutationCoordinator.unsubscribe('pausedSub');
        done();
      }, 50);
    }, 50);
  });
});
