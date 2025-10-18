#!/usr/bin/env node
/**
 * Cleanup script to kill orphaned processes on port 9000
 * Run before starting dev server to avoid port conflicts
 */

const { execSync } = require('child_process');
const os = require('os');

const PORT = 9000;
const platform = os.platform();

console.log('[Cleanup] Checking for processes on port', PORT);

try {
  let command;

  if (platform === 'darwin' || platform === 'linux') {
    // macOS and Linux: use lsof to find process using the port
    command = `lsof -ti:${PORT}`;
  } else if (platform === 'win32') {
    // Windows: use netstat to find process
    command = `netstat -ano | findstr :${PORT}`;
  } else {
    console.log('[Cleanup] Unsupported platform:', platform);
    process.exit(0);
  }

  try {
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });

    if (!output || output.trim() === '') {
      console.log('[Cleanup] No processes found on port', PORT);
      process.exit(0);
    }

    if (platform === 'darwin' || platform === 'linux') {
      // PIDs are returned one per line
      const pids = output.trim().split('\n').filter(Boolean);

      if (pids.length === 0) {
        console.log('[Cleanup] No processes found on port', PORT);
        process.exit(0);
      }

      console.log(`[Cleanup] Found ${pids.length} process(es) on port ${PORT}:`, pids.join(', '));

      pids.forEach(pid => {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          console.log(`[Cleanup] Killed process ${pid}`);
        } catch (err) {
          console.warn(`[Cleanup] Could not kill process ${pid} (may already be dead)`);
        }
      });
    } else if (platform === 'win32') {
      // Parse Windows netstat output to extract PID
      const lines = output.trim().split('\n');
      const pids = new Set();

      lines.forEach(line => {
        const match = line.match(/\s+(\d+)\s*$/);
        if (match) {
          pids.add(match[1]);
        }
      });

      if (pids.size === 0) {
        console.log('[Cleanup] No processes found on port', PORT);
        process.exit(0);
      }

      console.log(`[Cleanup] Found ${pids.size} process(es) on port ${PORT}`);

      pids.forEach(pid => {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
          console.log(`[Cleanup] Killed process ${pid}`);
        } catch (err) {
          console.warn(`[Cleanup] Could not kill process ${pid} (may already be dead)`);
        }
      });
    }

    console.log('[Cleanup] Port cleanup complete');
  } catch (findError) {
    // Command returned non-zero exit code, likely meaning no processes found
    if (findError.status === 1) {
      console.log('[Cleanup] No processes found on port', PORT);
    } else {
      console.warn('[Cleanup] Error finding processes:', findError.message);
    }
  }
} catch (error) {
  console.error('[Cleanup] Unexpected error:', error.message);
  // Don't fail the build, just warn
  process.exit(0);
}
