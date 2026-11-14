#!/usr/bin/env bash
# Generates the signing keys for a Render deployment and writes them to deploy/render/keys.local.env (gitignored,
# readable only by you). Paste each value into Render when the Blueprint asks, then delete the file.
# Needs uv (it uses the AI service's Python environment for the crypto library).
set -euo pipefail
cd "$(dirname "$0")"
out=keys.local.env
umask 077
uv run --quiet --project ../../ai-service python -I - > "$out" <<'PY'
import json, uuid
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

def pem_private(k): return k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
def pem_public(k): return k.public_key().public_bytes(s.Encoding.PEM, s.PublicFormat.SubjectPublicKeyInfo).decode()

user = ec.generate_private_key(ec.SECP256R1())
internal = ec.generate_private_key(ec.SECP256R1())
jwk = json.loads(ECAlgorithm.to_jwk(internal, as_dict=False))
jwk["kid"] = f"internal-{uuid.uuid4()}"
print("# travelpal (web app + core-api)")
print(f"JWT_PRIVATE_KEY:\n{pem_private(user)}")
print(f"JWT_PUBLIC_KEY:\n{pem_public(user)}")
print(f"INTERNAL_JWT_PRIVATE_JWK:\n{json.dumps(jwk)}\n")
print("# travelpal-ai")
print(f"INTERNAL_JWT_PUBLIC_KEY:\n{pem_public(internal)}")
PY
echo "Wrote deploy/render/$out. Paste the values into Render, then delete the file."
