import assert from "node:assert/strict";
import { test } from "node:test";
import { isOurLock, PROTECT_DESC } from "../../lib/sheetLocks.ts";

const sa = "ppc-service@x.iam.gserviceaccount.com";

test("isOurLock: ล็อกของระบบ (ป้ายตรง หรือแก้ได้เฉพาะ service account) เท่านั้น", () => {
  assert.equal(isOurLock({ protectedRangeId: 1, description: PROTECT_DESC, editors: { users: [sa, "owner@x.com"] } }, sa), true);
  assert.equal(isOurLock({ protectedRangeId: 2, description: "", editors: { users: [sa.toUpperCase()] } }, sa), true);
  assert.equal(isOurLock({ protectedRangeId: 3, description: "เจ้าของล็อกเอง", editors: { users: ["owner@x.com"] } }, sa), false);
  assert.equal(isOurLock({ protectedRangeId: 4, editors: { users: [sa, "owner@x.com"] } }, sa), false);
  assert.equal(isOurLock({ protectedRangeId: 5, editors: { users: [sa], groups: ["tb@x.com"] } }, sa), false);
  assert.equal(isOurLock({ description: PROTECT_DESC }, sa), false);
});
