#!/usr/bin/env bash
cd /d/Code/person/backends/tvbox-source || exit 1
G="https://ghproxy.net/https://raw.githubusercontent.com/gaotianliuyun/gao/master/lib"
J="https://cdn.jsdelivr.net/gh/gaotianliuyun/gao@master/lib"

resume() { # url dest want
  local url="$1" dest="$2" want="$3" have
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    have=$(stat -c%s "$dest" 2>/dev/null || echo 0)
    [ "$have" -ge "$want" ] && break
    echo "  [$dest] attempt $attempt have=$have want=$want"
    curl -sS -L --max-time 240 -C - -o "$dest" "$url" 2>&1 | head -1
  done
  have=$(stat -c%s "$dest" 2>/dev/null || echo 0)
  if gzip -t "$dest" 2>/dev/null; then echo "  OK  $dest $have/$want gzip-ok"; else echo "  BAD $dest $have/$want gzip-FAIL"; fi
}

rm -f "gao/js/西门[V2].js"
echo "=== xray.gz (want 9623089) ==="
resume "$G/xray.gz" gao/lib/xray.gz 9623089
echo "=== sing-box.gz (want 10841051) ==="
resume "$J/sing-box.gz" gao/lib/sing-box.gz 10841051
echo "=== clash2singbox.gz (want 2293039) ==="
resume "$J/clash2singbox.gz" gao/lib/clash2singbox.gz 2293039
echo "=== final ==="
ls -l gao/lib/*.gz | sed 's/  */ /g'
