import { describe, expect, it } from "vitest";

import {
  isPostgresSoleWriterCrmV1Enabled,
  POSTGRES_SOLE_WRITER_CRM_V1_FLAG,
} from "@/lib/db/postgres-sole-writer-crm-flags";

describe("postgres_sole_writer_crm_v1 flag", () => {
  it("is always on after P7 cutover", () => {
    expect(isPostgresSoleWriterCrmV1Enabled()).toBe(true);
    expect(POSTGRES_SOLE_WRITER_CRM_V1_FLAG).toBe("postgres_sole_writer_crm_v1");
  });
});
