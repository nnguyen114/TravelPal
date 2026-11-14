#!/usr/bin/env bash
# Generates TravelPal's signing keys and stores them, plus the Claude and Voyage API keys, in Secrets Manager.
# Run once after `terraform apply` (and again to rotate). Keys go straight from this process to AWS: nothing is
# written to disk or printed. Needs: aws CLI signed in to the target account, uv (for Python + cryptography).
#   ANTHROPIC_API_KEY=... VOYAGE_API_KEY=... infra/scripts/put-secrets.sh
set -euo pipefail
: "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY}" "${VOYAGE_API_KEY:?set VOYAGE_API_KEY}"
cd "$(dirname "$0")/../../ai-service"

put() { aws secretsmanager put-secret-value --secret-id "travelpal/$1" --secret-string "$2" >/dev/null && echo "stored travelpal/$1"; }

keys=$(uv run --quiet python -I - <<'PY'
import json, uuid
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

user = ec.generate_private_key(ec.SECP256R1())
internal = json.loads(ECAlgorithm.to_jwk(ec.generate_private_key(ec.SECP256R1()), as_dict=False))
internal["kid"] = f"internal-{uuid.uuid4()}"
print(json.dumps({
    "jwt-private-key": user.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode(),
    "jwt-public-key": user.public_key().public_bytes(s.Encoding.PEM, s.PublicFormat.SubjectPublicKeyInfo).decode(),
    "internal-jwk": json.dumps(internal),
}))
PY
)
for k in jwt-private-key jwt-public-key internal-jwk; do
  put "$k" "$(jq -r --arg k "$k" '.[$k]' <<<"$keys")"
done
put anthropic-api-key "$ANTHROPIC_API_KEY"
put voyage-api-key "$VOYAGE_API_KEY"
echo "Done. Redeploy both services to pick the keys up (signs everyone out once if the user key changed)."
