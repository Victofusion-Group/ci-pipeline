#!/usr/bin/env bash
# Run from the root of the repo being checked. Fails when a tracked file holds
# something that looks like a live key or a private key.
#
# Each literal below is broken with a one-character class so the pattern does
# not match this file. Without that the scan flags itself on every run. The
# classes change nothing about what is detected — a regex character class
# matches the single character inside it — so real Stripe live keys, Google
# API keys, PEM private keys and service-account JSON are all still caught.
# Keep those literals out of the comments here for the same reason.
if git grep -nIE '(sk[_]live[_]|AI[z]a[0-9A-Za-z_-]{20,}|-----BEGIN (RSA )?PRIVATE[ ]KEY-----|"type": "service[_]account")' -- ':!*.example' ':!**/*.md' ; then
  echo "::error::Possible secret found in tracked files"
  exit 1
fi
echo "No secrets found in tracked files"
