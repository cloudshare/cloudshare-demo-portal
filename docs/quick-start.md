# Quick start: initialize and sign in

On a fresh prepared VM, run initialization once before signing in. On Windows, right-click **Initialize-Portal.cmd** on the desktop and choose **Run as administrator**. On Ubuntu, run `~/initialize-portal.sh` as `sysadmin`. Wait for the success message before continuing. If this VM is already initialized, skip this step.

In VS Code, open `config/portal-seed.local.json` inside this VM's repository. It contains the generated Helios Certification and Certalis Sales administrator email addresses and passwords. Use those values for the account you want to sign in to.

Open the same VM's portal at `/login` and sign in. Sign out before switching between the Helios and Certalis accounts. Windows and Ubuntu have independent accounts and credentials. For operator procedures, see the [installation guide](implementation/two-os-installation.md#manual-instance-initialization).
