import "server-only";
import { cache } from "react";
import release from "../data/public-release.json";
import { createProvisionalRelease } from "../domain/provisional";
import { loadPublicSnapshot } from "./persistent-store";

let fileDataset: ReturnType<typeof createProvisionalRelease> | undefined;

// React memoizes this read within a server-rendered request, not across requests.
// A configured store must succeed; an error never reactivates an older file.
export const getRealDataset = cache(async () => {
  const snapshot = await loadPublicSnapshot();
  if (snapshot !== null) return createProvisionalRelease(snapshot.document);
  fileDataset ??= createProvisionalRelease(release);
  return fileDataset;
});
