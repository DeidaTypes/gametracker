#!/bin/bash
# iOS Build & Sync Script
# Usage: ./build-ios.sh

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}📱 iOS Build & Sync Script${NC}"
echo "=============================="
echo ""

# Set required environment variables
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
export LANG=en_US.UTF-8

# Navigate to project directory
cd "$(dirname "$0")"

# Check if Node 20+ is available
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}❌ Error: Node.js 20+ is required${NC}"
    echo "Current version: $(node --version)"
    echo "Run: brew install node@20"
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js version: $(node --version)"
echo ""

# Step 1: Build the web app
echo -e "${BLUE}Step 1:${NC} Building web app..."
npm run build
echo -e "${GREEN}✓${NC} Build completed"
echo ""

# Step 2: Sync with iOS
echo -e "${BLUE}Step 2:${NC} Syncing with iOS..."
npx cap sync ios
echo -e "${GREEN}✓${NC} Sync completed"
echo ""

# Step 3: Open in Xcode
echo -e "${BLUE}Step 3:${NC} Opening Xcode..."
npx cap open ios
echo -e "${GREEN}✓${NC} Xcode opened"
echo ""

echo -e "${GREEN}✅ Done!${NC}"
echo ""
echo "Next steps in Xcode:"
echo "1. Select a simulator (e.g., iPhone 15 Pro)"
echo "2. Click the Play button (▶️) or press Cmd + R"
echo "3. Wait for build to complete"
echo ""
echo -e "${BLUE}💡 Tip:${NC} For development with live reload, see IOS_BUILD_GUIDE.md"

