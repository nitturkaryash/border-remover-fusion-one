// electron/utils/logger.js
// This module will set up and provide a logger (e.g., Winston).

const { createLogger, format, transports } = require('winston');

// For cross-platform logging, use app.getPath('userData') from electron
// Example: const logsDir = require('electron').app.getPath('logs');
// This is better when used within Electron's main/renderer context post-app-ready

// Basic setup for a file logger. In a real app, use app.getPath('logs') from Electron.
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'black-border-remover' },
  transports: [
    // In a real app, get path from app.getPath('logs')
    // new transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error' }),
    // new transports.File({ filename: path.join(logsDir, 'combined.log') })
    new transports.Console({
        format: format.combine(
            format.colorize(),
            format.simple()
        )
    })
  ]
});

// Handle EPIPE errors gracefully when process exits
if (logger.transports[0] && logger.transports[0].stream) {
  logger.transports[0].stream.on('error', (err) => {
    if (err.code !== 'EPIPE') {
      console.error('Logger stream error:', err);
    }
  });
}

// If not in production, also log to the console
// if (process.env.NODE_ENV !== 'production') {
//   logger.add(new transports.Console({
//     format: format.simple()
//   }));
// }

// It's better to initialize and use this logger within Electron's main process
// and potentially expose a logging function via IPC if renderer needs to log specific messages through it.
// For now, this sets up Winston but its usage will be integrated into main.js or other backend modules.

console.log('[Logger] Winston logger configured (console transport only for now).');
console.log('[Logger] For file logging, integrate with app.getPath("logs") in Electron main process.');

module.exports = logger; 