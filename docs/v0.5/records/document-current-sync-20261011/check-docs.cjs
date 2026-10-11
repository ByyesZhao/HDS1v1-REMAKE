// Reuse the earlier checker without overwriting its historical evidence.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../document-current-sync-20261010/check-docs.cjs'), 'utf8')
  .replaceAll('2026-10-10', '2026-10-11')
  .replaceAll('726eb00', '65f0785');
vm.runInNewContext(source, { require, __dirname, console, process, URL });
