import { lookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * API Call nodes can only reach public IPv4 destinations.
 * The custom DNS lookup runs at socket-connection time, preventing a second
 * unvalidated DNS resolution from redirecting the socket to a private address.
 * IPv6-only destinations are intentionally unsupported until equally strict
 * IPv6 address-policy coverage is added.
 */
export const MAX_API_RESPONSE_BYTES = 512 * 1024;
export const MAX_API_BODY_BYTES = 64 * 1024;
export const MAX_API_TIMEOUT_MS = 30_000;

const hostnameDenied = /(^|\.)((localhost)|(local)|(internal)|(home)|(lan)|(test)|(invalid))$/i;

export function isPublicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 255) return false;
  return true;
}

export function validatePublicApiUrl(rawUrl: string): URL {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new Error('API Call requires a valid absolute HTTPS or HTTP URL.'); }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:')
    || !url.hostname || url.username || url.password
    || url.hash || hostnameDenied.test(url.hostname)) {
    throw new Error('API Call destination is not permitted.');
  }
  // WHATWG URL parsing canonicalizes legacy decimal, octal, and hex IPv4.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(host);
  if (family === 6 || (family === 4 && !isPublicIPv4(host))) {
    throw new Error('API Call destination is not permitted.');
  }
  if (rawUrl.length > 2_048) throw new Error('API Call URL exceeds the maximum length.');
  return url;
}

const secureLookup: LookupFunction = (hostname, _options, callback) => {
  // Only look up A records; the selected public address goes directly into
  // the actual socket connection, not through a second lookup.
  lookup(hostname, { family: 4, all: true }, (error, records) => {
    if (error) { callback(error, '', 4); return; }
    if (!records.length || records.some((record) => record.family !== 4 || !isPublicIPv4(record.address))) {
      callback(new Error('API Call destination is not permitted.'), '', 4);
      return;
    }
    callback(null, records[0].address, 4);
  });
};

function sanitizeRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
      || /^(host|connection|transfer-encoding|content-length|proxy-authorization|upgrade|te|trailer)$/i.test(key)
      || typeof value !== 'string' || /[\r\n]/.test(value)) {
      throw new Error('API Call contains an unsupported request header.');
    }
    safe[key] = value;
  }
  return safe;
}

export interface PublicHttpResult {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') normalized[key] = value;
    else if (Array.isArray(value)) normalized[key] = value.join(', ');
  }
  return normalized;
}

/** No auto redirects, no privileged addresses, no streamed oversized payloads. */
export function requestPublicHttp(
  rawUrl: string,
  options: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number },
): Promise<PublicHttpResult> {
  const url = validatePublicApiUrl(rawUrl);
  const method = options.method.toUpperCase();
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new Error('API Call HTTP method is not supported.');
  const headers = sanitizeRequestHeaders(options.headers);
  const timeoutMs = options.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_API_TIMEOUT_MS) {
    throw new Error('API Call timeout is outside allowed limits.');
  }
  const body = method === 'GET' ? undefined : options.body;
  if (body && Buffer.byteLength(body, 'utf8') > MAX_API_BODY_BYTES) {
    throw new Error('API Call request body exceeds 64 KB.');
  }

  return new Promise<PublicHttpResult>((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, {
      method,
      headers,
      lookup: secureLookup,
      agent: false,
      maxHeaderSize: 16 * 1024,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        // Do not follow redirect targets, which could point at metadata or LAN hosts.
        res.destroy();
        reject(new Error('API Call redirects are blocked for security.'));
        return;
      }
      let count = 0;
      const chunks: Buffer[] = [];
      res.on('data', (value: Buffer | string) => {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        count += chunk.length;
        if (count > MAX_API_RESPONSE_BYTES) {
          req.destroy(new Error('API Call response exceeds 512 KB.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const responseHeaders = normalizeHeaders(res.headers);
          const contentType = responseHeaders['content-type'] ?? '';
          const data = contentType.includes('application/json') ? JSON.parse(raw) : raw;
          resolve({ status, headers: responseHeaders, data });
        } catch {
          reject(new Error('API Call response contained invalid JSON.'));
        }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('API Call request timed out.')), timeoutMs);
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}
