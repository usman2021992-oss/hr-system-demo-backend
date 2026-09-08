#!/bin/sh
set -e

echo "=== HR System Backend ==="
echo "Starting server..."
exec node dist/index.js
