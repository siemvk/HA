rm -rf ~/Documents/HA/nobg
rsync -av --exclude 'node_modules' --exclude '.git' ~/Documents/nobg ~/Documents/HA
git add nobg
git commit -sm "Bump nobg"
git push