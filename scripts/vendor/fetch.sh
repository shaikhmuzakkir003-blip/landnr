#!/usr/bin/env bash
# fetch.sh — pull the OFF+BRAND engine + every asset it loads into vendor/.
#
# Two sources per file, in order:
#   1. the live host, asking politely with a landonorris.com Referer
#   2. the Wayback Machine's raw capture (`id_`, no toolbar rewrite)
#
# Nothing here is required to succeed: whatever arrives is written to
# vendor/offbrand/<host>/<path> and listed in vendor/manifest.json.

set -u   # no -e, no pipefail: a missing file must never abort the harvest

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/vendor/offbrand"
MANIFEST="$ROOT/vendor/manifest.json"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
REFERER="https://landonorris.com/"

mkdir -p "$OUT"
ok=0; missed=0
: > "$ROOT/vendor/.fetched.tsv"

# ---------------------------------------------------------------------------
# 1 — the Wayback index for the two OFF+BRAND hosts
# ---------------------------------------------------------------------------
cdx() { # $1 = url, $2 = matchType
  curl -fsSL --max-time 60 --retry 2 -A "$UA" \
    "https://web.archive.org/cdx/search/cdx?url=$1&matchType=$2&output=text&limit=5000&collapse=urlkey&filter=statuscode:200" \
    2>/dev/null || true
}

echo "== indexing lando.itsoffbrand.io"
cdx "lando.itsoffbrand.io" "domain" > /tmp/cdx-lando.txt
echo "   $(wc -l < /tmp/cdx-lando.txt) archived files"

echo "== indexing assets.itsoffbrand.io/lando"
cdx "assets.itsoffbrand.io/lando" "prefix" > /tmp/cdx-assets.txt
echo "   $(wc -l < /tmp/cdx-assets.txt) archived files"

# CDX columns: urlkey timestamp original mime status digest size
harvest_cdx() { # $1 = cdx file
  while read -r _key ts original _rest; do
    [ -n "${original:-}" ] || continue
    case "$original" in
      *.mp4|*.pdf|*.zip) continue ;;
    esac
    fetch_one "$original" "$ts"
  done < "$1"
}

# ---------------------------------------------------------------------------
# 2 — the downloader
# ---------------------------------------------------------------------------
fetch_one() { # $1 = absolute url, $2 = wayback timestamp (optional)
  local url="$1" ts="${2:-}"
  local rest="${url#*://}" host="${rest%%/*}" path="${rest#*/}"
  path="${path%%\?*}"
  [ -n "$path" ] || path="index"
  local dest="$OUT/$host/$path"

  if [ -s "$dest" ]; then
    printf '%s\t%s\tcached\n' "$url" "$dest" >> "$ROOT/vendor/.fetched.tsv"
    ok=$((ok+1)); return 0
  fi
  mkdir -p "$(dirname "$dest")"

  # a) the live host
  if curl -fsSL --max-time 45 --retry 1 -A "$UA" -e "$REFERER" -o "$dest.part" "$url" 2>/dev/null \
     && [ -s "$dest.part" ] && ! head -c 64 "$dest.part" | grep -qi "Access denied"; then
    mv "$dest.part" "$dest"
    printf '%s\t%s\tlive\n' "$url" "$dest" >> "$ROOT/vendor/.fetched.tsv"
    ok=$((ok+1)); return 0
  fi
  rm -f "$dest.part"

  # b) the archive
  if [ -n "$ts" ]; then
    if curl -fsSL --max-time 60 --retry 2 -A "$UA" -o "$dest.part" \
       "https://web.archive.org/web/${ts}id_/$url" 2>/dev/null && [ -s "$dest.part" ]; then
      mv "$dest.part" "$dest"
      printf '%s\t%s\twayback:%s\n' "$url" "$dest" "$ts" >> "$ROOT/vendor/.fetched.tsv"
      ok=$((ok+1)); return 0
    fi
    rm -f "$dest.part"
  fi

  printf '%s\t-\tMISSING\n' "$url" >> "$ROOT/vendor/.fetched.tsv"
  missed=$((missed+1))
  return 1
}

harvest_cdx /tmp/cdx-lando.txt
harvest_cdx /tmp/cdx-assets.txt

# ---------------------------------------------------------------------------
# 3 — the Webflow runtime + stylesheet the engine calls into
# ---------------------------------------------------------------------------
echo "== webflow runtime"
WF="67b5a02dc5d338960b17a7e9"
fetch_one "https://cdn.prod.website-files.com/$WF/css/lando-offbrand.shared.5b4e934f7.css" ""
fetch_one "https://cdn.prod.website-files.com/$WF/css/lando-offbrand.shared.4f53262f0.css" ""
fetch_one "https://cdn.prod.website-files.com/$WF/js/lando-offbrand.schunk.7321a5097fb66f41.js" ""
fetch_one "https://cdn.prod.website-files.com/$WF/js/lando-offbrand.751e0867.148dc658e77a3916.js" ""
fetch_one "https://d3e54v103j8qbb.cloudfront.net/js/jquery-3.5.1.min.dc5e7f18c8.js" ""

# ---------------------------------------------------------------------------
# 4 — the font the page preloads
# ---------------------------------------------------------------------------
fetch_one "https://cdn.prod.website-files.com/$WF/67bc6274c5b4108b123aa4d5_MonaSans-VariableFont_wdth%2Cwght.woff2" ""

# ---------------------------------------------------------------------------
# 5 — manifest
# ---------------------------------------------------------------------------
echo "== manifest"
{
  echo "{"
  echo "  \"generatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"files\": ["
  first=1
  while IFS=$'\t' read -r url dest how; do
    [ "$dest" = "-" ] && continue
    rel="${dest#$ROOT/}"
    size=$(stat -c%s "$dest" 2>/dev/null || echo 0)
    [ $first -eq 0 ] && echo ","
    first=0
    printf '    {"url": "%s", "path": "%s", "bytes": %s, "source": "%s"}' "$url" "$rel" "$size" "$how"
  done < "$ROOT/vendor/.fetched.tsv"
  echo ""
  echo "  ]"
  echo "}"
} > "$MANIFEST"

echo
echo "   fetched: $ok   missing: $missed"
echo "   bytes:   $(du -sh "$OUT" 2>/dev/null | cut -f1)"
find "$OUT" -type f > /tmp/vendor-list.txt 2>/dev/null || true
sed "s|$OUT/||" /tmp/vendor-list.txt | sort > "$ROOT/vendor/file-list.txt" || true
head -n 80 "$ROOT/vendor/file-list.txt" || true
echo "(full list in vendor/file-list.txt and vendor/manifest.json)"
exit 0
