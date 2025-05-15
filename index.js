// index.js

// ─── Polyfill Web Crypto ───────────────────────────────────────────────────────
const { webcrypto } = require('crypto');
globalThis.crypto = webcrypto;

// ─── Imports ──────────────────────────────────────────────────────────────────
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const readline = require('readline');
const chalk = require('chalk');

// ─── Helper para preguntas ───────────────────────────────────────────────────
const question = (text) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(text, ans => { rl.close(); resolve(ans); }));
};

async function connectToWhatsApp() {
  // Carga/guarda credenciales en ./session/
  const { state, saveCreds } = await useMultiFileAuthState('session');
  const { version } = await fetchLatestBaileysVersion();

  // Si no hay credenciales previas, preguntar método
  let method = '1';
  if (!fs.existsSync('./session/creds.json')) {
    console.log(chalk.green('No se detectaron credenciales previas.'));
    while (true) {
      method = await question('Seleccione opción (1: QR / 2: Emparejamiento): ');
      if (method === '1' || method === '2') break;
      console.log(chalk.yellow('Opción inválida, ingrese 1 o 2.'));
    }
  }

  // Crea el socket con QR en terminal si toca
  const sock = makeWASocket({
    version,
    printQRInTerminal: method === '1',
    auth: state,
    logger: pino({ level: 'silent' })
  });

  // Si se elige emparejamiento, solicitar número y mostrar código
  if (method === '2') {
    const phone = await question('Ingrese su número (sin +, ej: 54911xxxxxxx): ');
    const code = await sock.requestPairingCode(phone.trim());
    console.log(chalk.blue('🔐 Código de emparejamiento:'), code);
    console.log('📱 En WhatsApp: Dispositivos vinculados → Vincular dispositivo → Ingrese este código');
  }

  // Cada vez que cambian las creds, las guardamos
  sock.ev.on('creds.update', saveCreds);

  // Manejo de conexión / desconexión
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log(chalk.greenBright('✅ Conectado a WhatsApp!'));
      require('./main')(sock); // conectar lógica de IA después de conexión
    }
    if (connection === 'close') {
      const loggedOut = lastDisconnect.error?.output?.statusCode === DisconnectReason.loggedOut;
      console.log(
        chalk.red('🔌 Conexión cerrada.'),
        loggedOut
          ? chalk.red('Se detectó logout, borra ./session/ para volver a emparejar.')
          : chalk.blue('Reintentando…')
      );
      if (!loggedOut) connectToWhatsApp();
    }

  });


}

connectToWhatsApp();

