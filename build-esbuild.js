/* eslint-disable no-console */
/**
 * Prototype esbuild-based build for YouTube+
 *
 * Evaluates migration from custom concatenation build to esbuild.
 * Run: node build-esbuild.js
 *
 * This creates youtube.user.esbuild.js for comparison purposes only.
 * The existing build.js remains the primary build system.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname);
const SRC = path.join(ROOT, 'src');
const BUILD_ORDER_PATH = path.join(ROOT, 'build.order.json');
const USERSCRIPT_PATH = path.join(ROOT, 'userscript.js');
const OUTPUT_PATH = path.join(ROOT, 'youtube.user.esbuild.js');

/**
 * Extract userscript metadata block from userscript.js
 * @returns {string} Metadata block
 */
function extractMetadata() {
  for (const candidate of [USERSCRIPT_PATH, path.join(ROOT, 'youtube.user.js')]) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, 'utf8');
      const match = content.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
      if (match) return match[0];
    }
  }
  return '// ==UserScript==\n// @name YouTube+\n// ==/UserScript==';
}

/**
 * Main build function
 */
async function build() {
  const startTime = performance.now();

  console.log('━━━ esbuild Prototype Build ━━━\n');

  // Check if esbuild is available
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch {
    console.log('esbuild not installed. Installing for prototype evaluation...');
    const { execSync } = require('child_process');
    try {
      execSync('npm install --save-dev esbuild', { cwd: ROOT, stdio: 'inherit' });
      esbuild = require('esbuild');
    } catch (err) {
      console.error('Failed to install esbuild:', err.message);
      console.log('\nTo install manually: npm install --save-dev esbuild');
      process.exit(1);
    }
  }

  // Read build order
  const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));

  // Read metadata
  const metadata = extractMetadata();

  // Concatenate source files (esbuild can't handle our IIFE pattern as modules)
  // But we can use esbuild's minification and optimization passes
  let concatenated = '';
  for (const filename of buildOrder) {
    const filePath = path.join(SRC, filename);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      // Strip any metadata blocks from individual files
      const stripped = content
        .replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\n*/g, '')
        .trim();
      concatenated += `\n// --- MODULE: ${filename} ---\n${stripped}\n`;
    } else {
      console.warn(`  Warning: ${filename} not found in src/`);
    }
  }

  // Write a temporary entry file for esbuild
  const tmpEntry = path.join(ROOT, '.esbuild-entry.tmp.js');
  fs.writeFileSync(tmpEntry, concatenated, 'utf8');

  try {
    // Build with esbuild optimizations
    const result = await esbuild.build({
      entryPoints: [tmpEntry],
      bundle: false, // No bundling - just transform/minify
      write: false,
      minify: false, // Don't minify for comparison with standard build
      minifyWhitespace: true, // Remove unnecessary whitespace
      minifySyntax: true, // Optimize syntax (e.g., if(a){b} → a&&b)
      target: ['es2020'],
      format: 'iife',
      legalComments: 'none',
      charset: 'utf8',
      sourcemap: false,
    });

    const optimizedCode = result.outputFiles[0].text;

    // Assemble final output
    const finalOutput = `${metadata}\n\n${optimizedCode}`;
    fs.writeFileSync(OUTPUT_PATH, finalOutput, 'utf8');

    // Also try minified version
    const minResult = await esbuild.build({
      entryPoints: [tmpEntry],
      bundle: false,
      write: false,
      minify: true,
      target: ['es2020'],
      format: 'iife',
      legalComments: 'none',
      charset: 'utf8',
      sourcemap: false,
    });

    const minifiedCode = minResult.outputFiles[0].text;
    const minOutputPath = OUTPUT_PATH.replace('.js', '.min.js');
    fs.writeFileSync(minOutputPath, `${metadata}\n\n${minifiedCode}`, 'utf8');

    const buildTime = (performance.now() - startTime).toFixed(0);

    // Report
    const origSize = fs.existsSync(path.join(ROOT, 'youtube.user.js'))
      ? fs.statSync(path.join(ROOT, 'youtube.user.js')).size
      : 0;
    const optimizedSize = fs.statSync(OUTPUT_PATH).size;
    const minifiedSize = fs.statSync(minOutputPath).size;

    console.log('Build Results:');
    console.log(`  Build time:       ${buildTime}ms`);
    console.log(`  Original build:   ${(origSize / 1024).toFixed(1)} KB`);
    console.log(`  esbuild optimized: ${(optimizedSize / 1024).toFixed(1)} KB`);
    console.log(`  esbuild minified:  ${(minifiedSize / 1024).toFixed(1)} KB`);
    if (origSize > 0) {
      const savings = ((1 - optimizedSize / origSize) * 100).toFixed(1);
      const minSavings = ((1 - minifiedSize / origSize) * 100).toFixed(1);
      console.log(`  Optimized savings: ${savings}%`);
      console.log(`  Minified savings:  ${minSavings}%`);
    }
    console.log(`\nOutput: ${path.relative(ROOT, OUTPUT_PATH)}`);
    console.log(`Output: ${path.relative(ROOT, minOutputPath)}`);

    console.log('\n━━━ Evaluation Summary ━━━');
    console.log('Pros:');
    console.log('  + Faster build (~10-50x vs custom script)');
    console.log('  + Better minification with syntax optimization');
    console.log('  + Built-in source map support');
    console.log('  + Active maintenance and ecosystem');
    console.log('Cons:');
    console.log('  - Cannot tree-shake IIFEs that set window globals');
    console.log('  - Would need module migration (IIFE → ESM) for full benefit');
    console.log('  - Custom metadata handling still needed');
    console.log('Recommendation:');
    console.log('  Keep build.js as primary. Use esbuild for minification pass only.');
  } finally {
    // Cleanup temp file
    try {
      fs.unlinkSync(tmpEntry);
    } catch {
      /* ignore */
    }
  }
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
