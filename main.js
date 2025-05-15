const fs = require('fs');
const path = require('path');
const { CohereClient } = require('cohere-ai');

const cohere = new CohereClient({
  token: 'IF3V69gGak6GCOuN7gn6CeQMEl4HXq1yecgBackK',
});

const DB_PATH = path.join(__dirname, 'cerebro.json');
let memoria = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH)) : {};

function guardarMemoria() {
  fs.writeFileSync(DB_PATH, JSON.stringify(memoria, null, 2));
}

function inicializarChat(jid) {
  if (!memoria[jid]) {
    memoria[jid] = {
      creador: false,
      usuarios: {},
    };
    guardarMemoria();
  }
}

function inicializarUsuario(jidChat, jidUsuario) {
  if (!memoria[jidChat].usuarios[jidUsuario]) {
    memoria[jidChat].usuarios[jidUsuario] = {
      saludado: false,
      historial: [],
    };
  }
}

function agregarAlHistorial(jidChat, jidUsuario, role, content) {
  memoria[jidChat].usuarios[jidUsuario].historial.push({ role, content });
  guardarMemoria();
}

function generarPrompt(historial, nuevoMensaje) {
  let prompt = `Sos un asistente llamado Lucky. Tenés una personalidad relajada, cercana y respondés como si charlaras con un amigo, sin sonar robótico ni formal.\n\n`;

  // Tomar el primer mensaje si existe y los últimos 5 mensajes para contexto
  const primeros = historial.length > 6 ? [historial[0]] : [];
  const ultimos = historial.slice(-5);
  const contexto = [...primeros, ...ultimos];

  contexto.forEach(({ role, content }) => {
    prompt += `${role === 'user' ? 'Usuario' : 'Lucky'}: ${content}\n`;
  });

  prompt += `Usuario: ${nuevoMensaje}\nLucky:`;
  return prompt;
}

async function responderConCohere(prompt) {
  try {
    const res = await cohere.generate({
      model: 'command-r-plus',
      prompt,
      maxTokens: 200,
      temperature: 0.9,
    });
    return res.generations[0].text.trim();
  } catch (err) {
    console.error('Error al responder:', err.message);
    return 'Tuve un problema para responder. ¿Probamos de nuevo?';
  }
}

module.exports = function (sock) {
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jidChat = msg.key.remoteJid;
    const jidUsuario = msg.key.participant || msg.key.remoteJid;
    const texto = msg.message.conversation || msg.message?.extendedTextMessage?.text || '';
    if (!texto) return;

    inicializarChat(jidChat);
    inicializarUsuario(jidChat, jidUsuario);

    const usuarioData = memoria[jidChat].usuarios[jidUsuario];

    // Saludo solo una vez por usuario
    if (!usuarioData.saludado) {
      usuarioData.saludado = true;
      guardarMemoria();
      await sock.sendMessage(jidChat, {
        text: '¡Hola! Soy Lucky. ¿En qué puedo ayudarte?',
      });
      return;
    }

    // Pregunta por el creador (una sola vez por chat)
    if (/quién.*(te creó|es tu creador)|creador/i.test(texto) && !memoria[jidChat].creador) {
      memoria[jidChat].creador = true;
      guardarMemoria();
      const respuesta = 'Fui creado por cvalencia, un genio con mucha onda.';
      agregarAlHistorial(jidChat, jidUsuario, 'bot', respuesta);
      await sock.sendMessage(jidChat, { text: respuesta });
      return;
    }

    // Pregunta por el nombre
    if (
      /cómo te llamas|cual es tu nombre|quién sos|tu nombre/i.test(texto) &&
      !texto.toLowerCase().includes("me llamo")
    ) {
      const respuesta = 'Me llamo Lucky.';
      agregarAlHistorial(jidChat, jidUsuario, 'bot', respuesta);
      await sock.sendMessage(jidChat, { text: respuesta });
      return;
    }

    agregarAlHistorial(jidChat, jidUsuario, 'user', texto);

    const prompt = generarPrompt(usuarioData.historial, texto);
    const respuesta = await responderConCohere(prompt);

    agregarAlHistorial(jidChat, jidUsuario, 'bot', respuesta);
    await sock.sendMessage(jidChat, { text: respuesta });
  });
};

