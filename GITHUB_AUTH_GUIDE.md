# GitHub Authentication Guide

GitHub requires authentication to push code. You have **two main options**:

## Option 1: Personal Access Token (Easiest) ⭐ Recommended

### Step 1: Create a Personal Access Token

1. Go to GitHub.com and sign in
2. Click your profile picture (top right) → **Settings**
3. Scroll down to **Developer settings** (left sidebar)
4. Click **Personal access tokens** → **Tokens (classic)**
5. Click **Generate new token** → **Generate new token (classic)**
6. Give it a name: `GameTracker App`
7. Select expiration: Choose how long (30 days, 90 days, or no expiration)
8. Check these permissions:
   - ✅ **repo** (Full control of private repositories)
9. Click **Generate token**
10. **IMPORTANT**: Copy the token immediately (you won't see it again!)
   - It will look like: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### Step 2: Use the Token to Push

When you run `git push`, it will ask for:
- **Username**: Your GitHub username (`DeidaTypes`)
- **Password**: Paste your **Personal Access Token** (not your GitHub password!)

```bash
git push -u origin main
```

**Note**: You can also store your credentials so you don't have to enter them every time (see below).

---

## Option 2: SSH Keys (More Secure, Better Long-term)

### Step 1: Check if you have SSH keys

```bash
ls -al ~/.ssh
```

If you see `id_rsa.pub` or `id_ed25519.pub`, you already have keys.

### Step 2: Generate SSH Key (if needed)

```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

Press Enter to accept default location. Optionally set a passphrase.

### Step 3: Add SSH Key to GitHub

1. Copy your public key:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```
   (or `cat ~/.ssh/id_rsa.pub` if using RSA)

2. Go to GitHub.com → Settings → **SSH and GPG keys**
3. Click **New SSH key**
4. Title: `My MacBook` (or your computer name)
5. Paste the key content
6. Click **Add SSH key**

### Step 4: Change Remote URL to SSH

```bash
git remote set-url origin git@github.com:DeidaTypes/gametracker.git
git push -u origin main
```

---

## Option 3: GitHub CLI (gh) - Easiest for Beginners

Install GitHub CLI:
```bash
brew install gh
```

Authenticate:
```bash
gh auth login
```

Follow the prompts. Then push normally:
```bash
git push -u origin main
```

---

## 🔐 Store Credentials (Avoid Re-entering)

### For HTTPS (Personal Access Token):

**macOS Keychain** (Automatic):
```bash
git config --global credential.helper osxkeychain
```

Then push - it will save your token in macOS Keychain.

### For SSH:
No need to store - SSH keys handle this automatically!

---

## ✅ Quick Test

After setting up authentication, try:

```bash
git push -u origin main
```

If successful, you'll see:
```
Enumerating objects: X, done.
Counting objects: 100% (X/X), done.
Writing objects: 100% (X/X), done.
To https://github.com/DeidaTypes/gametracker.git
 * [new branch]      main -> main
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

Then visit: https://github.com/DeidaTypes/gametracker to see your code!

---

## 🆘 Troubleshooting

**"Authentication failed"**
- Make sure you're using a Personal Access Token (not password)
- Check the token has `repo` permissions
- Try using SSH instead

**"Permission denied"**
- Verify you have access to the repository
- Check repository visibility (public/private)

**"Repository not found"**
- Verify the repository name: `gametracker`
- Check your username: `DeidaTypes`
- Make sure the repository exists on GitHub

