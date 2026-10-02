import path from 'node:path';
import { isIPv4, isIPv6 } from 'node:net';
import maxmind, { type Reader, type Response } from 'maxmind';
import { env } from '../config/env';

interface DbIpCity {
  city?: string;
  country_code?: string;
  state1?: string;
  latitude?: number;
  longitude?: number;
}

export interface GeoLocation {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

const EMPTY: GeoLocation = { country: null, region: null, city: null, latitude: null, longitude: null };

const readers = new Map<'ipv4' | 'ipv6', Promise<Reader<Response> | null>>();

function databaseFile(version: 'ipv4' | 'ipv6') {
  const dir = path.dirname(require.resolve('@ip-location-db/dbip-city-mmdb/package.json'));
  return path.join(dir, `dbip-city-${version}.mmdb`);
}

function reader(version: 'ipv4' | 'ipv6') {
  let pending = readers.get(version);
  if (!pending) {
    pending = maxmind.open<Response>(databaseFile(version)).catch((e) => {
      console.warn(`[geoip] base ${version} indisponível:`, e instanceof Error ? e.message : e);
      return null;
    });
    readers.set(version, pending);
  }
  return pending;
}

const clean = (v: string | undefined, max: number) => (v ? v.slice(0, max) : null);

export async function locate(ip: string | undefined): Promise<GeoLocation> {
  if (!env.GEOIP_ENABLED || !ip) return EMPTY;
  const address = ip.replace(/^::ffff:/, '');
  const version = isIPv4(address) ? 'ipv4' : isIPv6(address) ? 'ipv6' : null;
  if (!version) return EMPTY;

  const hit = (await reader(version))?.get(address) as DbIpCity | null | undefined;
  if (!hit) return EMPTY;
  return {
    country: clean(hit.country_code, 2),
    region: clean(hit.state1, 80),
    city: clean(hit.city, 80),
    latitude: hit.latitude ?? null,
    longitude: hit.longitude ?? null,
  };
}
