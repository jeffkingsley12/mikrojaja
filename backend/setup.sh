#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — First-time backend setup
# Run once after cloning: bash setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "▶ Installing dependencies..."
npm install

echo "▶ Creating data directory..."
mkdir -p data

if [ ! -f .env ]; then
  echo "▶ Creating .env from example..."
  cp .env.example .env

  # Auto-generate secrets
  API_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ADMIN_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/CHANGE_ME_GENERATE_RANDOM_64_HEX_API/$API_SECRET/g"   .env
    sed -i '' "s/CHANGE_ME_GENERATE_RANDOM_64_HEX_ADMIN/$ADMIN_TOKEN/g" .env
  else
    sed -i "s|API_SECRET=CHANGE_ME_GENERATE_RANDOM_64_HEX|API_SECRET=$API_SECRET|g"   .env
    sed -i "s|ADMIN_TOKEN=CHANGE_ME_GENERATE_RANDOM_64_HEX|ADMIN_TOKEN=$ADMIN_TOKEN|g" .env
  fi

  echo ""
  echo "✅ .env created with auto-generated secrets."
  echo ""
  echo "⚠️  You MUST still configure:"
  echo "   MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASS"
  echo "   AT_API_KEY, AT_USERNAME (Africa's Talking)"
  echo ""
  echo "📋 Copy API_SECRET to your Android local.properties:"
  echo "   API_SECRET=$API_SECRET"
else
  echo "▶ .env already exists — skipping"
fi

echo ""
echo "✅ Setup complete. Start with: npm start"
