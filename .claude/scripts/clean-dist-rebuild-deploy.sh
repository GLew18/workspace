#!/usr/bin/env bash
cd "C:\Users\jonle\Dropbox\Gabriel\AI Projects\Work Wave\app" && rm -rf dist && npm run build:deploy > "$TEMP/build_log.txt" 2>&1; echo "EXIT: $?"; tail -5 "$TEMP/build_log.txt"
