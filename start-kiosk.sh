#!/bin/bash

# Required packages installation commented out - uncomment if needed
# sudo apt install -y xorg firefox-esr openbox x11-xserver-utils

# Create Firefox preferences directory if it doesn't exist
mkdir -p ~/.mozilla/firefox/kiosk.default

# Create a Firefox profile with specific settings
cat > ~/.mozilla/firefox/kiosk.default/prefs.js << EOF
user_pref("browser.rights.3.shown", true);
user_pref("browser.startup.homepage", "http://shape-z.de:5173/");
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.sessionstore.enabled", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.startup.page", 1);
user_pref("browser.startup.homepage_override.mstone", "ignore");
EOF

# Start X server with Openbox on virtual terminal 1
startx /usr/bin/openbox-session -- vt1 &

# Wait for X server to start
sleep 3

# Launch Firefox in kiosk mode with the custom profile
DISPLAY=:0 firefox --kiosk --profile ~/.mozilla/firefox/kiosk.default http://shape-z.de:5173/