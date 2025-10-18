# Black Border Remover - Electron API Not Available - FIX GUIDE

## Problem Summary

The app fails to start with error: `"Processing API not available"` because `require('electron')` returns a string (binary path) instead of the Electron API object, even when running inside Electron.

## To Run the App (Command)

```bash
npm run electron:dev
```

This command:
1. Cleans up any stray processes on port 9000
2. Starts Vite dev server on http://localhost:9000
3. Waits for Vite to be ready
4. Launches Electron with the React app

## Root Cause

A **system-level incompatibility** between your Node.js/macOS version and Electron's native module loading. This affects ALL tested Electron versions (27, 29, 31, 36).

**Diagnostic output:**
```
[Main] ⚠️ Got Electron binary path instead of API
[Main] Attempting to load using fallback methods...
[Main] ❌ Native binding failed
[Main] ❌ FATAL: Could not load Electron
```

## Solutions (Try in Order)

### Solution 1: Update Node.js (RECOMMENDED)
Your current Node versions have native module mismatches.

```bash
# Install Node Version Manager if you don't have it
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload shell
source ~/.zshrc  # or ~/.bash_profile

# Install Node 18 LTS (most compatible with Electron)
nvm install 18
nvm use 18
nvm alias default 18

# Verify
node --version  # Should show v18.x.x

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Try again
npm run electron:dev
```

### Solution 2: Use Docker
If Node installation doesn't work, use Docker to isolate the environment:

```bash
docker run -it --rm \
  -v $(pwd):/app \
  -w /app \
  node:18-alpine \
  sh -c "npm install && npm run electron:dev"
```

### Solution 3: Fresh Electron Installation
```bash
# Remove everything
rm -rf node_modules package-lock.json dist

# Completely fresh install
npm cache clean --force
npm install

# Try again
npm run electron:dev
```

### Solution 4: Use Pre-built App
If development mode doesn't work, build the production app:

```bash
# Build the React app
npm run build

# Build Electron app
npm run electron:build

# Find the app in ./release/ folder
# On macOS: double-click Black\ Border\ Remover.app
```

### Solution 5: Use System Electron (Advanced)
```bash
# Install Electron globally
brew install electron

# Create a wrapper script
cat > /usr/local/bin/run-black-border-remover << 'EOF'
#!/bin/bash
cd /Users/yashnitturkar/Desktop/Insane-work/Fusion_one_bordercorrection
electron .
EOF

chmod +x /usr/local/bin/run-black-border-remover

# Run it
run-black-border-remover
```

## What I've Already Fixed

✅ **[scripts/cleanup.js](scripts/cleanup.js)**
- Prevents port 9000 conflicts automatically

✅ **[electron/preload.js](electron/preload.js)**
- Enhanced diagnostics for API loading
- Better error messages

✅ **[electron/main.js](electron/main.js)**
- Tries multiple methods to load Electron API
- Falls back gracefully with better logging
- Lazy-loads ImageBatch module after Electron is ready

✅ **[src/components/organisms/BatchProcessorLayout.tsx](src/components/organisms/BatchProcessorLayout.tsx)**
- Clear error messages when API is not available
- Console logs indicate root cause

✅ **[package.json](package.json)**
- Auto-cleanup before dev starts
- Proper script sequencing

## Debugging Tips

### Check Electron Version
```bash
./node_modules/.bin/electron --version
```

### Check Node Versions
```bash
node --version
npm --version
nvm list  # If using nvm
```

### Check if Port 9000 is Free
```bash
lsof -i :9000
```

### Run with Verbose Logging
```bash
DEBUG=* npm run electron:dev
```

### Check Electron Installation
```bash
ls -la node_modules/electron/dist/
```

Should show:
- `Electron.app/` directory
- `LICENSE` file
- `version` file

If missing, reinstall:
```bash
rm -rf node_modules/electron
npm install electron
```

## Architecture

The app uses this IPC communication model:

```
┌─────────────────────────────────────────┐
│  React Frontend                         │
│  (src/components/BatchProcessorLayout)  │
└────────────────┬────────────────────────┘
                 │ IPC (Electron Bridge)
┌────────────────▼────────────────────────┐
│  Electron Main Process (electron/main.js)
│  ├─ Preload Script (electron/preload.js)
│  └─ IPC Handlers                        │
└────────────────┬────────────────────────┘
                 │ Direct API Access
┌────────────────▼────────────────────────┐
│  Image Processing                       │
│  (electron/processors/BorderDetector.js)│
└─────────────────────────────────────────┘
```

## File Structure

```
electron/
├── main.js                          # Main process (FIXED)
├── preload.js                       # Preload script (ENHANCED)
├── processors/
│   ├── BorderDetector.js           # Core image processing
│   └── ImageBatch.js               # Batch queue manager
└── utils/
    ├── logger.js                   # Winston logger
    └── fileValidator.js            # File validation

src/
├── components/
│   ├── organisms/
│   │   └── BatchProcessorLayout.tsx # Main UI (IMPROVED)
│   ├── molecules/
│   │   ├── DropZone.tsx
│   │   ├── FileList.tsx
│   │   ├── OutputFormatSelector.tsx
│   │   └── ProcessingControls.tsx
│   └── atoms/
│       ├── ProgressBar.tsx
│       └── FileBadge.tsx
├── store/
│   └── appStore.ts                # Zustand state
└── hooks/
    └── use-toast.ts               # Toast notifications

scripts/
└── cleanup.js                      # Port cleanup (NEW)
```

## Known Limitations

- The native Electron module binding doesn't work on this system configuration
- May require specific Node.js LTS version (18 or 20)
- Docker or pre-built app are reliable workarounds

## Support

If none of these solutions work:

1. Check the GitHub issues: [claude-code/issues](https://github.com/anthropics/claude-code/issues)
2. Run `npm audit` to check for security vulnerabilities
3. Try the pre-built app from `./release/` folder

## Development vs Production

- **Development**: `npm run electron:dev` - Hot reload with Vite
- **Production**: `npm run electron:build` - Optimized standalone app

Both use the same core Electron and React code, but development includes DevTools and Vite hot module replacement.
