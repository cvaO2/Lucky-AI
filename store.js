// store.js
const { makeInMemoryStore } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Creamos un store en memoria con logging silencioso
const store = makeInMemoryStore({
  logger: pino().child({ level: 'silent', stream: 'store' })
});

module.exports = store;
// Archivo store.js (puede contener lógica de almacenamiento si ya existe)
