// End-to-end check of researcher verification, from the ARL register through
// Meridian's API to the audit rows it leaves in Neon.
//
//   node .capture/auth-check.cjs            # rejections only, changes nothing
//   node .capture/auth-check.cjs --accept   # also acknowledges one open alert as arl-as3
//
// Needs the API running (npm run dev) on MERIDIAN_URL, default http://localhost:3000.
// No accepted device control is ever sent, so nothing reaches the live broker.
const path = require("path");
const api = path.join(__dirname, "..", "packages", "api");
require(require.resolve("dotenv", { paths: [api] })).config({ path: path.join(api, ".env") });
const { Pool } = require(require.resolve("pg", { paths: [api] }));

const ARL = process.env.ARL_URL || "http://wmc.ms.wits.ac.za:8080";
const MERIDIAN = process.env.MERIDIAN_URL || "http://localhost:3000";
const ACCEPT = process.argv.includes("--accept");

let failures = 0;
function check(label, ok, got) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${got})`}`);
}

async function call(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const post = (url, body, headers = {}) =>
  call(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

(async () => {
  console.log(`\n1. The register itself (${ARL})`);
  for (const [code, service, valid, reason] of [
    ["arl-as3", "lwm", true, null],
    ["arl-f2l", "lwm", false, "not_permitted"],
    ["arl-k9q", "opg", false, "defunct"],
    ["arl-zzz", "rta", false, "unknown"]
  ]) {
    const { body } = await post(`${ARL}/v1/researchers/verify`, { code, service });
    check(`${code} on ${service} -> ${valid ? "valid" : reason}`, body.valid === valid && (body.reason ?? null) === reason, JSON.stringify(body));
  }

  console.log(`\n2. Meridian's gate (${MERIDIAN})`);
  const open = await call(`${MERIDIAN}/api/alerts?status=raised&service=lwm&limit=1`);
  const alert = open.body.alerts?.[0];
  if (!alert) {
    console.log("  no raised lwm alert to act on - start the API and let it run until one is raised");
    process.exit(1);
  }
  console.log(`  using alert ${alert.id} (${alert.service}/${alert.device} ${alert.code})`);
  const ack = (code) =>
    post(`${MERIDIAN}/api/alerts/${alert.id}/acknowledge`, {}, code ? { "x-researcher-code": code } : {});

  for (const [label, code, status, error] of [
    ["no code -> 401", undefined, 401, "missing_researcher_code"],
    ["unknown code -> 403", "arl-zzz", 403, "invalid_researcher_code"],
    ["arl-f2l is not on lwm -> 403", "arl-f2l", 403, "service_access_denied"]
  ]) {
    const res = await ack(code);
    check(`acknowledge, ${label}`, res.status === status && res.body.error === error, `${res.status} ${JSON.stringify(res.body)}`);
  }

  const control = await post(
    `${MERIDIAN}/api/services/opg/control`,
    { entity: "batteries", control: "load_shed", value: true },
    { "x-researcher-code": "arl-k9q" }
  );
  check("control on opg as defunct arl-k9q -> 403", control.status === 403, `${control.status} ${JSON.stringify(control.body)}`);

  if (ACCEPT) {
    const res = await ack("arl-as3");
    check("acknowledge as arl-as3 -> 200", res.status === 200 && res.body.acknowledgedBy === "arl-as3", `${res.status} ${JSON.stringify(res.body)}`);
  }

  console.log("\n3. What Neon recorded in the last two minutes");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query(
    `select at, actor, action, service, entity, result, detail from audit_log
      where actor <> 'system' and at > now() - interval '2 minutes' order by at`
  );
  console.table(rows);
  check("every request above left an audit row", rows.length >= (ACCEPT ? 5 : 4), `${rows.length} rows`);
  if (ACCEPT) {
    const { rows: [row] } = await pool.query("select status, acknowledged_by from alerts where id = $1", [alert.id]);
    check("alert row now says who acknowledged it", row?.acknowledged_by === "arl-as3", JSON.stringify(row));
  }
  await pool.end();

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
