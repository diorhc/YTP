Publishing to GreasyFork from GitHub Actions

This document explains how the automated publish workflow works and required setup.

Security note: store credentials in GitHub Secrets; do not commit them into the repository.

Required GitHub Secrets:
- `GREASYFORK_USERNAME` — your GreasyFork username/email
- `GREASYFORK_PASSWORD` — your GreasyFork password

How it works:
1. When you create a GitHub Release (tag) the `publish-greasyfork.yml` workflow triggers.
2. The workflow checks out the repo, installs dependencies, builds `youtube.user.js`.
3. The workflow runs `.github/scripts/upload-greasyfork.js` which uses Puppeteer to log into GreasyFork and submit a new script.

Limitations & caveats:
- GreasyFork may present a CAPTCHA or other anti-bot checks; this script cannot bypass CAPTCHA.
- The script tries the "New script" endpoint; if you want to update an existing script, adjust the script to navigate to the correct edit page.
- Alternative approach: use a GreasyFork API or manual publish if CAPTCHA blocks automation.

Usage:
1. Add your GreasyFork credentials in GitHub Settings -> Secrets -> Actions.
2. Create a Release on GitHub (or push a tag) to trigger the workflow.

If you want, I can adapt the script to update an existing script by script ID (preferred). To do that I need the GreasyFork script ID or the URL of the script to target.
