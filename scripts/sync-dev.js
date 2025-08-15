#!/usr/bin/env node

/**
 * Development sync script for Bardic Inspiration module
 * Copies built files to FoundryVTT Docker container
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

const CONTAINER_NAME = 'bardic-inspiration-dev';
const MODULE_PATH = '/data/Data/modules/bardic-inspiration';

function runCommand(command, description) {
  try {
    console.log(`📋 ${description}...`);
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} completed`);
  } catch (error) {
    console.error(`❌ ${description} failed:`, error.message);
    process.exit(1);
  }
}

function syncFiles() {
  console.log('🔄 Syncing development files to FoundryVTT...\n');

  // Check if container is running
  try {
    execSync(`docker exec ${CONTAINER_NAME} echo "Container is running"`, { stdio: 'pipe' });
  } catch (error) {
    console.error('❌ FoundryVTT container is not running. Start it with: npm run dev');
    process.exit(1);
  }

  // Check if dist files exist
  if (!existsSync('dist/main.js')) {
    console.error('❌ dist/main.js not found. Build first with: npm run vite:build');
    process.exit(1);
  }

  // Copy built JavaScript
  runCommand(
    `docker cp dist/main.js ${CONTAINER_NAME}:${MODULE_PATH}/dist/main.js`,
    'Copy built JavaScript'
  );

  // Copy built CSS
  if (existsSync('dist/style.css')) {
    runCommand(
      `docker cp dist/style.css ${CONTAINER_NAME}:${MODULE_PATH}/styles/main.css`,
      'Copy built CSS'
    );
  }

  // Copy templates if changed
  runCommand(
    `docker cp templates/youtube-dj.hbs ${CONTAINER_NAME}:${MODULE_PATH}/templates/`,
    'Copy templates'
  );

  // Copy language files if changed
  runCommand(
    `docker cp languages/en.json ${CONTAINER_NAME}:${MODULE_PATH}/languages/`,
    'Copy language files'
  );

  console.log('\n🎉 Sync complete! Refresh your FoundryVTT browser page.');
}

syncFiles();