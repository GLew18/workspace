#!/usr/bin/env bash
cd "C:/Users/jonle/Dropbox/Gabriel/AI Projects/Work Wave/app" && grep -m1 -i "EPERM\|error" "$TEMP/build.log"; rm -rf dist && ls dist 2>&1 | head -1; npm run build:deploy > "$TEMP/build.log" 2>&1; echo "exit: $?"; tail -4 "$TEMP/build.log"; ls dist/music-lib | wc -l; ls dist/index.html
