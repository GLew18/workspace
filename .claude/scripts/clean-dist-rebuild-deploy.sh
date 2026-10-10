#!/usr/bin/env bash
# A Dropbox lock on dist/music-lib can make the rm fail (10/9). That must NOT skip
# the build, or dist is left half-deleted and a deploy ships an empty site.
cd "C:\Users\jonle\Dropbox\Gabriel\AI Projects\Work Wave\app" || exit 1
rm -rf dist || echo "rm: dist partly locked, building over it"
npm run build:deploy > "$TEMP/build_log.txt" 2>&1; code=$?
echo "EXIT: $code"; tail -5 "$TEMP/build_log.txt"
[ -f dist/index.html ] || { echo "MISSING dist/index.html - DO NOT DEPLOY"; exit 1; }
exit $code
