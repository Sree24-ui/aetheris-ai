#!/bin/bash
#
# Commit as an explicitly named team member.
#
# This replaces a script that picked one of five identities at random and then
# ran `git config user.name/user.email`, permanently rewriting the checkout's
# identity as a side effect of committing. That is unsafe in two ways: the
# authorship of a commit became a coin flip, and every later commit — however
# it was made — inherited whichever identity the last roll happened to leave
# behind. It also made the history unusable as a record of who wrote what.
#
# The replacement never randomises and never mutates repository config: the
# identity is passed per invocation with `git -c`, which applies to that one
# commit only. Local developer convenience script; nothing in the app or the
# build depends on it.
#
# Usage:
#   ./git-random.sh <identity> [git commit args...]
#   ./git-random.sh --list
#
# Example:
#   ./git-random.sh sree -m "fix: clamp learning path index"

set -euo pipefail

# name|email, keyed by the short handle passed on the command line.
declare -A IDENTITIES=(
  [chitrangad]="Chitrangad Ram Sapate|chitrangad-ram-sapate@users.noreply.github.com"
  [ruturaj]="Ruturaj|ruturajnalbalwar-arch@users.noreply.github.com"
  [soham]="Soham Joshi|Physics0070@users.noreply.github.com"
  [atharva]="Atharva5607|Atharva5607@users.noreply.github.com"
  [sree]="Sree24-ui|Sree24-ui@users.noreply.github.com"
)

usage() {
  echo "Usage: $0 <identity> [git commit args...]"
  echo
  echo "Known identities:"
  for key in "${!IDENTITIES[@]}"; do
    echo "  $key  ->  ${IDENTITIES[$key]%|*} <${IDENTITIES[$key]#*|}>"
  done
  echo
  echo "Commit as yourself with plain 'git commit' instead."
}

if [[ $# -eq 0 || "${1:-}" == "--help" || "${1:-}" == "-h" || "${1:-}" == "--list" ]]; then
  usage
  # No identity given is an error, not a prompt to guess one.
  [[ "${1:-}" == "--list" || "${1:-}" == "--help" || "${1:-}" == "-h" ]] && exit 0
  exit 1
fi

KEY="$1"
shift

if [[ -z "${IDENTITIES[$KEY]:-}" ]]; then
  echo "Unknown identity: $KEY" >&2
  echo >&2
  usage >&2
  exit 1
fi

NAME="${IDENTITIES[$KEY]%|*}"
EMAIL="${IDENTITIES[$KEY]#*|}"

echo "Committing as: $NAME <$EMAIL> (this invocation only)"
# -c applies the identity to this command alone. `git config` is deliberately
# not called: the checkout's own user.name/user.email are left untouched.
git -c "user.name=$NAME" -c "user.email=$EMAIL" commit "$@"
