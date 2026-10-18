#!/bin/zsh
# ScriptFlow lokal starten (Doppelklick)
cd "$(dirname "$0")"
open "http://localhost:8666"
node serve.js
