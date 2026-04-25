# IGDB API Setup Guide

If you're seeing the error "Failed to search games. Please check your IGDB API credentials", follow these steps:

## Step 1: Get Your API Credentials

1. Go to [Twitch Developer Console](https://dev.twitch.tv/console/apps)
2. Log in with your Twitch account
3. Click "Register Your Application"
4. Fill in:
   - **Name**: Your app name (e.g., "GameTracker")
   - **OAuth Redirect URLs**: `http://localhost:5173` (for development)
   - **Category**: Choose "Website Integration"
5. Click "Create"
6. You'll see your **Client ID** and **Client Secret**

## Step 2: Create/Update Your .env File

1. In your project root directory, create or edit the `.env` file
2. Add these lines (replace with your actual credentials):

```
VITE_IGDB_CLIENT_ID=your_client_id_here
VITE_IGDB_CLIENT_SECRET=your_client_secret_here
```

**Important:**
- Do NOT put quotes around the values
- Do NOT commit the `.env` file to git (it should be in `.gitignore`)
- Make sure there are no spaces around the `=` sign

## Step 3: Restart Your Dev Server

After creating/updating the `.env` file:

1. Stop your dev server (Ctrl+C or Cmd+C)
2. Start it again: `npm run dev`
3. The app will reload with the new credentials

## Step 4: Verify It's Working

1. Open your browser's Developer Console (F12)
2. Look for these messages:
   - ✅ "IGDB API credentials loaded successfully"
   - ✅ "Access token obtained successfully"
3. Try searching for a game

## Troubleshooting

### Still seeing errors?

1. **Check the console** - Look for specific error messages
2. **Verify your .env file**:
   - Make sure it's in the project root (same folder as `package.json`)
   - Make sure the variable names are exactly: `VITE_IGDB_CLIENT_ID` and `VITE_IGDB_CLIENT_SECRET`
   - Make sure there are no typos
3. **Restart the dev server** - Environment variables are only loaded when the server starts
4. **Check your credentials** - Make sure you copied the Client ID and Client Secret correctly from Twitch

### Common Errors:

- **"Invalid API credentials"**: Your Client ID or Secret is wrong
- **"Unauthorized"**: Your credentials might be correct but the app isn't registered properly
- **"Failed to connect"**: Check your internet connection or firewall settings

### Need Help?

Check the browser console for detailed error messages. The app now provides more specific error information to help diagnose the issue.

