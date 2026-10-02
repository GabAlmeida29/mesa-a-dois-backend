import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { analyticsEvents } from '../db/schema';
import { env } from '../config/env';
import { SESSION_COOKIE, findSession } from '../auth/session';
import { analyticsQuerySchema, collectSchema } from '../schemas';
import { locate } from './geoip';
import { isBot, parseUserAgent } from './user-agent';

type CollectInput = z.infer<typeof collectSchema>;
type SummaryQuery = z.infer<typeof analyticsQuerySchema>;

const TIME_ZONE = 'America/Sao_Paulo';

let salt = { day: '', value: '' };

function dailySalt() {
  const day = new Date().toISOString().slice(0, 10);
  if (salt.day !== day) salt = { day, value: randomBytes(16).toString('hex') };
  return salt.value;
}

function visitorHash(ip: string, userAgent: string) {
  return createHash('sha256').update(`${dailySalt()}|${ip}|${userAgent}`).digest('hex').slice(0, 32);
}

function normalizePath(path: string) {
  const clean = path.split(/[?#]/)[0] || '/';
  return clean.startsWith('/') ? clean.slice(0, 300) : `/${clean}`.slice(0, 300);
}

function referrerHost(referrer: string | undefined, ownHost: string | undefined) {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    return host && host !== ownHost?.replace(/^www\./, '') ? host.slice(0, 200) : null;
  } catch {
    return null;
  }
}

async function rows<T>(query: ReturnType<typeof sql>) {
  const result = await db.execute(query);
  return result.rows as T[];
}

export const analyticsService = {
  async collect(req: Request, input: CollectInput) {
    const userAgent = req.get('user-agent');
    if (isBot(userAgent)) return;

    const ip = req.ip ?? '';
    const [session, geo] = await Promise.all([findSession(req.cookies?.[SESSION_COOKIE]), locate(ip)]);
    const client = parseUserAgent(userAgent!);

    await db.insert(analyticsEvents).values({
      type: input.type,
      path: normalizePath(input.path),
      target: input.type === 'click' ? (input.target?.slice(0, 120) ?? null) : null,
      referrerHost: referrerHost(input.referrer, req.hostname),
      visitorHash: visitorHash(ip, userAgent!),
      ...geo,
      ...client,
      isAdmin: Boolean(session),
    });
  },

  async purgeOld() {
    const cutoff = new Date(Date.now() - env.ANALYTICS_RETENTION_DAYS * 86_400_000);
    await db.delete(analyticsEvents).where(lt(analyticsEvents.occurredAt, cutoff));
  },

  async summary({ days, includeAdmin }: SummaryQuery) {
    const scope = sql`occurred_at >= now() - make_interval(days => ${days})
      and (${includeAdmin} or not is_admin)`;
    const day = sql.raw(`(occurred_at at time zone '${TIME_ZONE}')::date`);
    const visitor = sql`${day}::text || visitor_hash`;

    const [totals] = await rows<{ pageviews: number; clicks: number; visitors: number }>(sql`
      select count(*) filter (where type = 'pageview')::int as pageviews,
             count(*) filter (where type = 'click')::int as clicks,
             count(distinct ${visitor})::int as visitors
      from analytics_events where ${scope}`);

    const [daily, pages, clicks, countries, cities, devices, browsers, systems, referrers, recent] =
      await Promise.all([
        rows<{ day: string; pageviews: number; visitors: number }>(sql`
          with days as (
            select generate_series(
              (now() at time zone ${TIME_ZONE})::date - (${days} - 1),
              (now() at time zone ${TIME_ZONE})::date,
              interval '1 day')::date as day)
          select to_char(d.day, 'YYYY-MM-DD') as day,
                 count(e.*) filter (where e.type = 'pageview')::int as pageviews,
                 count(distinct e.visitor_hash)::int as visitors
          from days d
          left join analytics_events e
            on (e.occurred_at at time zone ${TIME_ZONE})::date = d.day
           and (${includeAdmin} or not e.is_admin)
          group by d.day order by d.day`),
        rows<{ path: string; views: number; visitors: number }>(sql`
          select path, count(*)::int as views, count(distinct ${visitor})::int as visitors
          from analytics_events where ${scope} and type = 'pageview'
          group by path order by views desc limit 10`),
        rows<{ target: string; path: string; clicks: number }>(sql`
          select target, path, count(*)::int as clicks
          from analytics_events where ${scope} and type = 'click' and target is not null
          group by target, path order by clicks desc limit 15`),
        rows<{ country: string; visitors: number }>(sql`
          select coalesce(country, '??') as country, count(distinct ${visitor})::int as visitors
          from analytics_events where ${scope}
          group by 1 order by visitors desc limit 10`),
        rows<{
          city: string;
          region: string | null;
          country: string | null;
          visitors: number;
          latitude: number;
          longitude: number;
        }>(sql`
          select city, max(region) as region, max(country) as country,
                 count(distinct ${visitor})::int as visitors,
                 avg(latitude)::float as latitude, avg(longitude)::float as longitude
          from analytics_events where ${scope} and city is not null and latitude is not null
          group by city order by visitors desc limit 50`),
        rows<{ label: string; visitors: number }>(sql`
          select coalesce(device, 'Outro') as label, count(distinct ${visitor})::int as visitors
          from analytics_events where ${scope} group by 1 order by visitors desc`),
        rows<{ label: string; visitors: number }>(sql`
          select coalesce(browser, 'Outro') as label, count(distinct ${visitor})::int as visitors
          from analytics_events where ${scope} group by 1 order by visitors desc limit 6`),
        rows<{ label: string; visitors: number }>(sql`
          select coalesce(os, 'Outro') as label, count(distinct ${visitor})::int as visitors
          from analytics_events where ${scope} group by 1 order by visitors desc limit 6`),
        rows<{ host: string; visitors: number }>(sql`
          select referrer_host as host, count(distinct ${visitor})::int as visitors
          from analytics_events where ${scope} and referrer_host is not null
          group by 1 order by visitors desc limit 10`),
        rows<{
          occurredAt: string;
          type: string;
          path: string;
          target: string | null;
          city: string | null;
          country: string | null;
          device: string | null;
        }>(sql`
          select occurred_at as "occurredAt", type, path, target, city, country, device
          from analytics_events where ${scope}
          order by occurred_at desc limit 25`),
      ]);

    return {
      days,
      includeAdmin,
      totals,
      daily,
      pages,
      clicks,
      countries,
      cities,
      devices,
      browsers,
      systems,
      referrers,
      recent,
    };
  },
};
