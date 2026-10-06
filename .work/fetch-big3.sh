#!/usr/bin/env bash
cd /d/Code/person/backends/tvbox-source || exit 1
J="https://cdn.jsdelivr.net/gh/gaotianliuyun/gao@master/lib"
G="https://ghproxy.net/https://raw.githubusercontent.com/gaotianliuyun/gao/master/lib"

get() { # name source
  local name="$1" src="$2" dest="gao/lib/$1"
  rm -f "$dest" || { echo "  cannot rm $dest"; return 1; }
  curl -sS -L --max-time 600 -o "$dest" "$src/$name"
  local sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
  if gzip -t "$dest" 2>/dev/null; then
    echo "  OK   $name $sz md5=$(md5sum "$dest" | cut -c1-32)"
  else
    echo "  BAD  $name $sz gzip-fail"
    return 1
  fi
}

echo "=== xray.gz ==="
get xray.gz "$J" || get xray.gz "$G"
echo "=== sing-box.gz ==="
get sing-box.gz "$J" || get sing-box.gz "$G"
echo "=== all gz ==="
for f in gao/lib/*.gz; do
  printf "%-34s %9s  %s\n" "$f" "$(stat -c%s $f)" "$(gzip -t $f 2>/dev/null && echo gzip-OK || echo gzip-FAIL)"
done
