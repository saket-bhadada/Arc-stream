const path = require('path');
const pg = require(path.join(__dirname, '..', 'server', 'node_modules', 'pg'));
const c = new pg.Client({
  user: 'postgres',
  host: 'localhost',
  database: 'Arc_stream',
  password: 'Saket2006',
  port: 5433,
});

c.connect()
  .then(() => c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
  .then((r) => {
    if (r.rows.length === 0) {
      console.log('NO TABLES FOUND — schema was NOT applied.');
    } else {
      console.log('Tables in database:');
      r.rows.forEach((row) => console.log('  -', row.tablename));
      console.log('\nSchema IS being applied by db.js ✓');
    }
    c.end();
  })
  .catch((e) => {
    console.error('ERROR:', e.message);
    c.end();
  });
