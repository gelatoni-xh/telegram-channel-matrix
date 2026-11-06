WITH latest_runs AS (
  SELECT DISTINCT ON (operating_date) operating_date, report
  FROM matrix_runs
  WHERE operating_date >= current_date - 90
  ORDER BY operating_date, started_at DESC
), dates AS (
  SELECT operating_date FROM latest_runs
  UNION
  SELECT operating_date FROM matrix_publications WHERE operating_date >= current_date - 90
)
SELECT jsonb_build_object(
  'version', 1,
  'generatedAt', now(),
  'days', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'date', d.operating_date,
      'channels', (SELECT jsonb_agg(jsonb_build_object(
        'key', c.key,
        'status', COALESCE(p.status, s.entry->>'status', 'no_run'),
        'publishedItems', CASE WHEN p.status = 'sent' THEN jsonb_array_length(p.payload->'items') ELSE 0 END,
        'messageId', p.message_id,
        'sentAt', p.sent_at,
        'url', CASE WHEN p.status = 'sent' AND c.username IS NOT NULL THEN 'https://t.me/' || c.username || '/' || p.message_id::text ELSE NULL END,
        'memberCount', CASE WHEN s.entry->>'memberCount' ~ '^[0-9]+$' THEN (s.entry->>'memberCount')::integer ELSE NULL END,
        'collectedAt', s.entry->>'collectedAt'
      ) ORDER BY c.key)
      FROM (VALUES ('ai','ai_product_radar_cn'),('steam','steam_deals_radar_cn')) AS c(key,username)
      LEFT JOIN matrix_publications p ON p.channel=c.key AND p.operating_date=d.operating_date
      LEFT JOIN LATERAL (SELECT value AS entry FROM latest_runs r, jsonb_array_elements(r.report->'channelSnapshots') value
        WHERE r.operating_date=d.operating_date AND value->>'channel'=c.key LIMIT 1) s ON true)
    ) ORDER BY d.operating_date)
    FROM dates d
  ), '[]'::jsonb)
)::text;
