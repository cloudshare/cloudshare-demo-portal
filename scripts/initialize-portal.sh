#!/bin/bash
set -u
export PATH=/home/sysadmin/.local/node-v24.22.2-linux-x64/bin:/usr/bin:/bin
if ! cd /home/sysadmin/cloudshare-demo-portal; then
  printf '%s\n' 'ERROR: The portal checkout is unavailable. Nothing was initialized.' >&2
  exit 1
fi
printf '%s\n' 'Initializing this portal instance...'
npm run setup:instance
result=$?
if [ "$result" -ne 0 ]; then
  printf '%s\n' 'ERROR: Initialization failed. The portal service was not started.' >&2
  exit "$result"
fi
printf '%s\n' 'Initialization succeeded. Starting the existing portal service...'
sudo systemctl start issue489-next.service
result=$?
if [ "$result" -ne 0 ]; then
  printf '%s\n' 'ERROR: The portal service could not be started. Initialization already succeeded; do not initialize again.' >&2
  exit "$result"
fi
printf '%s\n' "Portal start requested. Open this VM's portal and use its private admin credentials."
if [ "${BASH_SOURCE[0]}" = "/home/sysadmin/initialize-portal.sh" ]; then
  if ! rm -- "${BASH_SOURCE[0]}"; then
    printf '%s\n' 'ERROR: Initialization and service start succeeded, but the launcher could not be removed.' >&2
    exit 1
  fi
fi
