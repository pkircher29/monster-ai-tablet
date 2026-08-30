#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_ADB='/c/Users/Paul/AppData/Local/Android/Sdk/platform-tools/adb.exe'
readonly ADB_BIN="${ADB_BIN:-$DEFAULT_ADB}"
readonly TERMUX_ROOT='/data/data/com.termux/files'
readonly TERMUX_HOME="$TERMUX_ROOT/home"
readonly TERMUX_PREFIX="$TERMUX_ROOT/usr"
readonly TERMUX_TMP="$TERMUX_PREFIX/tmp"

# Git Bash otherwise rewrites Android absolute paths into Windows paths before
# passing them to adb.exe.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

if [[ ! -x "$ADB_BIN" ]]; then
  echo "adb was not found at $ADB_BIN" >&2
  exit 1
fi

if [[ "$("$ADB_BIN" get-state 2>/dev/null || true)" != 'device' ]]; then
  echo 'The tablet is not connected and authorized over adb.' >&2
  exit 1
fi

if ! "$ADB_BIN" shell run-as com.termux ls "$TERMUX_PREFIX/bin/bash" >/dev/null 2>&1; then
  echo 'Termux has not completed first-run setup. Open it once and wait for the shell prompt.' >&2
  exit 1
fi

run_in_termux() {
  local command="$1"
  "$ADB_BIN" shell "run-as com.termux env HOME=$TERMUX_HOME PREFIX=$TERMUX_PREFIX TMPDIR=$TERMUX_TMP LANG=C.UTF-8 PATH=$TERMUX_PREFIX/bin:/system/bin $TERMUX_PREFIX/bin/bash -lc '$command'"
}

echo 'Updating Termux packages...'
run_in_termux 'export DEBIAN_FRONTEND=noninteractive; dpkg --force-confnew --configure -a; apt-get update; apt-get -y -o Dpkg::Options::=--force-confnew upgrade'

echo 'Installing the local developer toolchain...'
run_in_termux 'pkg install -y git openssh python nodejs-lts ripgrep tmux proot-distro clang rust make pkg-config libffi openssl openssl-tool ffmpeg jq'

if ! run_in_termux 'proot-distro login debian -- true' >/dev/null 2>&1; then
  echo 'Installing the Debian proot environment...'
  run_in_termux 'proot-distro install debian'
else
  echo 'Debian proot is already installed.'
fi

echo 'Termux foundation installation completed.'
