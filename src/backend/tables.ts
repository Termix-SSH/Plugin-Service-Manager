import {
  defineTable,
  id,
  refHost,
  refUser,
  timestamp,
  varchar,
} from "@termix-ssh/plugin-sdk/db";

/** Units a user wants an alert for when they fail. */
export const watches = defineTable(
  "watches",
  {
    id: id(),
    userId: refUser(),
    hostId: refHost(),
    unit: varchar(255).notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  {
    uniques: [
      {
        name: "idx_p_service_manager_watches_user_host_unit",
        columns: ["userId", "hostId", "unit"],
      },
    ],
    indexes: [
      { name: "idx_p_service_manager_watches_host", columns: ["hostId"] },
    ],
  },
);

export const tables = [watches];
