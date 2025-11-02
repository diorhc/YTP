/**
 * Script to automatically fix common TypeScript errors in the codebase
 */

const fs = require('fs');

// Files to process
const files = ['src/basic.js', 'src/adblocker.js', 'src/timecode.js'];

files.forEach(filePath => {
  console.log(`Processing ${filePath}...`);
  let content = fs.readFileSync(filePath, 'utf8');
  let changes = 0;

  // Fix 1: Add type assertions for window.YouTubeUtils
  const windowYouTubeUtilsRegex = /\bwindow\.YouTubeUtils\b/g;
  if (windowYouTubeUtilsRegex.test(content)) {
    content = content.replace(windowYouTubeUtilsRegex, '/** @type {any} */ (window).YouTubeUtils');
    changes++;
  }

  // Fix 2: Add type assertions for window.youtubePlus
  const windowYoutubePlusRegex = /\bwindow\.youtubePlus\b/g;
  if (windowYoutubePlusRegex.test(content)) {
    content = content.replace(windowYoutubePlusRegex, '/** @type {any} */ (window).youtubePlus');
    changes++;
  }

  // Fix 3: Add type assertions for window.YouTubePlusDebug
  const windowYoutubePlusDebugRegex = /\bwindow\.YouTubePlusDebug\s*=/g;
  if (windowYoutubePlusDebugRegex.test(content)) {
    content = content.replace(
      windowYoutubePlusDebugRegex,
      '/** @type {any} */ (window).YouTubePlusDebug ='
    );
    changes++;
  }

  // Fix 4: Cast e.target to HTMLElement for common DOM properties
  // e.target.classList
  content = content.replace(
    /(\s+)(e\.target)\.classList/g,
    '$1/** @type {HTMLElement} */ ($2).classList'
  );

  // e.target.closest
  content = content.replace(
    /(\s+)(e\.target)\.closest\(/g,
    '$1/** @type {HTMLElement} */ ($2).closest('
  );

  // e.target.matches
  content = content.replace(
    /(\s+)(e\.target)\.matches\(/g,
    '$1/** @type {HTMLElement} */ ($2).matches('
  );

  // e.target.dataset
  content = content.replace(
    /(\s+)(e\.target)\.dataset/g,
    '$1/** @type {HTMLElement} */ ($2).dataset'
  );

  // e.target.id
  content = content.replace(/(\s+)(e\.target)\.id\b/g, '$1/** @type {HTMLElement} */ ($2).id');

  // e.target.checked
  content = content.replace(
    /(\s+)(e\.target)\.checked\b/g,
    '$1/** @type {HTMLInputElement} */ ($2).checked'
  );

  // e.target.value
  content = content.replace(
    /(\s+)(e\.target)\.value\b/g,
    '$1/** @type {HTMLInputElement} */ ($2).value'
  );

  // e.target.style
  content = content.replace(
    /(\s+)(e\.target)\.style\b/g,
    '$1/** @type {HTMLElement} */ ($2).style'
  );

  // Fix 5: Cast node to HTMLElement for classList
  content = content.replace(
    /(\s+)(node)\.classList/g,
    '$1/** @type {HTMLElement} */ ($2).classList'
  );

  // Fix 6: Cast video elements
  content = content.replace(
    /(\s+)(video)\.currentTime\b/g,
    '$1/** @type {HTMLVideoElement} */ ($2).currentTime'
  );

  // Fix 7: Cast button elements
  content = content.replace(
    /(\s+)(button)\.offsetParent/g,
    '$1/** @type {HTMLElement} */ ($2).offsetParent'
  );

  content = content.replace(
    /(\s+)(button)\.click\(\)/g,
    '$1/** @type {HTMLElement} */ ($2).click()'
  );

  // Fix 8: Cast element to HTMLElement for querySelector results
  content = content.replace(
    /(\s+)(element)\.value\b/g,
    '$1/** @type {HTMLInputElement} */ ($2).value'
  );

  // Write changes
  if (changes > 0 || content !== fs.readFileSync(filePath, 'utf8')) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Fixed ${filePath}`);
  } else {
    console.log(`ℹ️  No changes needed for ${filePath}`);
  }
});

console.log('\n✨ TypeScript error fixing complete!');
