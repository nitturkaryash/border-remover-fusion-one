# Quick Start - Black Border Remover

## Run the App

```bash
npm run electron:dev
```

That's it! The app will:
1. Start the Vite dev server on `http://localhost:9000`
2. Launch Electron with your app
3. Open DevTools for debugging

## If the App Doesn't Start

### Issue: "Got Electron binary path instead of API"

**Quick Fix:**
```bash
# Update to Node 18 LTS (most compatible)
nvm install 18
nvm use 18
npm install
npm run electron:dev
```

### Issue: Port 9000 Already in Use

**Quick Fix:**
```bash
npm run cleanup
npm run electron:dev
```

### Issue: Blank Electron Window

**Check:**
1. Is Vite running? (Should see "VITE ready" in terminal)
2. Is DevTools open? (Should see DevTools panel)
3. Check DevTools console for errors

### Issue: "Processing API not available" in UI

**This means:**
- App started but Electron IPC bridge didn't load
- Try: Click "Select Images" button and check the browser console
- If you see error in DevTools, take a screenshot and share the error

## Available Scripts

```bash
npm run dev              # Start Vite dev server only
npm run build            # Build React app for production
npm run preview          # Preview production build
npm run electron:dev     # Development with Electron (RECOMMENDED)
npm run electron:build   # Build production Electron app
npm run cleanup          # Kill stray processes on port 9000
```

## Folder Structure

```
electron/              # Electron main process code
├── main.js           # Entry point - ENHANCED for debugging
├── preload.js        # Secure IPC bridge
└── processors/       # Image processing logic
    ├── BorderDetector.js
    └── ImageBatch.js

src/                   # React frontend
├── components/       # React components
├── store/            # Zustand state management
└── hooks/            # Custom React hooks

scripts/              # Build scripts
└── cleanup.js        # Port cleanup utility (NEW)
```

## Troubleshooting Flowchart

```
Does "npm run electron:dev" start?
  │
  ├─ YES → Is Vite server running?
  │         │
  │         ├─ YES → Is Electron window opening?
  │         │         │
  │         │         ├─ YES → Is it showing the app?
  │         │         │         │
  │         │         │         ├─ YES → Success! 🎉
  │         │         │         │
  │         │         │         └─ NO → Check DevTools console for errors
  │         │         │
  │         │         └─ NO → Try: pkill -9 Electron && npm run electron:dev
  │         │
  │         └─ NO → Try: npm run cleanup && npm run electron:dev
  │
  └─ NO → Check error message:
           │
           ├─ "Got Electron binary path" → Try: nvm install 18 && npm install
           │
           ├─ "EADDRINUSE" → Try: npm run cleanup
           │
           └─ Other → Try: rm -rf node_modules && npm install
```

## Key Features (Once Working)

✅ Drag-and-drop image files
✅ Batch process up to 500 images
✅ Auto-detect and remove black borders
✅ Support: JPG, PNG, TIFF, PDF
✅ Convert to: Original, JPG, PNG, PDF, SVG, WebP
✅ Real-time progress tracking
✅ Save results to dated folders

## First Time Using?

1. Run: `npm run electron:dev`
2. Electron window should open
3. Try dragging an image file into the window
4. Click "Process Images"
5. Check `~/Pictures/YYYY-MM-DD_processed/` for results

## Debugging Help

Open the **DevTools** (F12 or Cmd+Option+I) and look for:

- ✅ Console logs starting with `[Main]` - Electron main process
- ✅ Console logs starting with `[Preload]` - Preload script loading
- ✅ Console logs from React components - Frontend

Common debug messages:
- `✅ Electron module loaded` - Good!
- `❌ Native binding failed` - System issue (use Node 18)
- `⚠️ Got Electron binary path` - Electron not fully initialized

## Performance Tips

- **First load**: ~3-5 seconds (normal)
- **Image processing**: ~0.5-2 seconds per image (depends on size)
- **Batch 100 images**: ~30-60 seconds (depends on file sizes)

For best performance:
- Use high-quality JPG/PNG files (not super large)
- Close other apps to free up RAM
- Keep images under 10MB each

## Next Steps

1. **Try the app**: Run `npm run electron:dev` and process some images
2. **Build for release**: Run `npm run electron:build` when ready
3. **Share feedback**: Open an issue on GitHub with error details

## Environment Variables

Optional - set before running:

```bash
# Use a specific port for Vite
export VITE_PORT=3000

# Set production build target
export NODE_ENV=production

# Enable debug logging
export DEBUG=*

# Then run:
npm run electron:dev
```

## Still Having Issues?

See the full guide: [ELECTRON_FIX_GUIDE.md](ELECTRON_FIX_GUIDE.md)
