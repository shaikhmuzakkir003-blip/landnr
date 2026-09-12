#!/usr/bin/env bash
# inspect.sh — read the harvested engine and print, to the job log, exactly
# what it asks the network for and how it decides to boot. That is the
# evidence the local build is wired against.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/vendor/offbrand"

hr() { printf '\n=== %s\n' "$1"; }

hr "harvest"
if [ -f "$ROOT/vendor/.fetched.tsv" ]; then
  awk -F'\t' '{print $3}' "$ROOT/vendor/.fetched.tsv" | sort | uniq -c
  echo "-- missing:"
  awk -F'\t' '$3=="MISSING"{print "   "$1}' "$ROOT/vendor/.fetched.tsv" | head -40
fi

hr "files"
find "$OUT" -type f -printf '%10s  %p\n' 2>/dev/null | sort -k2 | sed "s|$OUT/||" | head -100

for f in $(find "$OUT" -name '*.js' -type f | sort); do
  hr "urls inside $(basename "$f")"
  # every absolute URL, and every quoted path that looks like an asset
  grep -oE 'https?://[a-zA-Z0-9._~:/?#@!$&()*+,;=%-]+' "$f" \
    | grep -viE 'w3\.org|schema\.org|googleapis|gstatic|npmjs|github\.com|sentry|localhost' \
    | sort -u | head -60
  echo "-- relative asset paths:"
  grep -oE '"[a-zA-Z0-9._/-]+\.(riv|glb|hdr|wasm|webp|json|mp4|png|jpg)"' "$f" | sort -u | head -60
  echo "-- boot signals:"
  grep -oE 'allriveloaded|window\.lenis|landoGL|lenisStart|__ln[A-Za-z]+|Webflow\.(destroy|ready|require)|dispatchEvent\(new (Custom)?Event\("[a-z:]+"' "$f" | sort | uniq -c | sort -rn | head -30
done

hr "rive files"
find "$OUT" -name '*.riv' -printf '%10s  %p\n' 2>/dev/null | sed "s|$OUT/||"

hr "gl files"
find "$OUT" -path '*/gl/*' -type f -printf '%10s  %p\n' 2>/dev/null | sed "s|$OUT/||" | head -60

hr "css"
find "$OUT" -name '*.css' -printf '%10s  %p\n' 2>/dev/null | sed "s|$OUT/||"
