const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BUILD_SCRIPT = path.join(ROOT, 'build.js');
const OUT = path.join(ROOT, 'youtube.user.js');
const BUILD_ORDER = path.join(ROOT, 'build.order.json');

/**
 * Runs the build script
 */
function runBuild() {
  console.log('━━━ Running build...');
  try {
    execSync(`node "${BUILD_SCRIPT}" --no-eslint`, { stdio: 'inherit' });
    console.log('✓ Build completed successfully\n');
  } catch (e) {
    throw new Error(`Build failed: ${e.message}`);
  }
}

/**
 * Validates the output file structure and content
 */
function smokeValidate() {
  console.log('━━━ Validating output file...');

  // Check if output file exists
  if (!fs.existsSync(OUT)) {
    throw new Error('Output file not found: ' + OUT);
  }
  console.log('✓ Output file exists');

  const content = fs.readFileSync(OUT, 'utf8');
  const stats = fs.statSync(OUT);

  console.log(`  File size: ${(stats.size / 1024).toFixed(2)} KB`);

  // Check userscript header
  if (!/==UserScript==/.test(content)) {
    throw new Error('Missing userscript header');
  }
  console.log('✓ Userscript header found');

  // Check for module markers
  const hasMainModule =
    /--- MODULE: main.js/.test(content) || /--- MODULE: src\/main.js/.test(content);
  if (!hasMainModule) {
    throw new Error('main.js module marker not found');
  }
  console.log('✓ Module markers found');

  // Check module count
  const moduleMatches = content.match(/--- MODULE:/g);
  const expectedModules = fs.existsSync(BUILD_ORDER)
    ? JSON.parse(fs.readFileSync(BUILD_ORDER, 'utf8')).length
    : 0;

  if (moduleMatches) {
    console.log(
      `✓ Found ${moduleMatches.length} modules${expectedModules ? ` (expected: ${expectedModules})` : ''}`
    );
  }

  // Syntax validation using VM
  try {
    new vm.Script(content, { filename: OUT });
    console.log('✓ JavaScript syntax is valid');
  } catch (e) {
    throw new Error('Syntax check failed: ' + e.message);
  }

  // Check for common issues
  if (content.includes('undefined is not defined')) {
    console.warn('⚠ Warning: Found "undefined is not defined" in output');
  }

  if (content.includes('console.log') && content.split('console.log').length > 100) {
    console.warn(
      `⚠ Warning: Found ${content.split('console.log').length - 1} console.log statements`
    );
  }

  console.log('\n✓ All smoke tests passed!\n');
}

/**
 * Validates source files
 */
function validateSourceFiles() {
  console.log('━━━ Validating source files...');

  const srcDir = path.join(ROOT, 'src');
  if (!fs.existsSync(srcDir)) {
    throw new Error('src directory not found');
  }

  const jsFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));
  console.log(`✓ Found ${jsFiles.length} source files`);

  // Check that all files are valid JavaScript
  let invalidFiles = 0;
  jsFiles.forEach(file => {
    const filePath = path.join(srcDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    try {
      new vm.Script(content, { filename: file });
    } catch (e) {
      console.error(`✗ ${file}: ${e.message}`);
      invalidFiles++;
    }
  });

  if (invalidFiles > 0) {
    throw new Error(`${invalidFiles} source file(s) have syntax errors`);
  }
  console.log('✓ All source files are valid\n');
}

try {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     YouTube+ Modular Smoke Test       ║');
  console.log('╚════════════════════════════════════════╝\n');

  validateSourceFiles();
  runBuild();
  smokeValidate();

  console.log('╔════════════════════════════════════════╗');
  console.log('║         ALL TESTS PASSED! ✓            ║');
  console.log('╚════════════════════════════════════════╝\n');

  process.exit(0);
} catch (e) {
  console.error('\n╔════════════════════════════════════════╗');
  console.error('║         SMOKE TEST FAILED ✗            ║');
  console.error('╚════════════════════════════════════════╝');
  console.error('\nError:', e && e.message);
  console.error();
  process.exit(2);
}
