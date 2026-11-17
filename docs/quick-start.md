# Quick start: initialize and sign in

On a fresh prepared VM, run the persistent launcher before the first portal sign-in:

- **Windows:** right-click **Initialize-Portal.cmd** on the shared desktop and choose **Run as administrator**.
- **Ubuntu:** run `/home/sysadmin/initialize-portal.sh` in a terminal as `sysadmin`; normal sudo authorization may be required.

The launcher needs Node 24, Git, npm registry access and public GitHub access. It downloads
one exact release from current public `main`, initializes fresh private instance data,
builds the portal and documentation, then starts the existing app. Wait for successful
completion and verify the portal opens. The launcher remains available: run it again only
when you want to update an existing instance, preserving its configuration, credentials
and database. Ordinary sign-in does not require another launcher run.

In VS Code, open `config/portal-seed.local.json` inside this VM's repository. It contains
the generated Helios Certification and Certalis Sales administrator email addresses and
passwords. Use those values for the account you want to sign in to. Keep the matching
master key in `.env` private; do not copy credentials into chat or screenshots.

Open the same VM's portal at `/login` and sign in. Sign out before switching between the
Helios and Certalis accounts. Windows and Ubuntu have independent accounts and credentials.
If the launcher fails, stop at the reported phase and do not reset the instance as a repair.
See [Initialize or update from current main](implementation/current-main-maintenance.md)
for prerequisites, preservation and recovery, and the [installation guide](implementation/two-os-installation.md#prepared-vm-launchers)
for launcher locations and copying instructions.
