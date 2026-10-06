#!/usr/bin/env bash
cd /d/Code/person/backends/tvbox-source || exit 1
J="https://cdn.jsdelivr.net/gh/gaotianliuyun/gao@master/lib"

fetch_verify() { # name want
  local name="$1" want="$2" dest="gao/lib/$1" have
  rm -f "$dest"
  for attempt in 1 2 3 4 5; do
    have=$(stat -c%s "$dest" 2>/dev/null || echo 0)
    [ "$have" -ge "$want" ] && break
    echo "  $name attempt $attempt have=$have want=$want"
    curl -sS -L --max-time 280 -C - -o "$dest" "$J/$name" 2>&1 | head -1
  done
  have=$(stat -c%s "$dest" 2>/dev/null || echo 0)
  if [ "$have" -eq "$want" ] && gzip -t "$dest" 2>/dev/null; then
    echo "  OK   $name $have/$want gzip-ok md5=$(md5sum "$dest" | cut -c1-32)"
  else
    echo "  BAD  $name $have/$want gzip=$(gzip -t "$dest" 2>/dev/null && echo ok || echo fail)"
  fi
}

fetch_verify xray.gz 9623089
fetch_verify sing-box.gz 10841051
fetch_verify clash2singbox.gz 2293039
echo "=== final ==="
ls -l gao/lib/*.gz | sed 's/  */ /g'
