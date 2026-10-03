import "server-only";
import release from "../data/public-release.json";
import { createProvisionalRelease } from "../domain/provisional";

export const realDataset = createProvisionalRelease(release);
