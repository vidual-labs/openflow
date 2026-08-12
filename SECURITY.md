# Security Policy

## Supported Versions

OpenFlow is a single-branch, continuously-released project. Only the latest
released version (see the badge in [README.md](README.md) or
[CHANGELOG.md](CHANGELOG.md)) is supported with security fixes. There are no
maintained long-term-support branches — upgrading to the latest `main` /
latest tagged release is the recommended way to stay patched.

## Reporting a Vulnerability

If you believe you've found a security vulnerability in OpenFlow, please
report it privately rather than opening a public GitHub issue.

- **Preferred**: Open a
  [GitHub Security Advisory](https://github.com/vidual-labs/openflow/security/advisories/new)
  for this repository. This is private by default and lets us coordinate a
  fix with you before any public disclosure.
- **Alternative**: If you can't use GitHub Security Advisories, open a
  regular issue titled `Security contact request` with no vulnerability
  details, and a maintainer will follow up with a private channel.

Please include, where possible:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (a minimal request/payload is ideal).
- The affected version/commit.

## What to Expect

- We aim to acknowledge new reports within **5 business days**.
- We aim to provide an initial assessment (confirmed / not applicable /
  needs more info) within **10 business days**.
- Once a fix is available, we'll credit the reporter (unless you'd prefer
  to remain anonymous) in the CHANGELOG entry for the fix, and coordinate a
  disclosure timeline with you.

## Scope

In scope: the `backend/` API and its authentication/authorization logic,
the `frontend/` admin app and public form renderer, the WordPress plugin
in `wordpress-plugin/`, and the Docker/Compose deployment files at the
repository root.

Out of scope: vulnerabilities that require an attacker to already have
admin credentials for a self-hosted instance, denial-of-service reports
against the rate limiter's fixed in-memory limits (already documented as a
single-instance constraint — see README), and issues in third-party
dependencies that should be reported upstream (though we're happy to hear
about them too, so we can track/patch on our side).
