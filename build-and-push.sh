#!/bin/bash
set -o verbose

CURRENT_HASH="$(git rev-parse HEAD)"
echo "Currently on $CURRENT_HASH"

rm -rf node_modules
npm install --production

# ..and any build steps..

git add node_modules --force  # also any build directory

git commit -a -m "Compiled Version ($OSTYPE)"
git merge origin/compiled -s recursive -X ours -m "Merge master into compiled"
git push origin HEAD:compiled --force

git reset --hard $CURRENT_HASH
