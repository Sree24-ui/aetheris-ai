#!/bin/bash
R=$((RANDOM % 5))
case $R in
    0) NAME="Chitrangad Ram Sapate"; EMAIL="chitrangad-ram-sapate@users.noreply.github.com";;
    1) NAME="Ruturaj"; EMAIL="ruturajnalbalwar-arch@users.noreply.github.com";;
    2) NAME="Soham Joshi"; EMAIL="Physics0070@users.noreply.github.com";;
    3) NAME="Atharva5607"; EMAIL="Atharva5607@users.noreply.github.com";;
    4) NAME="Sree24-ui"; EMAIL="Sree24-ui@users.noreply.github.com";;
esac
echo "🎲 Routing commit authority to: $NAME"
git config user.name "$NAME"
git config user.email "$EMAIL"
git commit "$@"
