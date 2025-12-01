/**
 * Enhanced build configuration and validation utilities
 * @fileoverview Provides build-time validation and configuration helpers
 * @version 2.2
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);

/**
 * Validates that required files exist in the project
 * @returns {{valid: boolean, missing: string[], errors: string[]}}
 */
function validateRequiredFiles() {
  const requiredFiles = [
    'package.json',
    'build.js',
    'eslint.config.cjs',
    'tsconfig.json',
    'jest.config.js',
    'src/main.js',
    'src/error-boundary.js',
    'src/utils.js',
    'src/constants.js',
  ];

  const missing = [];
  const errors = [];

  for (const file of requiredFiles) {
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) {
      missing.push(file);
      errors.push(`Missing required file: ${file}`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    errors,
  };
}

/**
 * Validates package.json structure and required fields
 * @returns {{valid: boolean, warnings: string[], errors: string[]}}
 */
function validatePackageJson() {
  const warnings = [];
  const errors = [];

  try {
    const pkgPath = path.join(ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Required fields
    const requiredFields = ['name', 'version', 'scripts', 'devDependencies'];
    for (const field of requiredFields) {
      if (!pkg[field]) {
        errors.push(`package.json missing required field: ${field}`);
      }
    }

    // Required scripts
    const requiredScripts = ['build', 'test', 'lint'];
    for (const script of requiredScripts) {
      if (!pkg.scripts || !pkg.scripts[script]) {
        warnings.push(`package.json missing recommended script: ${script}`);
      }
    }

    // Check for security issues
    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      warnings.push('Project has runtime dependencies - consider review for userscript');
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
    };
  } catch (error) {
    return {
      valid: false,
      warnings: [],
      errors: [`Failed to read/parse package.json: ${error.message}`],
    };
  }
}

/**
 * Checks for code quality issues in source files
 * @returns {{valid: boolean, warnings: string[], errors: string[]}}
 */
function checkCodeQuality() {
  const warnings = [];
  const errors = [];

  try {
    const srcDir = path.join(ROOT, 'src');
    if (!fs.existsSync(srcDir)) {
      errors.push('src/ directory not found');
      return { valid: false, warnings, errors };
    }

    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

    for (const file of files) {
      const filePath = path.join(srcDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      // Check file size
      if (lines.length > 3000) {
        warnings.push(`${file}: Very large file (${lines.length} lines) - consider splitting`);
      }

      // Check for console.log (should use proper logging)
      const consoleLogs = content.match(/console\.log\(/g);
      if (consoleLogs && consoleLogs.length > 10) {
        warnings.push(`${file}: Contains ${consoleLogs.length} console.log statements`);
      }

      // Check for TODO comments
      const todos = content.match(/\/\/\s*TODO:/gi);
      if (todos && todos.length > 0) {
        warnings.push(`${file}: Contains ${todos.length} TODO comments`);
      }

      // Check for FIXME comments
      const fixmes = content.match(/\/\/\s*FIXME:/gi);
      if (fixmes && fixmes.length > 0) {
        warnings.push(`${file}: Contains ${fixmes.length} FIXME comments`);
      }
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
    };
  } catch (error) {
    return {
      valid: false,
      warnings,
      errors: [`Code quality check failed: ${error.message}`],
    };
  }
}

/**
 * Validates build order configuration
 * @returns {{valid: boolean, warnings: string[], errors: string[]}}
 */
function validateBuildOrder() {
  const warnings = [];
  const errors = [];

  try {
    const buildOrderPath = path.join(ROOT, 'build.order.json');
    if (!fs.existsSync(buildOrderPath)) {
      warnings.push('build.order.json not found - using default build order');
      return { valid: true, warnings, errors };
    }

    const buildOrder = JSON.parse(fs.readFileSync(buildOrderPath, 'utf8'));

    if (!Array.isArray(buildOrder)) {
      errors.push('build.order.json must contain an array');
      return { valid: false, warnings, errors };
    }

    const srcDir = path.join(ROOT, 'src');
    const sourceFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

    // Check if all files in build order exist
    for (const file of buildOrder) {
      if (!sourceFiles.includes(file)) {
        warnings.push(`build.order.json references non-existent file: ${file}`);
      }
    }

    // Check if all source files are in build order
    for (const file of sourceFiles) {
      if (!buildOrder.includes(file) && file !== 'main.js') {
        warnings.push(`Source file not in build.order.json: ${file}`);
      }
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
    };
  } catch (error) {
    return {
      valid: false,
      warnings,
      errors: [`Build order validation failed: ${error.message}`],
    };
  }
}

/**
 * Main validation runner
 * @returns {void}
 */
function runValidation() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 Running Build Configuration Validation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let hasErrors = false;
  let totalWarnings = 0;

  // Required files check
  console.log('📁 Checking required files...');
  const filesResult = validateRequiredFiles();
  if (filesResult.valid) {
    console.log('✅ All required files present\n');
  } else {
    hasErrors = true;
    console.error('❌ Missing required files:');
    filesResult.errors.forEach(err => console.error(`   - ${err}`));
  }

  // Package.json validation
  console.log('📦 Validating package.json...');
  const pkgResult = validatePackageJson();
  if (pkgResult.valid) {
    console.log('✅ package.json structure valid\n');
  } else {
    hasErrors = true;
    console.error('❌ package.json validation failed:');
    pkgResult.errors.forEach(err => console.error(`   - ${err}`));
  }
  if (pkgResult.warnings.length > 0) {
    totalWarnings += pkgResult.warnings.length;
    console.warn('⚠️  package.json warnings:');
    pkgResult.warnings.forEach(warn => console.warn(`   - ${warn}`));
  }

  // Build order validation
  console.log('🔧 Validating build order...');
  const buildOrderResult = validateBuildOrder();
  if (buildOrderResult.valid && buildOrderResult.warnings.length === 0) {
    console.log('✅ Build order configuration valid\n');
  } else if (!buildOrderResult.valid) {
    hasErrors = true;
    console.error('❌ Build order validation failed:');
    buildOrderResult.errors.forEach(err => console.error(`   - ${err}`));
  }
  if (buildOrderResult.warnings.length > 0) {
    totalWarnings += buildOrderResult.warnings.length;
    console.warn('⚠️  Build order warnings:');
    buildOrderResult.warnings.forEach(warn => console.warn(`   - ${warn}`));
  }

  // Code quality checks
  console.log('🎨 Checking code quality...');
  const qualityResult = checkCodeQuality();
  if (qualityResult.valid && qualityResult.warnings.length === 0) {
    console.log('✅ Code quality checks passed\n');
  } else if (!qualityResult.valid) {
    hasErrors = true;
    console.error('❌ Code quality check failed:');
    qualityResult.errors.forEach(err => console.error(`   - ${err}`));
  }
  if (qualityResult.warnings.length > 0) {
    totalWarnings += qualityResult.warnings.length;
    console.warn('⚠️  Code quality warnings:');
    qualityResult.warnings.forEach(warn => console.warn(`   - ${warn}`));
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Validation Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (hasErrors) {
    console.error('❌ Validation failed with errors');
    console.log(`⚠️  Total warnings: ${totalWarnings}`);
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.warn(`✅ Validation passed with ${totalWarnings} warnings`);
    console.log('\n💡 Tip: Address warnings to improve code quality\n');
    process.exit(0);
  } else {
    console.log('✅ All validations passed successfully!\n');
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  runValidation();
}

module.exports = {
  validateRequiredFiles,
  validatePackageJson,
  validateBuildOrder,
  checkCodeQuality,
  runValidation,
};
