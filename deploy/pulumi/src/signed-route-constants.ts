export const SIGNED_INTERNAL_ROUTE = {
  routeName: "app-signed",
  pathPrefix: "/api/internal/signed/",
  maxBodyBytes: 27 * 1024 * 1024,
  requestTimeout: "120s",
  refusalFilterName: "signed-body-limit",
} as const;
