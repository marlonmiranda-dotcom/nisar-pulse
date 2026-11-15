#!/usr/bin/env python3
"""Autenticación Earthdata Login.

Lee el token desde la variable de entorno EARTHDATA_TOKEN o, si no existe,
el par usuario/contraseña de ~/.netrc (machine urs.earthdata.nasa.gov).
Nunca imprime ni escribe el secreto a disco ni a los productos.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

URS_HOSTS = (
    "earthdata.nasa.gov",
    "earthdatacloud.nasa.gov",
    "asf.alaska.edu",
    "asf.earthdatacloud.nasa.gov",
    "urs.earthdata.nasa.gov",
    "podaac.earthdata.nasa.gov",
    "archive.podaac.earthdata.nasa.gov",
)


class AuthError(RuntimeError):
    """Fallo de autenticación (401/403) o token ausente."""


def _netrc_pair():
    """Devuelve (login, password) de ~/.netrc o None."""
    netrc_path = Path.home() / ".netrc"
    if not netrc_path.is_file():
        return None
    try:
        import netrc
        info = netrc.netrc(str(netrc_path)).authenticators("urs.earthdata.nasa.gov")
        if info:
            login, _, password = info
            return login, password
    except Exception:
        return None
    return None


def bearer_token():
    """Token de Earthdata, o None si solo hay usuario/contraseña en .netrc."""
    tok = os.environ.get("EARTHDATA_TOKEN")
    if tok:
        return tok.strip()
    return None


def auth_headers():
    tok = bearer_token()
    if tok:
        return {"Authorization": f"Bearer {tok}"}
    return {}


def _host_ok_for_auth(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return any(h in host for h in URS_HOSTS)


def new_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": "TerraPulse-Colonso/1.0"})
    return s


def resolve_url(url: str, session: requests.Session | None = None, timeout=120) -> str:
    """Sigue redirecciones y devuelve la URL final (p. ej. firmada en CloudFront/S3).

    El encabezado Authorization solo se envía a hosts de Earthdata/ASF/PO.DAAC,
    nunca a CloudFront ni a S3.
    """
    sess = session or new_session()
    pair = None if bearer_token() else _netrc_pair()
    current = url
    for _ in range(12):
        headers = auth_headers() if _host_ok_for_auth(current) else {}
        auth = pair if (pair and _host_ok_for_auth(current)) else None
        r = sess.get(
            current,
            headers=headers,
            auth=auth,
            allow_redirects=False,
            timeout=timeout,
            stream=True,
        )
        try:
            if r.status_code in (401, 403):
                raise AuthError(
                    f"Earthdata autenticación falló con HTTP {r.status_code} en "
                    f"{urlparse(current).scheme}://{urlparse(current).netloc}{urlparse(current).path}"
                )
            if r.status_code in (301, 302, 303, 307, 308):
                loc = r.headers.get("Location")
                if not loc:
                    r.raise_for_status()
                current = urljoin(current, loc)
                continue
            r.raise_for_status()
            return current
        finally:
            r.close()
    raise RuntimeError(f"Demasiadas redirecciones al resolver {urlparse(url).path}")


def download_file(url: str, dest: Path, session: requests.Session | None = None, timeout=180):
    """Descarga un archivo pequeño (p. ej. una tesela de máscara de agua)."""
    sess = session or new_session()
    final = resolve_url(url, session=sess, timeout=timeout)
    r = sess.get(final, timeout=timeout)
    r.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    return dest, len(r.content)
