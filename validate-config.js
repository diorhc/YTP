#!/usr/bin/env node
/**
 * validate-config.js
 * Validates configuration files and project setup
 */

'use strict';

const fs = require('fs');
const path = require('path');

function validateConfig() {
  console.log('🔍 Validating project configuration...\n');

  const errors = [];
  const warnings = [];

  // Check package.json
  try {
    const packageJsonPath = path.join(__dirname, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    console.log('✓ package.json is valid JSON');

    if (!packageJson.name) errors.push('package.json: Missing name field');
    if (!packageJson.version) errors.push('package.json: Missing version field');
    if (!packageJson.license) warnings.push('package.json: Missing license field');
    if (!packageJson.repository) warnings.push('package.json: Missing repository field');
  } catch (error) {
    errors.push(`package.json: ${error.message}`);
  }

  // Check tsconfig.json
  try {
    const tsconfigPath = path.join(__dirname, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
      console.log('✓ tsconfig.json is valid JSON');
    } else {
      warnings.push('tsconfig.json: File not found');
    }
  } catch (error) {
    errors.push(`tsconfig.json: ${error.message}`);
  }

  // Check jest.config.js
  try {
    const jestConfigPath = path.join(__dirname, 'jest.config.js');
    if (fs.existsSync(jestConfigPath)) {
      require(jestConfigPath);
      console.log('✓ jest.config.js is valid');
    } else {
      warnings.push('jest.config.js: File not found');
    }
  } catch (error) {
    errors.push(`jest.config.js: ${error.message}`);
  }

  // Check build.order.json
  try {
    const buildOrderPath = path.join(__dirname, 'build.order.json');
    if (fs.existsSync(buildOrderPath)) {
      const buildOrder = JSON.parse(fs.readFileSync(buildOrderPath, 'utf8'));
      console.log('✓ build.order.json is valid JSON');

      if (!Array.isArray(buildOrder)) {
        errors.push('build.order.json: Must be an array');
      } else {
        // Check if all files exist
        const srcDir = path.join(__dirname, 'src');
        buildOrder.forEach(file => {
          const filePath = path.join(srcDir, file);
          if (!fs.existsSync(filePath)) {
            errors.push(`build.order.json: Referenced file does not exist: ${file}`);
          }
        });
      }
    } else {
      errors.push('build.order.json: File not found');
    }
  } catch (error) {
    errors.push(`build.order.json: ${error.message}`);
  }

  // Check required directories
  const requiredDirs = ['src', 'test', 'locales'];
  requiredDirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
      errors.push(`Required directory not found: ${dir}`);
    } else {
      console.log(`✓ Directory exists: ${dir}`);
    }
  });

  // Check required files
  const requiredFiles = ['build.js', 'userscript.js', 'README.md', 'LICENSE'];
  requiredFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      errors.push(`Required file not found: ${file}`);
    } else {
      console.log(`✓ File exists: ${file}`);
    }
  });

  console.log('\n' + '─'.repeat(70));

  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach(warning => console.log(`  - ${warning}`));
  }

  if (errors.length > 0) {
    console.log('\n❌ Errors:');
    errors.forEach(error => console.log(`  - ${error}`));
    console.log('\n❌ Configuration validation failed!\n');
    process.exit(1);
  }

  console.log('\n✅ Configuration validation passed!\n');
}

try {
  validateConfig();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
