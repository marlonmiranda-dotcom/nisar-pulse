#!/usr/bin/env python3
"""Apertura de HDF5 NISAR por S3 (credenciales temporales) o por rangos HTTP.

Las credenciales se piden a https://nisar.asf.earthdatacloud.nasa.gov/s3credentials
con el token Earthdata y se refrescan antes de caducar. Nunca se escriben a disco
ni se imprimen.
"""
from __future__ import annotations

import datetime as dt
import threading
from urllib.parse import urljoin, urlparse

import h5py
import requests
import s3fs

from earthdata_auth import auth_headers, new_session, AuthError, bearer_token, _host_ok_for_auth

S3_CREDS_URL = "https://nisar.asf.earthdatacloud.nasa.gov/s3credentials"
_LOCK = threading.Lock()
_CREDS = None  # dict con expiration datetime y fs


def _parse_exp(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return dt.datetime.fromtimestamp(val, tz=dt.timezone.utc)
    s = str(val).replace("Z", "+00:00")
    try:
        t = dt.datetime.fromisoformat(s)
    except ValueError:
        return dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=50)
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return t


def s3_filesystem(session=None, min_ttl_s=300):
    """Devuelve un s3fs.S3FileSystem con credenciales temporales vigentes."""
    global _CREDS
    now = dt.datetime.now(dt.timezone.utc)
    with _LOCK:
        if _CREDS and _CREDS["expiration"] - now > dt.timedelta(seconds=min_ttl_s):
            return _CREDS["fs"]
        sess = session or new_session()
        r = sess.get(S3_CREDS_URL, headers=auth_headers(), timeout=60)
        if r.status_code in (401, 403):
            raise AuthError(f"s3credentials HTTP {r.status_code}")
        r.raise_for_status()
        data = r.json()
        exp = _parse_exp(data.get("expiration"))
        fs = s3fs.S3FileSystem(
            key=data["accessKeyId"],
            secret=data["secretAccessKey"],
            token=data["sessionToken"],
            default_fill_cache=False,
            default_block_size=2 * 1024 * 1024,
            client_kwargs={"region_name": "us-west-2"},
        )
        _CREDS = {"fs": fs, "expiration": exp or (now + dt.timedelta(minutes=50))}
        return fs


def https_a_s3(url: str) -> str | None:
    """Convierte una URL HTTPS de nisar.asf.earthdatacloud a s3://... si el patrón coincide."""
    if url.startswith("s3://"):
        return url
    p = urlparse(url)
    host = p.netloc.lower()
    path = p.path
    # https://nisar.asf.earthdatacloud.nasa.gov/NISAR/<collection>/<id>/<file>
    if "nisar.asf.earthdatacloud.nasa.gov" in host and path.startswith("/NISAR/"):
        return "s3://sds-n-cumulus-prod-nisar-products" + path[len("/NISAR"):]
    return None


class HTTPRangeFile:
    """Archivo de solo lectura por cabeceras Range (fallback si S3 no está disponible)."""

    def __init__(self, url, session, size, block=2 * 1024 * 1024):
        self.url = url
        self.session = session
        self.size = size
        self.pos = 0
        self.block = block
        self.cache = {}
        self.bytes_read = 0
        self.n_reads = 0

    def seek(self, off, whence=0):
        if whence == 0:
            self.pos = off
        elif whence == 1:
            self.pos += off
        elif whence == 2:
            self.pos = self.size + off
        return self.pos

    def tell(self):
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        start = self.pos
        end = min(self.size, start + n)
        b0 = start // self.block
        b1 = (end - 1) // self.block
        parts = []
        for b in range(b0, b1 + 1):
            if b not in self.cache:
                s = b * self.block
                e = min(self.size, s + self.block) - 1
                rr = self.session.get(self.url, headers={"Range": f"bytes={s}-{e}"}, timeout=180)
                rr.raise_for_status()
                self.cache[b] = rr.content
                self.bytes_read += len(rr.content)
                self.n_reads += 1
            parts.append(self.cache[b])
        blob = b"".join(parts)
        off = start - b0 * self.block
        data = blob[off:off + (end - start)]
        self.pos += len(data)
        return data

    def readinto(self, buf):
        data = self.read(len(buf))
        buf[:len(data)] = data
        return len(data)

    def close(self):
        self.cache.clear()

    def readable(self):
        return True

    def seekable(self):
        return True

    def writable(self):
        return False


def _signed_https(url, session):
    headers = {**auth_headers(), "Range": "bytes=0-0"} if _host_ok_for_auth(url) else {"Range": "bytes=0-0"}
    r = session.get(url, headers=headers, allow_redirects=False, timeout=60)
    try:
        if r.status_code in (401, 403):
            raise AuthError(f"HTTP {r.status_code} al resolver {urlparse(url).path}")
        if r.status_code in (301, 302, 303, 307, 308):
            loc = r.headers.get("Location")
            if not loc:
                raise RuntimeError("Redirección sin Location")
            return urljoin(url, loc)
        r.raise_for_status()
        return url
    finally:
        r.close()


def abrir_h5(url: str, session=None, prefer_s3=True):
    """Abre un HDF5 remoto. Devuelve (h5py.File, handle_bajo_nivel, modo).

    `url` puede ser https://... o s3://...
    """
    sess = session or new_session()
    s3url = url if url.startswith("s3://") else (https_a_s3(url) if prefer_s3 else None)
    if prefer_s3 and s3url:
        fs = s3_filesystem(session=sess)
        key = s3url[len("s3://"):]
        fh = fs.open(key, "rb")
        h5 = h5py.File(fh, "r")
        return h5, fh, "s3"
    # Fallback HTTP Range sobre URL firmada
    signed = _signed_https(url, sess)
    r = sess.get(signed, headers={"Range": "bytes=0-0"}, timeout=60)
    cr = r.headers.get("Content-Range", "")
    size = int(cr.split("/")[-1]) if "/" in cr else int(r.headers.get("Content-Length") or 0)
    r.close()
    fh = HTTPRangeFile(signed, sess, size)
    h5 = h5py.File(fh, "r")
    return h5, fh, "https-range"
