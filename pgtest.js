const { Client } = require('pg');

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'cephasgm',
  password: 'cephasgm_dev_password',
  database: 'cephasgm_gamezone',
});

client.connect()
  .then(() => client.query('SELECT current_user, current_database()'))
  .then(r => {
    console.log('SUCCESS:', r.rows);
    return client.end();
  })
  .catch(e => {
    console.log('FAILED');
    console.log('  message:', e.message);
    console.log('  code:   ', e.code);
    return client.end();
  });