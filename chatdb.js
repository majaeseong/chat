// var pg = require("pg");
// var conString =
//   "postgresql://postgres.qrdzkvvljbjjadifryul:HS87L2fSWrEHZZiI@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres";

// var client = new pg.Client(conString);

// module.exports = client;

const { Pool } = require("pg");
const conString =
  "postgresql://postgres.qrdzkvvljbjjadifryul:HS87L2fSWrEHZZiI@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres";

const pool = new Pool({
  connectionString: conString,
});

module.exports = pool;

// pool.connect();

// pool.query("SELECT 'USERS'", (err, res) => {
//   console.log(err, res);
//   pool.end();
// });
