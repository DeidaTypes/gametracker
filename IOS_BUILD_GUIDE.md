# 📱 iOS Simulator Build Guide

This guide will help you build and run your app on the iPhone simulator.

## Prerequisites Check

Your current setup:
- ✅ Capacitor iOS configured
- ✅ Xcode installed (detected from project structure)
- ⚠️  Node.js v18.16.0 (needs upgrade to v20+)

## Step 1: Upgrade Node.js to v20+

Capacitor CLI requires Node.js 20 or higher. Let's upgrade using Homebrew:

```bash
# Upgrade Node.js to the latest LTS version (v20+)
brew upgrade node

# Verify the new version (should be 20.x or higher)
node --version
```

**Important:** After upgrading Node, you may need to restart your terminal or run:
```bash
hash -r
```

## Step 2: Build Your React App

Before syncing with iOS, you need to build the production version of your web app:

```bash
cd "/Users/ryandeida/Cursor test"

# Build the production app (creates /dist folder)
npm run build
```

This will create an optimized production build in the `dist` folder.

## Step 3: Sync with Capacitor iOS

After building, sync the web app with your iOS project:

```bash
# Sync web assets to iOS
npx cap sync ios

# Or, if you want to update dependencies too:
npx cap update ios
```

This command:
- Copies your built web app (from `dist/`) to the iOS project
- Updates Capacitor dependencies
- Syncs any plugin changes

## Step 4: Open in Xcode

```bash
# Open the iOS project in Xcode
npx cap open ios
```

This will open your project in Xcode.

## Step 5: Run on iPhone Simulator

Once Xcode opens:

1. **Select a simulator** from the device dropdown at the top (e.g., "iPhone 15 Pro")
2. **Click the Play button** (▶️) or press `Cmd + R` to build and run
3. Wait for the build to complete (first build may take a few minutes)
4. The simulator will launch with your app

## 🔧 Development Workflow

### Option A: Live Reload (Recommended for Development)

Instead of building every time, you can run the app with live reload:

```bash
# 1. Make sure your dev server is running
npm run dev

# 2. Open another terminal and sync
npx cap sync ios

# 3. Open in Xcode
npx cap open ios

# 4. In Xcode, run on simulator
```

Then in your `capacitor.config.json`, add:

```json
{
  "appId": "com.ryan.Checkpoint",
  "appName": "Checkpoint",
  "webDir": "dist",
  "server": {
    "url": "http://localhost:5173",
    "cleartext": true
  }
}
```

**Important:** Remember to remove the `server` config before building for production!

### Option B: Production Build (For Testing Production App)

```bash
# 1. Build production
npm run build

# 2. Sync to iOS
npx cap sync ios

# 3. Open and run
npx cap open ios
```

## 🐛 Troubleshooting

### "Capacitor CLI requires NodeJS >=20.0.0"
- Run: `brew upgrade node`
- Verify: `node --version` (should show 20.x or higher)
- Restart terminal if needed

### "webDir does not exist"
- Make sure you ran `npm run build` first
- Check that the `dist` folder exists

### "No such module 'Capacitor'"
- Run: `npx cap sync ios`
- Clean build in Xcode: Product → Clean Build Folder (Shift + Cmd + K)

### Simulator Not Showing App
- Check that you're using iOS 15+ simulator (older versions may not be supported)
- Try: Product → Clean Build Folder, then rebuild

### API Not Working on Simulator
- Make sure your dev server is running (`npm run dev`)
- Check that `server.url` in `capacitor.config.json` is set correctly
- Ensure your Mac firewall allows local network connections

## 📋 Quick Reference Commands

```bash
# Upgrade Node
brew upgrade node

# Build web app
npm run build

# Sync to iOS
npx cap sync ios

# Open in Xcode
npx cap open ios

# View Capacitor info
npx cap doctor

# Clean and rebuild
npx cap sync ios --force
```

## 🚀 Testing Your Search & API

Once the app is running on the simulator:

1. Check if games load on the home page
2. Try the search function
3. Check browser console in Xcode:
   - Debug → Open Console (or `Cmd + Shift + C`)
   - Look for any API errors

If you see API errors, you may need to configure CORS or use the live reload option with `server.url` pointing to your dev server.

