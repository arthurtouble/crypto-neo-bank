/** Current versions of the customer-facing legal documents. Bump a version when its text changes materially. */
export const legalDocuments = {
  terms: { key: "terms_of_use", version: "2026-10-01", path: "/legal/terms-of-use/" },
  privacy: { key: "privacy_notice", version: "2026-10-01", path: "/legal/privacy-notice/" }
} as const;

/** The notice shown next to the product-updates choice. */
export const marketingNoticeVersion = "2026-09-25";
