#!/usr/bin/env node

/**
 * Simple module validation script
 */

const fs = require('fs');
const path = require('path');

console.log('📋 Validating module structure...');

// Check if module.json exists
const moduleJsonPath = path.join(__dirname, '..', 'module.json');
if (!fs.existsSync(moduleJsonPath)) {
  console.error('❌ module.json not found');
  process.exit(1);
}

// Parse and validate module.json
try {
  const moduleJson = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf8'));
  
  // Check required fields
  const requiredFields = ['id', 'title', 'version', 'compatibility'];
  for (const field of requiredFields) {
    if (!moduleJson[field]) {
      console.error(`❌ Missing required field: ${field}`);
      process.exit(1);
    }
  }
  
  console.log(`✅ Module "${moduleJson.title}" (${moduleJson.version}) validation passed`);
  
} catch (error) {
  console.error('❌ Invalid module.json:', error.message);
  process.exit(1);
}

console.log('✅ Module validation complete');