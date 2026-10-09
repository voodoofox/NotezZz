#!/usr/bin/env bash
# The Google Play build: an app bundle (.aab) for every phone CPU, with the
# Play application id (com.flatvoxel.notezzz) and no self-updater (see
# NOTEZZZ_PLAY in src-tauri/gen/android/app/build.gradle.kts). Signed with the
# upload key from keystore.properties. Output: ../releases/NotezZz-<ver>-play.aab
#
#   bash scripts/build-play.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/27.2.12479018}"
export JAVA_HOME="${JAVA_HOME:-/c/Program Files/Android/Android Studio/jbr}"
export PATH="$JAVA_HOME/bin:$NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin:$PATH"
export NOTEZZZ_PLAY=1
ver=$(node -p "require('./package.json').version")
npx tauri android build --aab --target aarch64 armv7 i686 x86_64
aab=src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab
mkdir -p ../releases
cp "$aab" "../releases/NotezZz-$ver-play.aab"
echo "../releases/NotezZz-$ver-play.aab"
