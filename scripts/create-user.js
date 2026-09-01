#!/usr/bin/env node
'use strict';

// Создать или обновить пользователя Timesheet.
// Usage: node scripts/create-user.js <username> <password> [--role user|admin] [--fio "ФИО"]

const path = require('path');
const { db, initDb, generatePasswordHash } = require(path.join(__dirname, '..', 'server.js'));

function parseArgs(argv) {
  const positional = [];
  const options = { role: 'user', fio: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--role') {
      options.role = argv[++i];
    } else if (arg === '--fio') {
      options.fio = argv[++i];
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const [username, password] = positional;

  if (!username || !password) {
    console.error('Usage: node scripts/create-user.js <username> <password> [--role user|admin] [--fio "ФИО"]');
    return 1;
  }
  if (!['user', 'admin'].includes(options.role)) {
    console.error(`Invalid --role: ${options.role} (expected user|admin)`);
    return 1;
  }

  initDb();
  const passwordHash = generatePasswordHash(password);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  let action;
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, role = ?, default_fio = ? WHERE id = ?').run(
      passwordHash,
      options.role,
      options.fio,
      existing.id
    );
    action = 'updated';
  } else {
    db.prepare('INSERT INTO users (username, password_hash, role, default_fio) VALUES (?, ?, ?, ?)').run(
      username,
      passwordHash,
      options.role,
      options.fio
    );
    action = 'created';
  }

  console.log(`User '${username}' ${action} (role=${options.role})`);
  return 0;
}

process.exitCode = main();
