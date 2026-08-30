# SVITOO V13_B Device Baseline

Captured: 2026-08-30 (America/New_York)

This record intentionally omits the tablet serial number, accounts, network identifiers, and unrelated installed applications.

## Hardware and Android

| Item | Verified value |
|---|---|
| Manufacturer / model | SVITOO V13_B (`V13_B_US`) |
| Android | 16 / API 36 |
| Build | `SVITOO_V13_B_US_T7300_20260527` |
| Security patch | 2026-04-05 |
| CPU | arm64-only Unisoc T7300 / UMS9360, 8 cores |
| RAM | 7,937,832 KiB reported, about 5.1 GiB available during inspection |
| Storage | 112 GiB user volume, about 108 GiB free |
| Display | 1600 x 2240, 343 dpi |
| Kernel | 6.6.98 Android kernel, 4 KiB page size |

## Security and Boot State

| Item | Verified value |
|---|---|
| Build type | `user`, `release-keys` |
| ADB identity | unprivileged `shell` user |
| `adb root` | rejected on production build |
| SELinux | Enforcing |
| Bootloader | Locked |
| AVB state | `green` / verified |
| Slots | A/B, current slot A |
| Dynamic partitions | Enabled |
| Virtual A/B updates | Enabled |

## Bootloader Audit

The tablet successfully entered bootloader fastboot mode. Windows initially lacked a driver for the Google fastboot gadget (`VID_18D1`, `PID_4EE0`), so the official Google USB driver was installed through Android SDK Manager and registered as `oem107.inf`.

Read-only fastboot results:

- `current-slot`: `a`
- `slot-count`: `2`
- `is-userspace`: `no`
- `flashing get_unlock_ability`: not implemented
- `oem device-info`: unknown command
- Common product, secure, unlocked, and bootloader version variables returned blank values

No unlock, erase, flash, or partition-read command was issued. The tablet rebooted normally and ADB reconnected.

## Root Decision

Rooting is deferred. The device is new and a factory reset would be acceptable, but the current evidence does not provide a recoverable route:

1. The minimal bootloader does not expose the standard unlock-capability query.
2. No verified, exact-match SVITOO V13_B stock firmware or boot image was found.
3. A patched boot image cannot be safely produced or restored without that source image.
4. Root is not required for Termux, Tailscale, a PWA, OpenClaw's Android node, or remote coding-agent control.

Revisit rooting only after obtaining exact matching firmware from SVITOO and verifying a complete restore procedure before unlocking.

## Existing Foundation

- Google Play and Google Play Services are installed.
- Developer options and USB debugging are enabled.
- Termux was not installed at baseline.
- Tailscale was not installed at baseline.
- The tablet has enough physical memory and storage for Termux, a Debian proot, local developer tools, and cached repositories; heavy agent runtimes remain better suited to the Windows host.
