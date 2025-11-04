# GitHub Setup Guide

Your repository is now initialized and ready to push to GitHub!

## ✅ What's Already Done

1. ✅ Git repository initialized
2. ✅ `.gitignore` configured (`.env` file is excluded for security)
3. ✅ Initial commit created
4. ✅ All code files staged and committed

## 🚀 Next Steps: Push to GitHub

### Step 1: Create a GitHub Repository

1. Go to [GitHub.com](https://github.com) and sign in
2. Click the **"+"** icon in the top right → **"New repository"**
3. Fill in:
   - **Repository name**: `gametracker` (or your preferred name)
   - **Description**: "Video game tracking app similar to Goodreads"
   - **Visibility**: Choose Public or Private
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
4. Click **"Create repository"**

### Step 2: Connect and Push

After creating the repository, GitHub will show you commands. Use these:

```bash
# Add your GitHub repository as remote (replace YOUR_USERNAME and REPO_NAME)
git remote add origin https://github.com/DeidaTypes/gametracker.git

# Push your code to GitHub
git branch -M main
git push -u origin main
```

**Example:**
```bash
git remote add origin https://github.com/johndoe/gametracker.git
git branch -M main
git push -u origin main
```

## 💡 Making Changes Without Committing

You can now make changes locally without committing:

- **Edit files**: Make any changes you want
- **Test locally**: Run `npm run dev` to test
- **Check status**: `git status` to see what changed
- **Compare changes**: `git diff` to see what you modified

**When you're ready to save to GitHub:**
```bash
git add .
git commit -m "Description of your changes"
git push
```

## 🔒 Important: Your `.env` File

Your `.env` file is **NOT** committed to GitHub (it's in `.gitignore`). This is **good** for security!

**To set up on a new machine:**
1. Clone the repo: `git clone https://github.com/YOUR_USERNAME/REPO_NAME.git`
2. Copy `.env.example` to `.env`: `cp .env.example .env`
3. Add your API keys to `.env`
4. Install dependencies: `npm install`
5. Run: `npm run dev`

## 📝 Common Git Commands

```bash
# See what files changed
git status

# See what changed in a file
git diff

# Add specific file
git add src/App.jsx

# Add all changes
git add .

# Commit changes
git commit -m "Your commit message"

# Push to GitHub
git push

# Pull latest from GitHub
git pull

# Create a new branch (for experiments)
git checkout -b feature-name

# Switch back to main branch
git checkout main
```

## 🎯 Workflow Tips

1. **Make changes locally** - Edit files, test with `npm run dev`
2. **Review changes** - Use `git status` and `git diff`
3. **Commit when ready** - When you're happy with changes
4. **Push to GitHub** - To backup and share your code

You can make unlimited local changes without committing - Git tracks everything locally until you commit!

