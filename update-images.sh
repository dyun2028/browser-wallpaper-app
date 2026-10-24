#!/bin/sh
# Rebuilds img/images.js from the pictures in the img folder (macOS / Linux).
cd "$(dirname "$0")/img" || exit 1
{
  echo "// Made by update-images.sh. Run it again after adding or removing pictures."
  echo "window.WALLPAPERS = ["
  ls -1 | grep -iE '\.(jpe?g|png|gif|webp|avif|bmp|svg)$' | sed 's/\\/\\\\/g; s/"/\\"/g; s/.*/  "&",/'
  echo "];"
} > images.js
echo "Found $(grep -c '^  "' images.js) picture(s) in img. Refresh the app page to see them."
