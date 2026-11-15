# Security policy

## Supported versions

Only the latest release of the TCL Home integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-tclhome](https://github.com/prohand/gladys-tclhome/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove e-mail addresses, passwords and tokens first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), the TCL Home
app and cloud, and Amazon Web Services. This integration talks to the TCL Home cloud the way
the TCL Home app does; TCL publishes no official API and may change it at any time.

## How the integration handles your account

- The TCL Home password is stored by Gladys in a **secret** field. The integration sends only
  its MD5 hash to TCL, as the TCL Home app does, over HTTPS.
- The TCL tokens and the temporary AWS credentials stay **in memory**: nothing is written to
  disk, a restart signs in again.
- Passwords, tokens and AWS keys are never written to the logs.
- Every call goes to `*.tcl.com`, `*.tcljd.com` or `*.amazonaws.com` over HTTPS.

## Good practices for users

- Use a TCL Home password you use nowhere else.
- Consider a second TCL Home account, shared from the app, dedicated to Gladys.
- Keep Gladys and the integration up to date.
