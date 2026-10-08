#!/bin/bash
# Refetches the bundled avatar art from DiceBear. The app never calls the API.
# Seeds are made up (style-NN), never agent names. Backgrounds are transparent.
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT=app/Messhall/Resources/Avatars
COUNT=32
rm -rf "$OUT"
for style in shapes notionists-neutral; do
  mkdir -p "$OUT/$style"
  for i in $(seq -w 1 "$COUNT"); do
    curl -fsS --retry 5 --retry-all-errors -m 30 \
      "https://api.dicebear.com/9.x/$style/png?seed=$style-$i&size=128&backgroundColor=transparent" \
      -o "$OUT/$style/$i.png"
  done
done
