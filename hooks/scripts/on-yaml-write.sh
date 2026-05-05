#!/usr/bin/env bash
command -v specguard >/dev/null 2>&1 && exec specguard hook on-yaml-write || true
