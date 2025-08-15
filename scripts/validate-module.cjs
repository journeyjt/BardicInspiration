#!/usr/bin/env node

/**
 * FoundryVTT Module Validation Script
 * Validates module structure and manifest before release
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 FoundryVTT Module Validation\n');

let hasErrors = false;

function logError(message) {
  console.log(`❌ ${message}`);
  hasErrors = true;
}

function logSuccess(message) {
  console.log(`✅ ${message}`);
}

function logWarning(message) {
  console.log(`⚠️  ${message}`);
}

// 1. Check if module.json exists
if (!fs.existsSync('module.json')) {
  logError('module.json not found!');
  process.exit(1);
}

// 2. Validate JSON syntax
let manifest;
try {
  const manifestContent = fs.readFileSync('module.json', 'utf8');
  manifest = JSON.parse(manifestContent);
  logSuccess('Valid JSON syntax');
} catch (error) {
  logError(`Invalid JSON syntax: ${error.message}`);
  process.exit(1);
}

// 3. Check required fields
const requiredFields = ['id', 'title', 'description', 'version', 'compatibility'];
const missingFields = requiredFields.filter(field => !manifest[field]);

if (missingFields.length > 0) {
  logError(`Missing required fields: ${missingFields.join(', ')}`);
} else {
  logSuccess('All required fields present');
}

// 4. Validate compatibility
if (manifest.compatibility) {
  if (!manifest.compatibility.minimum) {
    logError('Missing compatibility.minimum field');
  } else {
    logSuccess(`Minimum Foundry version: ${manifest.compatibility.minimum}`);
  }
  
  if (manifest.compatibility.verified) {
    logSuccess(`Verified Foundry version: ${manifest.compatibility.verified}`);
  }
} else {
  logError('Missing compatibility information');
}

// 5. Check referenced files exist
const filesToCheck = [];

// Check esmodules
if (manifest.esmodules && Array.isArray(manifest.esmodules)) {
  filesToCheck.push(...manifest.esmodules.map(file => ({ type: 'esmodule', path: file })));
}

// Check styles
if (manifest.styles && Array.isArray(manifest.styles)) {
  filesToCheck.push(...manifest.styles.map(file => ({ type: 'style', path: file })));
}

// Check languages
if (manifest.languages && Array.isArray(manifest.languages)) {
  manifest.languages.forEach(lang => {
    if (lang.path) {
      filesToCheck.push({ type: 'language', path: lang.path });
    }
  });
}

// Check templates
if (manifest.templates && Array.isArray(manifest.templates)) {
  filesToCheck.push(...manifest.templates.map(file => ({ type: 'template', path: file })));
}

// Validate file existence
filesToCheck.forEach(({ type, path: filePath }) => {
  if (fs.existsSync(filePath)) {
    logSuccess(`${type} file exists: ${filePath}`);
  } else {
    // For built files, check if source exists
    if (filePath.startsWith('dist/')) {
      const srcPath = filePath.replace('dist/', 'src/').replace('.js', '.ts');
      if (fs.existsSync(srcPath)) {
        logWarning(`${type} source file exists: ${srcPath} (will be built to ${filePath})`);
      } else {
        logError(`Missing ${type} file and source: ${filePath} and ${srcPath}`);
      }
    } else {
      logError(`Missing ${type} file: ${filePath}`);
    }
  }
});

// 6. Check for common files
const commonFiles = [
  { name: 'LICENSE', required: false },
  { name: 'README.md', required: false },
  { name: '.gitignore', required: false }
];

commonFiles.forEach(({ name, required }) => {
  if (fs.existsSync(name)) {
    logSuccess(`${name} found`);
  } else if (required) {
    logError(`Missing required file: ${name}`);
  } else {
    logWarning(`Recommended file missing: ${name}`);
  }
});

// 7. Validate version format
const versionRegex = /^\d+\.\d+\.\d+(-.*)?$/;
if (!versionRegex.test(manifest.version)) {
  logError(`Invalid version format: ${manifest.version} (expected semver: x.y.z)`);
} else {
  logSuccess(`Valid version format: ${manifest.version}`);
}

// 8. Check for placeholder values
const checkPlaceholders = (obj, path = '') => {
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = path ? `${path}.${key}` : key;
    
    if (typeof value === 'string') {
      if (value.includes('yourusername') || value.includes('Your Name') || value.includes('your.email')) {
        logWarning(`Placeholder value detected in ${fullPath}: ${value}`);
      }
    } else if (typeof value === 'object' && value !== null) {
      checkPlaceholders(value, fullPath);
    }
  }
};

checkPlaceholders(manifest);

// 9. Summary
console.log('\n📊 Validation Summary:');
if (hasErrors) {
  console.log('❌ Validation failed! Please fix the errors above before releasing.');
  process.exit(1);
} else {
  console.log('✅ Module validation passed! Ready for release.');
  console.log('\n🚀 To create a release:');
  console.log('  1. Commit your changes');
  console.log('  2. Create a new release on GitHub');
  console.log('  3. The release workflow will handle the rest automatically');
}