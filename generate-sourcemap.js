const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const BUILD_OUTPUT = path.join(ROOT, 'youtube.user.js');

/**
 * Generate source map for the built userscript
 * @param {Array<{name: string, dir: string, startLine: number, endLine: number}>} modules
 * @returns {object} Source map object
 */
function generateSourceMap(modules) {
  const sourceMap = {
    version: 3,
    file: 'youtube.user.js',
    sources: [],
    sourcesContent: [],
    names: [],
    mappings: '',
  };

  let _generatedLine = 1;

  // Add metadata header lines
  const metadataLines = 20; // Approximate header size
  _generatedLine += metadataLines;

  for (const module of modules) {
    const sourcePath = path.relative(ROOT, path.join(module.dir, module.name)).replace(/\\/g, '/');
    sourceMap.sources.push(sourcePath);

    try {
      const content = fs.readFileSync(path.join(module.dir, module.name), 'utf8');
      sourceMap.sourcesContent.push(content);

      // Simple line mapping (1:1 correspondence)
      const lines = content.split('\n').length;
      for (let i = 0; i < lines; i++) {
        if (i > 0) sourceMap.mappings += ';';
        // AAAA = source 0, line 0, column 0
        sourceMap.mappings += 'AAAA';
      }
      _generatedLine += lines + 2; // +2 for module separator
    } catch (error) {
      console.error(`Failed to read module for source map: ${module.name}`, error);
      sourceMap.sourcesContent.push('');
    }
  }

  return sourceMap;
}

/**
 * Add inline source map to build output
 * @param {string} outputPath - Path to the built userscript
 * @param {Array} modules - Array of module metadata
 */
function addSourceMapToFile(outputPath, modules) {
  try {
    const content = fs.readFileSync(outputPath, 'utf8');
    const sourceMap = generateSourceMap(modules);
    const sourceMapComment = `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(sourceMap)).toString('base64')}\n`;

    fs.writeFileSync(outputPath, content + sourceMapComment, 'utf8');
    console.log('✓ Source map added to build output');
  } catch (error) {
    console.error('Failed to add source map:', error);
  }
}

/**
 * Generate external source map file
 * @param {string} outputPath - Path to the built userscript
 * @param {Array} modules - Array of module metadata
 */
function generateExternalSourceMap(outputPath, modules) {
  try {
    const sourceMap = generateSourceMap(modules);
    const mapPath = outputPath + '.map';

    fs.writeFileSync(mapPath, JSON.stringify(sourceMap, null, 2), 'utf8');
    console.log(`✓ Source map written to ${path.basename(mapPath)}`);

    // Add reference to source map in the build output
    const content = fs.readFileSync(outputPath, 'utf8');
    const sourceMapReference = `\n//# sourceMappingURL=${path.basename(mapPath)}\n`;
    fs.writeFileSync(outputPath, content + sourceMapReference, 'utf8');
  } catch (error) {
    console.error('Failed to generate external source map:', error);
  }
}

module.exports = {
  generateSourceMap,
  addSourceMapToFile,
  generateExternalSourceMap,
};

// CLI usage
if (require.main === module) {
  if (!fs.existsSync(BUILD_OUTPUT)) {
    console.error('Build output not found. Run `npm run build` first.');
    process.exit(1);
  }

  const buildOrder = require('./build.order.json');
  const srcDir = path.join(ROOT, 'src');
  const modules = buildOrder.map(name => ({
    name,
    dir: srcDir,
    startLine: 0,
    endLine: 0,
  }));

  const args = process.argv.slice(2);
  if (args.includes('--inline')) {
    addSourceMapToFile(BUILD_OUTPUT, modules);
  } else {
    generateExternalSourceMap(BUILD_OUTPUT, modules);
  }
}
