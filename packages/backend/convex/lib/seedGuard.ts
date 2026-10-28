/**
 * Seeding writes a demo account and demo rows, so it must only ever touch a
 * local development deployment. Production's `SITE_URL` is the https Vercel
 * URL; local deployments use `http://localhost` or `http://127.0.0.1`.
 *
 * The check parses the URL instead of only comparing prefixes so a host such
 * as `http://localhost.example.com` is rejected.
 */
export function isLocalSiteUrl(siteUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

export function assertSeedDeployment(siteUrl: string): void {
  if (!isLocalSiteUrl(siteUrl)) {
    throw new Error(
      `Refusing to seed: SITE_URL must point at a local dev deployment (http://localhost or http://127.0.0.1), got "${siteUrl}". Seeding production is never allowed.`,
    );
  }
}