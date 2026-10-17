#!/usr/bin/env bash
# Build Cobalt's landing art and report on the output (title, asset/icon counts, size).
# Output goes to a fixed temp dir (not the per-session scratchpad) so this script is reusable across sessions.
cd "C:/Users/jonle/Dropbox/Gabriel/AI Projects/Work Wave/app" && S="C:/Users/jonle/AppData/Local/Temp/cobalt-landing-art" && rm -rf "$S/landing-art" && npx vite build --base ./ --outDir "$S/landing-art" --emptyOutDir 2>&1 | tail -3; cd "$S/landing-art" && sed -i 's#<title>[^<]*</title>#<title>Cobalt Landing</title>#' index.html && grep -o "<title>[^<]*</title>" index.html; ls; ls assets | wc -l; ls icons | wc -l; du -sh .
