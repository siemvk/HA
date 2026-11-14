#!/bin/bash
set -e

echo "Building nobg on host..."
cd ~/Documents/nobg
pnpm run build

echo "Syncing to HA repo..."
rm -rf ~/Documents/HA/nobg
rsync -av --exclude 'node_modules' --exclude '.git' ~/Documents/nobg ~/Documents/HA

cd ~/Documents/HA
git add nobg copy.sh
git commit -sm "Bump nobg (pre-compiled build)"
git push
echo "Done! Ready to rebuild in Home Assistant."