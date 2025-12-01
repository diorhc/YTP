/**
 * Performance Boost Module
 * Additional optimizations to reduce LCP and improve initial load
 */

(function () {
  'use strict';

  // Prevent unnecessary ad-related requests early
  const blockAdRequests = () => {
    /* global XMLHttpRequest, Image, Response, HTMLImageElement, fetch, Headers */

    // Ad domains to block
    const adDomains = [
      'doubleclick.net',
      'googleads.g.doubleclick.net',
      'googlesyndication.com',
      'googleadservices.com',
      'google-analytics.com',
      'google.com/pagead',
      'ad.doubleclick.net',
      'www.google.com/pagead',
      'www.google.com.tr/pagead',
      'static.doubleclick.net',
    ];

    const isAdRequest = url => {
      const urlString = String(url);
      return adDomains.some(domain => urlString.includes(domain));
    };

    // Block XMLHttpRequest
    if (typeof XMLHttpRequest !== 'undefined') {
      const originalXHROpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url, ...args) {
        if (isAdRequest(url)) {
          console.debug('[YT+][Perf] Blocked XHR:', String(url).substring(0, 60));
          // Create a fake successful response
          this.status = 200;
          this.readyState = 4;
          return undefined;
        }
        return originalXHROpen.call(this, method, url, ...args);
      };
    }

    // Block Fetch API
    if (typeof fetch !== 'undefined' && typeof window !== 'undefined') {
      const originalFetch = window.fetch;
      window.fetch = function (url, ...args) {
        if (isAdRequest(url)) {
          console.debug('[YT+][Perf] Blocked fetch:', String(url).substring(0, 60));
          // Return fake successful response
          return Promise.resolve(
            new Response('', {
              status: 200,
              statusText: 'OK',
              headers: new Headers(),
            })
          );
        }
        return originalFetch.call(this, url, ...args);
      };
    }

    // Block Image tracking pixels
    if (typeof Image !== 'undefined' && typeof HTMLImageElement !== 'undefined') {
      const OriginalImage = Image;
      const ImageProxy = new Proxy(OriginalImage, {
        construct(target, args) {
          const img = new target(...args);
          const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');

          if (descriptor && descriptor.set) {
            const originalSrcSetter = descriptor.set;
            Object.defineProperty(img, 'src', {
              set(value) {
                if (isAdRequest(value)) {
                  console.debug('[YT+][Perf] Blocked image:', String(value).substring(0, 60));
                  // Set to transparent 1x1 pixel
                  originalSrcSetter.call(
                    this,
                    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
                  );
                  return;
                }
                originalSrcSetter.call(this, value);
              },
              get() {
                return this.getAttribute('src');
              },
            });
          }
          return img;
        },
      });
      window.Image = ImageProxy;
    }
  };

  // Optimize YouTube's service worker
  const optimizeServiceWorker = () => {
    if ('serviceWorker' in navigator) {
      // Prevent service worker navigation preload conflicts
      navigator.serviceWorker.ready
        .then(registration => {
          if (registration.navigationPreload) {
            registration.navigationPreload.disable().catch(() => {
              // Silently fail
            });
          }
        })
        .catch(() => {
          // Silently fail
        });
    }
  };

  // Lazy load images with IntersectionObserver
  const optimizeImages = () => {
    const imageObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            if (img.dataset.src) {
              img.src = img.dataset.src;
              img.removeAttribute('data-src');
            }
            observer.unobserve(img);
          }
        });
      },
      {
        rootMargin: '50px 0px',
        threshold: 0.01,
      }
    );

    // Observe images on YouTube
    const observeImages = () => {
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        imageObserver.observe(img);
      });
    };

    // Initial observation
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', observeImages);
    } else {
      observeImages();
    }

    // Re-observe on navigation
    document.addEventListener('yt-navigate-finish', observeImages);
  };

  // Prefetch critical resources (disabled - causes CORS errors)
  const prefetchCriticalResources = () => {
    // Removed due to CORS policy violations and 404 errors
    // YouTube's resources don't support cross-origin prefetch
    // This optimization has been disabled
    console.debug('[YT+][Perf] Prefetch disabled (CORS restrictions)');
  };

  // Reduce layout thrashing
  const optimizeLayoutCalculations = () => {
    // Batch read and write operations
    let scheduledReads = [];
    let scheduledWrites = [];
    let rafScheduled = false;

    const processScheduled = () => {
      // Execute all reads first
      scheduledReads.forEach(fn => fn());
      scheduledReads = [];

      // Then execute all writes
      scheduledWrites.forEach(fn => fn());
      scheduledWrites = [];

      rafScheduled = false;
    };

    window.scheduleRead = fn => {
      scheduledReads.push(fn);
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(processScheduled);
      }
    };

    window.scheduleWrite = fn => {
      scheduledWrites.push(fn);
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(processScheduled);
      }
    };
  };

  // Optimize font loading
  const optimizeFonts = () => {
    if ('fonts' in document && document.head) {
      // Use font-display: swap for faster rendering
      const style = document.createElement('style');
      style.textContent = `
        @font-face {
          font-family: 'Roboto';
          font-display: swap;
        }
        @font-face {
          font-family: 'YouTube Sans';
          font-display: swap;
        }
      `;
      document.head.appendChild(style);
    }
  };

  // Reduce JavaScript execution time
  const deferNonCriticalJS = () => {
    // Mark scripts as low priority
    const scripts = document.querySelectorAll('script[src]');
    scripts.forEach(script => {
      if (!script.hasAttribute('async') && !script.hasAttribute('defer')) {
        script.setAttribute('defer', '');
      }
    });
  };

  // Optimize CSS to reduce rendering time
  const optimizeCSS = () => {
    // Add critical CSS optimizations
    if (!document.head) {
      console.debug('[YT+][Perf] document.head not ready, deferring CSS optimization');
      return;
    }
    const style = document.createElement('style');
    style.textContent = `
      /* Force GPU acceleration for smoother animations */
      .html5-video-player,
      ytd-app,
      #movie_player {
        transform: translateZ(0);
        will-change: transform;
      }
      
      /* Reduce repaints for hover effects */
      * {
        -webkit-tap-highlight-color: transparent;
      }
      
      /* Optimize rendering performance */
      img, video {
        image-rendering: -webkit-optimize-contrast;
      }
    `;
    document.head.appendChild(style);
  };

  // Defer third-party scripts
  const deferThirdPartyScripts = () => {
    // Block or defer known performance-heavy scripts
    const blockedScripts = [
      'googletagmanager.com',
      'google-analytics.com',
      'analytics.js',
      'gtag/js',
    ];

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.tagName === 'SCRIPT' && node.src) {
            const shouldBlock = blockedScripts.some(blocked => node.src.includes(blocked));
            if (shouldBlock) {
              console.debug('[YT+][Perf] Blocked third-party script:', node.src);
              node.remove();
            }
          }
        });
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  // Reduce memory usage by limiting cache
  const optimizeMemory = () => {
    // Clear old data from localStorage periodically
    try {
      const keysToCheck = Object.keys(localStorage);
      const oldDataKeys = keysToCheck.filter(key => {
        try {
          const data = localStorage.getItem(key);
          if (data && data.includes('"timestamp"')) {
            const parsed = JSON.parse(data);
            const age = Date.now() - (parsed.timestamp || 0);
            // Remove data older than 7 days
            return age > 7 * 24 * 60 * 60 * 1000;
          }
        } catch {
          return false;
        }
        return false;
      });

      oldDataKeys.forEach(key => localStorage.removeItem(key));

      if (oldDataKeys.length > 0) {
        console.log(`[YT+][Perf] Cleaned ${oldDataKeys.length} old localStorage entries`);
      }
    } catch (e) {
      console.debug('[YT+][Perf] Could not clean localStorage:', e);
    }
  };

  // Initialize all optimizations
  const init = () => {
    console.log('[YT+][Boost] Applying performance optimizations...');

    try {
      // Critical optimizations - run immediately (non-DOM dependent)
      blockAdRequests();
      optimizeServiceWorker();
      optimizeLayoutCalculations();

      // DOM-dependent optimizations - wait for document.head
      const applyDOMOptimizations = () => {
        if (document.head) {
          optimizeCSS();
          optimizeFonts();
        } else {
          console.debug('[YT+][Perf] Waiting for document.head...');
          if (document.readyState === 'loading') {
            document.addEventListener(
              'DOMContentLoaded',
              () => {
                optimizeCSS();
                optimizeFonts();
              },
              { once: true }
            );
          } else {
            // Fallback: try again after short delay
            setTimeout(() => {
              optimizeCSS();
              optimizeFonts();
            }, 50);
          }
        }
      };

      applyDOMOptimizations();

      // Medium priority - run after short delay
      setTimeout(() => {
        optimizeImages();
        deferThirdPartyScripts();
      }, 100);

      // Low priority - run after longer delay
      setTimeout(() => {
        prefetchCriticalResources();
        deferNonCriticalJS();
        optimizeMemory();
      }, 1000);

      console.log('[YT+][Boost] Performance optimizations applied');
    } catch (error) {
      console.error('[YT+][Boost] Error applying optimizations:', error);
    }
  };

  // Export module
  if (typeof window !== 'undefined') {
    window.YouTubePerformanceBoost = {
      init,
      version: '2.2',
    };
  }

  // Run immediately for maximum effect
  init();
})();
