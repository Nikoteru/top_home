const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL?.trim();
const storage = process.env.DATA_STORE?.trim() || (connectionString ? 'postgres' : 'json');
if (!['json', 'postgres'].includes(storage)) throw new Error('DATA_STORE должен быть json или postgres.');

const enabled = storage === 'postgres';
let pool;

function getPool() {
  if (!enabled) throw new Error('Для подключения к PostgreSQL задайте DATABASE_URL или DATA_STORE=postgres.');
  if (!pool) {
    pool = new Pool({
      connectionString,
      options: '-c search_path=top_home,pg_catalog',
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (error) => console.error('Соединение с PostgreSQL прервано.', error.code || ''));
  }
  return pool;
}

function query(sql, values) {
  return getPool().query(sql, values);
}

async function transaction(work) {
  const client = await getPool().connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

async function assertReady() {
  if (!enabled) return;
  const { rows: [row] } = await query("SELECT to_regclass('top_home.site_content') IS NOT NULL AS ready");
  if (row.ready && (await query('SELECT 1 FROM site_content WHERE singleton')).rowCount) return;
  throw new Error('База сайта ещё не заполнена. Выполните npm run db:migrate.');
}

function close() {
  return pool?.end();
}

module.exports = { enabled, getPool, query, transaction, assertReady, close };
