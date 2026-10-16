from __future__ import annotations

import os
import time
import base64
import jwt
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

JWT_PRIVATE_KEY_PATH = Path("data/jwt_private.pem")
JWT_PUBLIC_KEY_PATH = Path("data/jwt_public.pem")
KID = "wundadi-key-v1"
ISSUER = "http://localhost:5000"


def int_to_base64url(val: int) -> str:
    val_bytes = val.to_bytes((val.bit_length() + 7) // 8, byteorder='big')
    return base64.urlsafe_b64encode(val_bytes).decode('utf-8').rstrip('=')


def get_jwk(pub_key_pem: str) -> dict:
    pub_key = serialization.load_pem_public_key(pub_key_pem.encode('utf-8'))
    if not isinstance(pub_key, rsa.RSAPublicKey):
        raise ValueError("Only RSA public keys are supported")
    numbers = pub_key.public_numbers()
    n = int_to_base64url(numbers.n)
    e = int_to_base64url(numbers.e)
    return {
        "kty": "RSA",
        "alg": "RS256",
        "use": "sig",
        "kid": KID,
        "n": n,
        "e": e
    }


class TokenService:
    def __init__(self) -> None:
        self._private_key_pem: str = ""
        self._public_key_pem: str = ""
        self.initialize_keys()

    def initialize_keys(self) -> None:
        # Ensure data directory exists
        JWT_PRIVATE_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)

        if not JWT_PRIVATE_KEY_PATH.exists() or not JWT_PUBLIC_KEY_PATH.exists():
            print("[INFO] Generating new RS256 key pair for JWT signing...")
            private_key = rsa.generate_private_key(
                public_exponent=65537,
                key_size=2048,
            )
            pem_private = private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
            )
            pem_public = private_key.public_key().public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo
            )
            JWT_PRIVATE_KEY_PATH.write_bytes(pem_private)
            JWT_PUBLIC_KEY_PATH.write_bytes(pem_public)

        self._private_key_pem = JWT_PRIVATE_KEY_PATH.read_text(encoding="utf-8")
        self._public_key_pem = JWT_PUBLIC_KEY_PATH.read_text(encoding="utf-8")

    @property
    def public_key_pem(self) -> str:
        return self._public_key_pem

    def get_jwks(self) -> dict:
        jwk = get_jwk(self._public_key_pem)
        return {"keys": [jwk]}

    def sign_jwt(self, patient_id: str, scope: str = "patient/*.read") -> str:
        """為指定病患簽發 4 小時過期的 RS256 JWT Token。"""
        now = int(time.time())
        # SMART on FHIR JWT claims
        payload = {
            "iss": ISSUER,
            "sub": f"Patient/{patient_id}",
            "iat": now,
            "exp": now + 14400,  # 4 hours
            "scope": scope,
            "client_id": "wundadi-clinic-app",
        }
        token = jwt.encode(
            payload,
            self._private_key_pem,
            algorithm="RS256",
            headers={"kid": KID}
        )
        return token

    def verify_jwt(self, token: str) -> dict:
        """驗證 JWT，回傳解密後的 payload 或是拋出異常。"""
        return jwt.decode(
            token,
            self._public_key_pem,
            algorithms=["RS256"],
            audience=None,
            options={"verify_aud": False}
        )


# Global singleton
_token_service: TokenService | None = None


def get_token_service() -> TokenService:
    global _token_service
    if _token_service is None:
        _token_service = TokenService()
    return _token_service
