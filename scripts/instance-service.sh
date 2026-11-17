#!/bin/bash
set -eu
action=$1
installation=$2
if [ "$action" = docs ]; then
  destination=/var/www/cloudshare-portal-docs
  [ -d "$destination" ] && [ ! -L "$destination" ]
  for source in "$installation"/build/docs-site/*; do
    name=$(basename -- "$source")
    [[ "$name" =~ ^[a-z-]+\.(html|css)$ ]] && [ -f "$source" ] && [ ! -L "$source" ] && [ ! -L "$destination/$name" ]
    sudo install -m 644 -- "$source" "$destination/$name"
  done
  exit 0
fi
[ "$(systemctl show issue489-next.service --property=WorkingDirectory --value)" = "$installation" ]
if [ "$action" = start ]; then
  sudo systemctl start issue489-next.service
elif [ "$action" = stop ]; then
  sudo systemctl stop issue489-next.service
  if systemctl is-active --quiet issue489-next.service; then exit 1; fi
  [ -z "$(ss -H -ltn 'sport = :3000')" ]
else
  exit 1
fi
