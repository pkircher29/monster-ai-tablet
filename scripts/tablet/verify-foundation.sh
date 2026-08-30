#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_ADB='/c/Users/Paul/AppData/Local/Android/Sdk/platform-tools/adb.exe'
readonly ADB_BIN="${ADB_BIN:-$DEFAULT_ADB}"
readonly TERMUX_ROOT='/data/data/com.termux/files'
readonly TERMUX_HOME="$TERMUX_ROOT/home"
readonly TERMUX_PREFIX="$TERMUX_ROOT/usr"
readonly TERMUX_TMP="$TERMUX_PREFIX/tmp"

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

if [[ "$("$ADB_BIN" get-state 2>/dev/null || true)" != 'device' ]]; then
  echo 'FAIL adb: tablet is not connected and authorized'
  exit 1
fi

run_in_termux() {
  local command="$1"
  "$ADB_BIN" shell "run-as com.termux env HOME=$TERMUX_HOME PREFIX=$TERMUX_PREFIX TMPDIR=$TERMUX_TMP LANG=C.UTF-8 PATH=$TERMUX_PREFIX/bin:/system/bin $TERMUX_PREFIX/bin/bash -lc '$command'"
}

echo "PASS adb: $("$ADB_BIN" shell getprop ro.product.model | tr -d '\r')"
echo "PASS Android: $("$ADB_BIN" shell getprop ro.build.version.release | tr -d '\r')"
echo "PASS Termux: $("$ADB_BIN" shell dumpsys package com.termux | sed -n 's/.*versionName=//p' | head -1 | tr -d '\r')"

check_tool() {
  local executable="$1"
  local version_command="$2"
  local version

  if ! run_in_termux "command -v $executable >/dev/null"; then
    printf 'FAIL %-14s missing\n' "$executable:"
    exit 1
  fi

  version="$(run_in_termux "$version_command 2>&1 | head -1" | tr -d '\r')"
  if [[ -z "$version" ]]; then
    printf 'FAIL %-14s version check returned no output\n' "$executable:"
    exit 1
  fi

  printf 'PASS %-14s %s\n' "$executable:" "$version"
}

check_tool git 'git --version'
check_tool ssh 'ssh -V'
check_tool python 'python --version'
check_tool node 'node --version'
check_tool npm 'npm --version'
check_tool rg 'rg --version'
check_tool tmux 'tmux -V'
check_tool proot-distro 'dpkg-query -W -f=\${Version} proot-distro'
check_tool clang 'clang --version'
check_tool rustc 'rustc --version'
check_tool make 'make --version'
check_tool pkg-config 'pkg-config --version'
check_tool openssl 'openssl version'
check_tool ffmpeg 'ffmpeg -version'
check_tool jq 'jq --version'

debian_release="$(run_in_termux 'proot-distro login debian -- cat /etc/os-release' | tr -d '\r')"
debian_name="$(printf '%s\n' "$debian_release" | sed -n 's/^PRETTY_NAME=//p' | tr -d '"')"
if [[ -z "$debian_name" ]]; then
  echo 'FAIL Debian: /etc/os-release was not readable'
  exit 1
fi
echo "PASS Debian: $debian_name"
