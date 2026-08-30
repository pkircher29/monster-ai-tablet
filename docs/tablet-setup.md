# Tablet Foundation Setup

Last verified: 2026-08-30 (America/New_York)

This runbook records only software versions and verification evidence. It does not contain the tablet serial, tailnet identity, account names, private addresses, SSH private keys, or API credentials.

## Termux

- Source: official [`termux/termux-app` v0.118.3 GitHub release](https://github.com/termux/termux-app/releases/tag/v0.118.3)
- Asset: `termux-app_v0.118.3+github-debug_arm64-v8a.apk`
- SHA-256: `72fdb596045116bf5ba1b5bdf5b26fddb9acc0bd074ad9f2da9eb0ae85e83a4e`
- Checksum result: exact match against the release's `github-debug_sha256sums`
- Package: `com.termux`, version `0.118.3`

Do not mix this GitHub-signed Termux install with F-Droid- or Play-signed Termux plugins. Android requires all Termux app and plugin packages to share a signing source.

The repeatable host-side installer is [`scripts/tablet/bootstrap-termux.sh`](../scripts/tablet/bootstrap-termux.sh). It runs commands as the existing Termux app UID over an already-authorized USB ADB connection and stores everything in Termux private app data.

## Verified local toolchain

The following were executed successfully on the arm64 tablet:

| Tool         | Verified version             |
| ------------ | ---------------------------- |
| Git          | 2.55.0                       |
| OpenSSH      | 10.5p1                       |
| Python       | 3.14.6                       |
| Node.js      | 24.18.0                      |
| npm          | 11.19.1                      |
| ripgrep      | 15.2.0                       |
| tmux         | 3.7c                         |
| proot-distro | 5.8.0                        |
| Debian proot | Debian GNU/Linux 13 (trixie) |
| Clang        | 21.1.8                       |
| Rust         | 1.98.0                       |
| GNU Make     | 4.4.1                        |
| pkg-config   | 0.29.2                       |
| OpenSSL      | 3.6.3                        |
| FFmpeg       | 8.1.2                        |
| jq           | 1.8.2                        |

Run [`scripts/tablet/verify-foundation.sh`](../scripts/tablet/verify-foundation.sh) to repeat these checks. The script fails at the first absent or non-running tool.

## Tailscale

- Source: official Google Play listing, as recommended by the [Tailscale Android installation guide](https://tailscale.com/docs/install/android)
- Package: `com.tailscale.ipn`
- Installed version: `1.98.8-t1241b225b-gbcbaf1889`
- Pairing status: connected; the tablet successfully resolved and reached the Windows workstation by MagicDNS
- Android always-on VPN: configured for `com.tailscale.ipn` without lockdown, so ordinary network access remains available if Tailscale is unavailable

After a full tablet restart and the normal first PIN unlock, Android started Tailscale automatically.
The VPN reported both connected and validated without another setup flow.

The hub will use HTTPS and MagicDNS over the existing tailnet. It will not publish a public listener or expose ADB through Tailscale Funnel.

## OpenClaw Android

The official Android companion is installed from Google Play:

- Package: `ai.openclaw.app`
- Version: `2026.7.4`
- Role: companion node and operator client; it does not host the Gateway

The Windows Gateway was updated from an unconfigured/stopped `2026.5.7` install to official npm stable `2026.7.1-2`. It is configured with loopback binding, token authentication through an environment SecretRef, and Tailscale Serve. Authenticated local health and tablet-to-Gateway HTTPS over MagicDNS both pass.

Pairing is complete and live-verified. Inspection of the installed `2026.7.1-2` implementation confirmed that `openclaw qr` now carries a short-lived bootstrap token rather than the shared Gateway credential. The tablet received a `node` role with no node scopes and a bounded operator handoff with `operator.approvals`, `operator.read`, `operator.talk.secrets`, and `operator.write`. It did not receive `operator.admin` or device-pairing mutation authority. The Android app reports the Gateway online and the node count as `1/1`.

The Tailscale Serve certificate fingerprint was verified directly against the trusted Windows endpoint and pinned in the Android companion. After a full tablet restart and normal first unlock, OpenClaw reconnected as the existing bounded device without showing the setup flow. The Android dashboard reported the Gateway online and `1/1` node connected, and the Gateway independently confirmed the Android node connection. No shared Gateway credential was entered on or exposed to the tablet.

Camera, microphone, location, contacts, calendar, nearby-device, and notification permissions remain denied. Grant them later only when a specific approved workflow requires one. See the [official Android runbook](https://github.com/openclaw/openclaw/blob/main/docs/platforms/android.md) and [operator scope reference](https://docs.openclaw.ai/gateway/operator-scopes).

Tailscale and OpenClaw remain in Android's adaptive background policy and active standby bucket;
neither was added to the device-idle allowlist. Reboot recovery passed without granting a broad
battery-optimization exemption.

## Monster Agent Hub preview

- Windows launcher: [`scripts/start-hub.cmd`](../scripts/start-hub.cmd)
- Loopback listener: `127.0.0.1:8790` (port `8787` was already owned by an unrelated local application and was left untouched)
- Tailnet endpoint: HTTPS port `9443` through Tailscale Serve; no Funnel or public listener
- Persistence registration: `Monster Agent Hub` scheduled task, interactive user logon, limited privilege. It is enabled but has not yet run; task-owned listener and Windows restart recovery remain unverified. Its current Windows defaults prevent starting on battery and stop it when switching to battery power.
- Live checks: health, static PWA, same-origin delegation POST, four assignments, `PREVIEW_ONLY`, and empty `sideEffects` all passed through the Tailscale proxy
- Tablet install: installed as a standalone PWA from the private HTTPS endpoint; service-worker control, portrait layout, touch input, on-screen keyboard resizing, and a four-item no-execution preview passed on the physical tablet

The UI and API support planning only. Agent launch, approval execution, OpenRouter spending, credentials, messaging, purchasing, and device-control routes are not exposed.

## Remaining checks

- After explicit approval to stop the two temporary test listeners, run the scheduled host task and verify that it owns the loopback listener.
- Verify Windows restart/logon recovery for the scheduled host task.
- Exercise the installed PWA in physical landscape, Android split-screen, and while the tablet itself is offline; equivalent landscape, split-width, and offline behavior already passed in a real desktop browser. The PWA manifest allows any orientation, but the tablet remained portrait during the automated rotation check, so that check is not counted as passed.
