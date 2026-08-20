import { describe, expect, it } from "vitest";
import { LISTING_STATUSES } from "../../src/domain/listing.js";
describe("status model", () => { it("contains recoverable and terminal states", () => { expect(LISTING_STATUSES).toContain("INVALID_BALANCE"); expect(LISTING_STATUSES).toContain("CANCELLED"); expect(LISTING_STATUSES).toContain("PARTIALLY_FILLED"); }); });
