/**
 * What search engines may see. Only production is indexed: dev, previews, and local runs ask not to be. Within
 * production, only the public pages are: the landing page. The app (example data or a customer's own), the API,
 * payment pages (a person's public tag, not something to surface in search), and the unavailable page are not.
 */
export const siteOrigin = () => process.env.APP_ORIGIN || undefined;
export const indexable = () => process.env.PRODUCT_ENVIRONMENT === "production";
export const publicPaths = ["/"];
export const privatePaths = ["/app", "/api/", "/pay/", "/unavailable"];
