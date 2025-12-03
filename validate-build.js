/**
 * Improved build script validation and error handling
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);

/**
 * Validate build configuration
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
function validateBuildConfig() {
  const errors = [];
  const warnings = [];

  // Check for required directories
  const srcDir = path.join(ROOT, 'src');
  if (!fs.existsSync(srcDir)) {
    errors.push('Source directory (src/) not found');
  }

  // Check for build order file
  const buildOrderPath = path.join(ROOT, 'build.order.json');
  if (!fs.existsSync(buildOrderPath)) {
    warnings.push('build.order.json not found - using default ordering');
  } else {
    try {
      const buildOrder = JSON.parse(fs.readFileSync(buildOrderPath, 'utf8'));
      if (!Array.isArray(buildOrder)) {
        errors.push('build.order.json must be an array');
      }
    } catch (e) {
      errors.push(`Invalid build.order.json: ${e.message}`);
    }
  }

  // Check for userscript metadata
  const userscriptPath = path.join(ROOT, 'userscript.js');
  if (!fs.existsSync(userscriptPath)) {
    warnings.push('userscript.js not found - using fallback metadata');
  }

  // Check for package.json
  const packagePath = path.join(ROOT, 'package.json');
  if (!fs.existsSync(packagePath)) {
    warnings.push('package.json not found');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Check module dependencies
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
function checkModuleDependencies() {
  const errors = [];
  const warnings = [];
  const srcDir = path.join(ROOT, 'src');

  if (!fs.existsSync(srcDir)) {
    return { valid: false, errors: ['Source directory not found'], warnings: [] };
  }

  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));
  const moduleAPIs = new Map();

  // First pass: collect all module APIs
  files.forEach(file => {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');

    // Check for window assignments (module exports)
    const windowAssignments = content.match(/window\.(YouTube\w+)\s*=/g);
    if (windowAssignments) {
      windowAssignments.forEach(match => {
        const apiName = match.match(/window\.(\w+)/)[1];
        moduleAPIs.set(apiName, file);
      });
    }
  });

  // Second pass: check dependencies
  files.forEach(file => {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');

    // Check for window API usage
    const apiUsage = content.match(/window\.(YouTube\w+)(?!\s*=)/g);
    if (apiUsage) {
      apiUsage.forEach(match => {
        const apiName = match.match(/window\.(\w+)/)[1];
        if (!moduleAPIs.has(apiName)) {
          warnings.push(`${file} uses ${apiName} which is not defined by any module`);
        }
      });
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Run validation checks
 */
function runValidation() {
  console.log('🔍 Running build validation checks...\n');

  const configValidation = validateBuildConfig();
  const depsValidation = checkModuleDependencies();

  let hasErrors = false;

  // Display config validation results
  if (configValidation.errors.length > 0) {
    console.log('❌ Configuration Errors:');
    configValidation.errors.forEach(err => console.log(`   - ${err}`));
    hasErrors = true;
  }

  if (configValidation.warnings.length > 0) {
    console.log('\n⚠️  Configuration Warnings:');
    configValidation.warnings.forEach(warn => console.log(`   - ${warn}`));
  }

  // Display dependency validation results
  if (depsValidation.errors.length > 0) {
    console.log('\n❌ Dependency Errors:');
    depsValidation.errors.forEach(err => console.log(`   - ${err}`));
    hasErrors = true;
  }

  if (depsValidation.warnings.length > 0) {
    console.log('\n⚠️  Dependency Warnings:');
    depsValidation.warnings.forEach(warn => console.log(`   - ${warn}`));
  }

  if (
    !hasErrors &&
    configValidation.warnings.length === 0 &&
    depsValidation.warnings.length === 0
  ) {
    console.log('✅ All validation checks passed!\n');
  } else if (!hasErrors) {
    console.log('\n✅ Validation passed with warnings\n');
  } else {
    console.log('\n❌ Validation failed - please fix errors before building\n');
    process.exit(1);
  }
}

// Run validation if called directly
if (require.main === module) {
  runValidation();
}

module.exports = {
  validateBuildConfig,
  checkModuleDependencies,
  runValidation,
};
