/**
 * Simple logger with timestamps for PM2 logs
 */

function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export function log(...args) {
  console.log(`[${getTimestamp()}]`, ...args);
}

export function error(...args) {
  console.error(`[${getTimestamp()}]`, ...args);
}

export function warn(...args) {
  console.warn(`[${getTimestamp()}]`, ...args);
}

export default { log, error, warn };
