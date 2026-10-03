import "server-only";

// The fictional database is an explicit, local development mode.
// Deployments serve the versioned, source-backed release by default.
export function isLocalFictional() {
  return Boolean(process.env.NOEMAP_RUNTIME_FILE);
}
