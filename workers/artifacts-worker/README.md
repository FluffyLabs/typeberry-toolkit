# Artifacts Worker (Cloudflare)

Temporary artifact storage for PVM debugger links.

## Endpoints

- `POST /artifacts`

  - Body: raw bytes (`application/octet-stream` recommended)
  - Optional query params:
    - `ttl=<seconds>` (max 48 hours)
  - Response: `{ artifactId, downloadUrl, expiresAt, sizeBytes }`

- `GET /artifacts/:artifactId`

  - Returns raw bytes.
  - Response headers include `x-artifact-expires-at`.

- `GET /healthz`
  - Health check endpoint.

## Security Features

### Rate Limiting (Native Cloudflare)

The worker uses Cloudflare's native rate limiting API:

- **Upload**: 10 requests per minute per IP
- **Download**: 60 requests per minute per IP

These limits are enforced at the edge before reaching your worker code.

### Kill Switch

Set `USAGE_KILL_SWITCH=true` to immediately disable all non-health endpoints:

```bash
# Via wrangler secret
wrangler secret put USAGE_KILL_SWITCH
# Enter: true

# Or via environment variable (for testing)
wrangler dev --var USAGE_KILL_SWITCH:true
```

### TTL Limits

- **Minimum**: 60 seconds
- **Maximum**: 48 hours (hard-coded, cannot be exceeded)
- **Default**: 48 hours

Artifacts are automatically cleaned up by a scheduled worker running every hour.

## Configuration

Configure via `wrangler.toml` vars:

| Variable                   | Default   | Description                      |
| -------------------------- | --------- | -------------------------------- |
| `ARTIFACT_TTL_SECONDS`     | 172800    | Default TTL (48 hours)           |
| `MAX_ARTIFACT_TTL_SECONDS` | 172800    | Max TTL allowed (48 hours)       |
| `MAX_ARTIFACT_SIZE_BYTES`  | 1048576   | Max upload size (1 MB)           |
| `PUBLIC_BASE_URL`          | (auto)    | Base URL for download links      |
| `ALLOWED_ORIGINS`          | `*`       | CORS origins (comma-separated)   |
| `USAGE_KILL_SWITCH`        | false     | Set to "true" to disable service |

## Deploy

1. Create an R2 bucket:

   ```bash
   wrangler r2 bucket create pvm-artifacts
   ```

2. Update `wrangler.toml` with your settings:

   - Set `PUBLIC_BASE_URL` to your worker URL
   - Set `ALLOWED_ORIGINS` to restrict CORS

3. Deploy:

   ```bash
   npm run artifact:worker:deploy
   ```

## Local Dev

```bash
npm run artifact:worker:dev
```

## Cost Protection

To protect against unexpected costs:

1. **Set up billing alerts** in Cloudflare Dashboard:

   - Manage Account → Billing → Notifications
   - Set alerts at $10, $25, $50 thresholds

2. **Enable kill switch** if abuse detected:

   ```bash
   wrangler secret put USAGE_KILL_SWITCH
   # Enter: true
   ```

3. **Monitor usage** via Cloudflare Analytics dashboard

## Estimated Costs (Free Tier)

| Resource               | Free Tier | Notes                         |
| ---------------------- | --------- | ----------------------------- |
| Worker requests        | 100K/day  | ~70/minute sustained          |
| R2 Class A (uploads)   | 1M/month  |                               |
| R2 Class B (downloads) | 10M/month |                               |
| R2 Storage             | 10GB      | With 48h TTL, unlikely to hit |

With rate limiting, worst-case free tier usage:

- Uploads: 10/min × 60 × 24 = 14,400/day (within 100K)
- Downloads: 60/min per IP, distributed across users
