const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { CohereClient } = require('cohere-ai');

const cohere = new CohereClient({
  token: 'IF3V69gGak6GCOuN7gn6CeQMEl4HXq1yecgBackK',
});

const DB_PATH = path.join(__dirname, 'cerebro.json');
let memoria = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH)) : {};

function guardarMemoria() {
  fs.writeFileSync(DB_PATH, JSON.stringify(memoria, null, 2));
}

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function downloadMediaMessage(message, mediaType = 'image') {
  const stream = await downloadContentFromMessage(message[mediaType + 'Message'], mediaType);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }
  return buffer;
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

function descargarYoutube(url, tipo = 'audio') {
  return new Promise((resolve, reject) => {
    const id = Date.now();
    const ext = tipo === 'audio' ? 'mp3' : 'mp4';
    const output = `${os.tmpdir()}/yt_${id}.${ext}`;

    const cmd = tipo === 'audio'
      ? `yt-dlp -f ba --extract-audio --audio-format mp3 --audio-quality 5 -o "${output}" "${url}"`
      : `yt-dlp -f "bv*[height<=480]+ba/b[height<=480]" --merge-output-format mp4 -o "${output}" "${url}"`;

    exec(cmd, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(output);
      }
    });
  });
}


module.exports = function (sock) {
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    try {
      const jidChat = msg.key.remoteJid;
      const jidUsuario = msg.key.participant || msg.key.remoteJid;
      const texto = msg.message.conversation || msg.message?.extendedTextMessage?.text || '';
      if (!texto) return;

      inicializarChat(jidChat);
      inicializarUsuario(jidChat, jidUsuario);

      const usuarioData = memoria[jidChat].usuarios[jidUsuario];

      // Saludo una sola vez por usuario
      if (!usuarioData.saludado) {
        usuarioData.saludado = true;
        guardarMemoria();
        await sock.sendMessage(jidChat, {
          text: '¡Hola! Soy Lucky. ¿En qué puedo ayudarte?',
        });
        return;
      }
 
if (msg.message?.imageMessage) {
  try {
    const buffer = await downloadMediaMessage(msg.message, 'image');
    const filePath = `/tmp/img_${Date.now()}.jpg`;
    fs.writeFileSync(filePath, buffer);

    const { createWorker } = require('tesseract.js');
    const worker = await createWorker();

    await worker.loadLanguage('spa');
    await worker.initialize('spa');
    const { data: { text } } = await worker.recognize(filePath);
    await worker.terminate();

    fs.unlinkSync(filePath);

    const textoDetectado = text.trim();
    const respuesta = textoDetectado
      ? `📝 Texto detectado:\n\n${textoDetectado}`
      : '❌ No pude detectar texto en la imagen.';

    await sock.sendMessage(msg.key.remoteJid, { text: respuesta }, { quoted: msg });

  } catch (err) {
    console.error('❌ Error al procesar la imagen:', err);
    await sock.sendMessage(msg.key.remoteJid, {
      text: '⚠️ Ocurrió un error al procesar la imagen.',
    }, { quoted: msg });
  }

  return;
}


      // Nombre del bot
      if (
        /cómo te llamas|cual es tu nombre|quién sos|tu nombre/i.test(texto) &&
        !texto.toLowerCase().includes("me llamo")
      ) {
        const respuesta = 'Me llamo Lucky.';
        agregarAlHistorial(jidChat, jidUsuario, 'bot', respuesta);
        await sock.sendMessage(jidChat, { text: respuesta });
        return;
      }

      // Pregunta por el creador
      if (/quién.*(te creó|es tu creador)|creador/i.test(texto) && !memoria[jidChat].creador) {
        memoria[jidChat].creador = true;
        guardarMemoria();
        const respuesta = 'Fui creado por cvalencia, un genio con mucha onda.';
        agregarAlHistorial(jidChat, jidUsuario, 'bot', respuesta);
        await sock.sendMessage(jidChat, { text: respuesta });
        return;
      }

      // Descarga YouTube
      if (/youtu\.be|youtube\.com/.test(texto) && /descargar|audio|video/i.test(texto)) {
        const tipo = /audio/i.test(texto) ? 'audio' : 'video';
        const link = texto.match(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)[^\s]+/i)?.[0];

        if (!link) {
          await sock.sendMessage(jidChat, { text: '❌ No encontré un enlace válido de YouTube.' });
          return;
        }

        await sock.sendMessage(jidChat, { text: `⏬ Descargando ${tipo} de YouTube...` });

        try {
          const archivo = await descargarYoutube(link, tipo);
          const nombre = tipo === 'audio' ? 'audio.m4a' : 'video.mp4';

          await sock.sendMessage(jidChat, {
            [tipo === 'audio' ? 'audio' : 'video']: { url: archivo },
            mimetype: tipo === 'audio' ? 'audio/mp4' : 'video/mp4',
            fileName: nombre,
          });
        } catch (err) {
          console.error('Error al descargar:', err.message);
          await sock.sendMessage(jidChat, {
            text: '❌ No pude descargar el video/audio. Verificá el enlace.',
          });
        }
        return;
      }

      // Chat normal con IA
      agregarAlHistorial(jidChat, jidUsuario, 'user', texto);
      const prompt = generarPrompt(usuarioData.historial, texto);
      const respuesta = await responderConCohere(prompt);
      agregarAlHistorial(jidChat, jidUsuario, 'bot', respuesta);
      await sock.sendMessage(jidChat, { text: respuesta });

    } catch (err) {
      console.error('❌ Error en procesamiento de mensaje:', err);
      await sock.sendMessage(msg.key.remoteJid, {
        text: '⚠️ Hubo un error procesando tu mensaje. ¿Querés intentar de nuevo?',
      });
    }
  });

  // Manejo global de errores fuera del flujo principal
  process.on('uncaughtException', (err) => {
    console.error('❌ Error no capturado:', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Rechazo no manejado en una promesa:', reason);
  });
};


