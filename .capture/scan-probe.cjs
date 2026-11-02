const path = require("path");
const api = path.join(__dirname, "..", "packages", "api");
require(require.resolve("dotenv", { paths: [api] })).config({ path: path.join(api, ".env") });
const { Pool } = require(require.resolve("pg", { paths: [api] }));
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const q = async (s) => (await pool.query(s)).rows;
  console.log(JSON.stringify(await q(`select topic, payload from raw_messages where service='rta' and topic like '%/state/target' order by observed_at desc limit 2`)));
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
