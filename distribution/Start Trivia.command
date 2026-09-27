#!/bin/bash
set -e
cd "$(dirname "$0")"
trap 'echo "If the browser did not open, send the message above to the person who gave you this app."; read -r -p "Press Return to close."' ERR
TRIVIA_VERSION=v22.22.1
case "$(uname -s)" in Darwin) TRIVIA_OS=darwin ;; Linux) TRIVIA_OS=linux ;; *) echo "Use Start Trivia.bat on Windows."; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) TRIVIA_ARCH=arm64 ;; x86_64) TRIVIA_ARCH=x64 ;; *) echo "This computer's processor is not supported."; exit 1 ;; esac
TRIVIA_NAME="node-$TRIVIA_VERSION-$TRIVIA_OS-$TRIVIA_ARCH"
TRIVIA_NODE=".runtime/$TRIVIA_NAME/bin/node"
if [ ! -x "$TRIVIA_NODE" ]; then
  echo "Preparing Party Trivia for the first time. This needs an internet connection."
  mkdir -p .runtime
  curl --fail --location --retry 2 "https://nodejs.org/dist/$TRIVIA_VERSION/$TRIVIA_NAME.tar.gz" -o ".runtime/$TRIVIA_NAME.tar.gz"
  curl --fail --location --retry 2 "https://nodejs.org/dist/$TRIVIA_VERSION/SHASUMS256.txt" -o .runtime/SHASUMS256.txt
  TRIVIA_EXPECTED=$(awk -v name="$TRIVIA_NAME.tar.gz" '$2 == name {print $1}' .runtime/SHASUMS256.txt)
  TRIVIA_ACTUAL=$(shasum -a 256 ".runtime/$TRIVIA_NAME.tar.gz" | awk '{print $1}')
  if [ -z "$TRIVIA_EXPECTED" ] || [ "$TRIVIA_ACTUAL" != "$TRIVIA_EXPECTED" ]; then echo "Download verification failed. Please try again."; exit 1; fi
  tar -xzf ".runtime/$TRIVIA_NAME.tar.gz" -C .runtime
fi
"$TRIVIA_NODE" launcher.mjs
read -r -p "Press Return to close."
