// Read-only peek at what Meridian has written to Neon.
//   node .capture/neon-check.cjs
const path = require("path");
const api = path.join(__dirname, "..", "packages", "api");
require(require.resolve("dotenv", { paths: [api] })).config({ path: path.join(api, ".env") });
const { Pool } = require(require.resolve("pg", { paths: [api] }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const tables = await pool.query(
    "select table_name from information_schema.tables where table_schema='public' order by 1"
  );
  console.log("tables:", tables.rows.map((r) => r.table_name).join(", ") || "(none)");
  for (const { table_name } of tables.rows) {
    const { rows } = await pool.query(`select count(*)::int as n from "${table_name}"`);
    console.log(`  ${table_name}: ${rows[0].n} rows`);
  }
  if (tables.rows.some((r) => r.table_name === "audit_log")) {
    const { rows } = await pool.query(
      "select at, actor, action, service, entity, result, detail from audit_log order by at desc limit 10"
    );
    console.table(rows);
  }
  await pool.end();
})().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
