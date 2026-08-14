import { afterEach, describe, expect, it } from "vitest";

import {
  isPostgresSoleWriterCrmV1Enabled,
  POSTGRES_SOLE_WRITER_CRM_V1_FLAG,
} from "@/lib/db/postgres-sole-writer-crm-flags";

describe("postgres_sole_writer_crm_v1 flag", () => {
  const prev = {
    server: process.env.POSTGRES_SOLE_WRITER_CRM_V1,
    public: process.env.NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1,
  };

  afterEach(() => {
    if (prev.server === undefined) delete process.env.POSTGRES_SOLE_WRITER_CRM_V1;
    else process.env.POSTGRES_SOLE_WRITER_CRM_V1 = prev.server;
    if (prev.public === undefined) delete process.env.NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1;
    else process.env.NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1 = prev.public;
  });

  it("defaults off", () => {
    delete process.env.POSTGRES_SOLE_WRITER_CRM_V1;
    delete process.env.NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1;
    expect(isPostgresSoleWriterCrmV1Enabled()).toBe(false);
    expect(POSTGRES_SOLE_WRITER_CRM_V1_FLAG).toBe("postgres_sole_writer_crm_v1");
  });

  it("is on when POSTGRES_SOLE_WRITER_CRM_V1=true", () => {
    process.env.POSTGRES_SOLE_WRITER_CRM_V1 = "true";
    delete process.env.NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1;
    expect(isPostgresSoleWriterCrmV1Enabled()).toBe(true);
  });

  it("is on when NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1=true", () => {
    delete process.env.POSTGRES_SOLE_WRITER_CRM_V1;
    process.env.NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1 = "true";
    expect(isPostgresSoleWriterCrmV1Enabled()).toBe(true);
  });
});
