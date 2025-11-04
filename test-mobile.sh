#!/bin/bash

# Mobile Testing Helper Script

echo "🚀 Starting GameTracker for Mobile Testing"
echo ""

# Get local IP address
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    IP=$(ipconfig getifaddr en0 2>/dev/null || ifconfig | grep "inet " | grep -v 127.0.0.1 | head -1 | awk '{print $2}')
else
    # Linux
    IP=$(hostname -I | awk '{print $1}')
fi

if [ -z "$IP" ]; then
    echo "⚠️  Could not determine IP address"
    echo "   You can still use: http://localhost:5173"
else
    echo "📱 Your local IP: $IP"
    echo ""
    echo "🌐 Access from your phone/simulator:"
    echo "   http://$IP:5173"
    echo ""
    echo "💻 Or on this computer:"
    echo "   http://localhost:5173"
    echo ""
fi

echo "📋 Testing Methods:"
echo "   1. Browser DevTools: Open Chrome → DevTools → Toggle device toolbar"
echo "   2. Real Device: Use http://$IP:5173 on your phone (same Wi-Fi)"
echo "   3. iOS Simulator: Open Simulator → Safari → http://localhost:5173"
echo "   4. Android Emulator: Chrome → http://10.0.2.2:5173"
echo ""
echo "🔍 Chrome DevTools: Cmd+Shift+M (Mac) or Ctrl+Shift+M (Windows)"
echo ""
echo "Starting dev server..."
echo ""

npm run dev

