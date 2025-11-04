# How to Create the .env File

## Step-by-Step Instructions

### Option 1: Using Terminal (Recommended)

1. **Open Terminal** (or iTerm, or any terminal app)

2. **Navigate to your project directory**:
   ```bash
   cd "/Users/ryandeida/Cursor test"
   ```

3. **Create the .env file** by copying the example:
   ```bash
   cp .env.example .env
   ```

4. **Open the .env file in a text editor**:
   ```bash
   open -e .env
   ```
   
   Or if you prefer using VS Code/Cursor:
   ```bash
   code .env
   ```

5. **Replace the placeholder values** with your actual IGDB API credentials:
   ```
   VITE_IGDB_CLIENT_ID=your_actual_client_id_here
   VITE_IGDB_CLIENT_SECRET=your_actual_client_secret_here
   ```

### Option 2: Using Finder (GUI Method)

1. **Open Finder** and navigate to your project folder:
   - `/Users/ryandeida/Cursor test`

2. **Press `Cmd + Shift + .`** (Command + Shift + Period) to show hidden files

3. **Look for `.env.example`** file (if it exists)

4. **Right-click on `.env.example`** and select "Duplicate"

5. **Rename the duplicate** to `.env` (remove the `.example` part)

6. **Open `.env`** with a text editor (TextEdit, VS Code, etc.)

7. **Replace the placeholder values** with your actual credentials

### Option 3: Create from Scratch

1. **Open Terminal**:
   ```bash
   cd "/Users/ryandeida/Cursor test"
   ```

2. **Create the file**:
   ```bash
   touch .env
   ```

3. **Open it in your editor**:
   ```bash
   open -e .env
   ```

4. **Add these lines** (replace with your actual values):
   ```
   VITE_IGDB_CLIENT_ID=your_client_id_here
   VITE_IGDB_CLIENT_SECRET=your_client_secret_here
   ```

5. **Save the file**

## Getting Your IGDB API Credentials

1. **Go to**: https://dev.twitch.tv/console/apps
2. **Log in** with your Twitch account
3. **Click "Register Your Application"**
4. **Fill in the form**:
   - Name: Your app name (e.g., "GameTracker")
   - OAuth Redirect URLs: `http://localhost:5173` (or leave blank for now)
   - Category: Website
5. **Click "Create"**
6. **Copy your Client ID** (it's shown immediately)
7. **Click "Manage"** → **"New Secret"** to create a Client Secret
8. **Copy your Client Secret** (you can only see it once!)

## Example .env File Content

Your `.env` file should look like this (with your actual values):

```
VITE_IGDB_CLIENT_ID=abc123xyz456
VITE_IGDB_CLIENT_SECRET=def789uvw012
```

**Important Notes:**
- Don't include quotes around the values
- Don't add spaces around the `=` sign
- Make sure there are no extra spaces or characters
- Never commit the `.env` file to git (it's already in `.gitignore`)

## Verifying It Works

After creating your `.env` file:

1. **Restart your dev server** if it's running:
   - Stop it with `Ctrl + C`
   - Start it again with `npm run dev`

2. **Check the browser console** - if you see API errors, double-check your credentials

3. **The app should load games** from IGDB if everything is set up correctly!

