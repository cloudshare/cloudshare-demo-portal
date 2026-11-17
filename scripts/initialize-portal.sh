#!/bin/bash
set -eu
umask 077
export PATH=/home/sysadmin/.local/node-v24.22.2-linux-x64/bin:$PATH
printf '%s\n' 'Preparing the latest portal release. Existing data will be preserved.'
tools=$(mktemp -d "$HOME/.portal-maintenance-XXXXXXXX")
if ! git clone --single-branch --branch main -- https://github.com/cloudshare/cloudshare-demo-portal.git "$tools" 2>/dev/null; then
  printf '%s\n' 'ERROR: Download failed; installed portal unchanged.' >&2
  exit 1
fi
node "$tools/scripts/maintain-instance.mjs" /home/sysadmin/cloudshare-demo-portal
