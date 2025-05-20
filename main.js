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

function extraerJidsDeTexto(texto) {
  const tags = [];
  const regex = /@(\d{5,})/g;
  let match;
  while ((match = regex.exec(texto)) !== null) {
    tags.push(match[1] + "@s.whatsapp.net");
  }
  return tags;
}

function esComandoExpulsion(texto) {
  return /(expuls(a|ar)|elimin(a|ar)|banea|saca(a|ar)|kick|remove|echa)[\s\S]+/i.test(texto);
}

function esComandoQuitarAdmin(texto) {
  return /(quitar[\s\-]?admin|remover[\s\-]?admin|sin[\s\-]?admin|saca[\s\-]?admin|remove[\s\-]?admin|remove[\s\-]?adm|remove\-adm|quitar\-adm|remover\-adm|quitale el admin a)/i.test(texto);
}

function esComandoDarAdmin(texto) {
  return /(dar[\s\-]?admin|haz[\s\-]?admin|pon[\s\-]?admin|sube[\s\-]?admin|make[\s\-]?admin|set[\s\-]?admin|op|promote|promover[\s\-]?admin|ascender|ascender[\s\-]?admin|dale admin a)/i.test(texto);
}

function obtenerJidsComando(texto) {
  return extraerJidsDeTexto(texto);
}

// Saber si el comando es para el bot (mencionado, lucky o número)
function comandoEsParaBot({ texto, mentionedJids, botJid, botNumero }) {
  if (
    (Array.isArray(mentionedJids) && mentionedJids.some(jid =>
      jid.split(/[:@]/)[0] === botJid.split(/[:@]/)[0]
    ))
    ||
    texto.toLowerCase().includes("lucky")
    ||
    texto.replace(/[\s\+\-\(\)]/g, '').includes(botNumero)
  ) {
    return true;
  }
  return false;
}

module.exports = function (sock) {
  sock.ev.on('connection.update', (update) => {
    const { connection } = update;
    if (typeof connection !== "undefined") {
      console.log("Estado conexión:", connection);
    }
    if (connection === 'open') console.log("✅ ¡Conectado a WhatsApp!");
    if (connection === 'close') console.log("❌ Desconectado de WhatsApp.");
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    try {
      const jidChat = msg.key.remoteJid;
      const jidUsuario = msg.key.participant || msg.key.remoteJid;
      const texto =
        msg.message.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';
      if (!texto) return;

      inicializarChat(jidChat);
      inicializarUsuario(jidChat, jidUsuario);

      const usuarioData = memoria[jidChat].usuarios[jidUsuario];
      const isGroup = jidChat.endsWith('@g.us');
      const botJid = sock.user.id;
      const botNumero = (botJid.split('@')[0] || '').replace(/[^0-9]/g, '');
      let mentionedJids = [];
      if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid) {
        mentionedJids = msg.message.extendedTextMessage.contextInfo.mentionedJid;
      } else if (msg.message?.imageMessage?.contextInfo?.mentionedJid) {
        mentionedJids = msg.message.imageMessage.contextInfo.mentionedJid;
      } else if (msg.message?.contextInfo?.mentionedJid) {
        mentionedJids = msg.message.contextInfo.mentionedJid;
      }

      // ======= BANEO AUTOMÁTICO DE MENORES DE 15 (MENSAJE PROPIO) =======
      if (isGroup) {
        const edadMatch = texto.match(/(?:tengo|edad es|edad:|edad=|cumplo|soy)\s*(\d{1,2})\s*a?ñ?o?s?/i);
        if (edadMatch) {
          const edad = parseInt(edadMatch[1]);
          if (edad < 15) {
            function limpiarJid(jid) {
              if (!jid) return '';
              const limpio = jid.split(':')[0];
              return limpio.endsWith('@s.whatsapp.net') ? limpio : limpio + '@s.whatsapp.net';
            }
            let userJidClean = '';
            if (msg.key.participant) {
              userJidClean = limpiarJid(msg.key.participant);
            } else if (msg.participant) {
              userJidClean = limpiarJid(msg.participant);
            } else if (msg.pushName) {
              userJidClean = limpiarJid(msg.pushName);
            } else {
              userJidClean = limpiarJid(jidUsuario);
            }
            const botId = limpiarJid(sock.user.id);
            if(userJidClean === botId) return;
            try {
              const groupMetadata = await sock.groupMetadata(jidChat);
              const botIsAdmin = groupMetadata.participants.find(
                p => p.id === botId && (p.admin === 'admin' || p.admin === 'superadmin')
              );
              if (!botIsAdmin) {
                await sock.sendMessage(jidChat, {
                  text: `No soy admin, no puedo expulsar.`
                });
                return;
              }
              await sock.sendMessage(jidChat, {
                text: `Expulsando a menores de 15 años: @${userJidClean.split('@')[0]}`,
                mentions: [userJidClean]
              });
              try {
                await sock.groupParticipantsUpdate(jidChat, [userJidClean], 'remove');
              } catch (expErr) {
                await sock.sendMessage(jidChat, { text: "No pude expulsar (¿WhatsApp lo bloqueó?)." });
              }
            } catch (e) {
              await sock.sendMessage(jidChat, { text: "Error inesperado expulsando." });
            }
            return;
          }
        }
      }
      // ======= FIN BLOQUE BANEO Y EXPULSIÓN MANUAL =======

      // ======= BLOQUE DE EXPULSIÓN POR COMANDO O RESPUESTA (SOLO SI ES PARA EL BOT) =======
      if (
        isGroup &&
        esComandoExpulsion(texto) &&
        comandoEsParaBot({ texto, mentionedJids, botJid, botNumero })
      ) {
        let jidsAExpulsar = [];
        const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // Añade todos los mencionados MENOS el bot y el que ejecuta el comando
        if (Array.isArray(mentionedJids)) {
          jidsAExpulsar = mentionedJids
            .filter(jid => jid !== botId && jid !== jidUsuario);
        }

        // Añade tags de texto tipo @1234...
        const jidsDeTexto = obtenerJidsComando(texto)
          .filter(jid => jid !== botId && jid !== jidUsuario);

        jidsAExpulsar = [...new Set([...jidsAExpulsar, ...jidsDeTexto])];

        // Si NO hay mencionados/tags y es reply, expulsa al autor del reply (si no es bot ni quien ejecuta)
        let contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.contextInfo;
        if (
          jidsAExpulsar.length === 0 &&
          contextInfo &&
          contextInfo.participant &&
          contextInfo.participant !== botId &&
          contextInfo.participant !== jidUsuario
        ) {
          jidsAExpulsar.push(contextInfo.participant);
        }

        // Filtro extra para máxima seguridad de no autoban ni banearse a sí mismo
        jidsAExpulsar = jidsAExpulsar.filter(j => j !== botId && j !== jidUsuario);

        if (jidsAExpulsar.length > 0) {
          const groupMetadata = await sock.groupMetadata(jidChat);
          const botIsAdmin = groupMetadata.participants.find(
            p => p.id === botId && (p.admin === 'admin' || p.admin === 'superadmin')
          );
          if (!botIsAdmin) {
            await sock.sendMessage(jidChat, { text: "No soy admin, no puedo expulsar." });
            return;
          }
          for (const user of jidsAExpulsar) {
            if (user === botId || user === jidUsuario) continue; // nunca autobanearse ni banear al que ejecuta
            await sock.sendMessage(jidChat, { text: `Expulsando a: @${user.split('@')[0]}`, mentions: [user] });
            try {
              await sock.groupParticipantsUpdate(jidChat, [user], 'remove');
            } catch (e) {
              await sock.sendMessage(jidChat, { text: `No pude expulsar a @${user.split('@')[0]}` });
            }
          }
          return;
        }
      }
      // ======= FIN BLOQUE DE EXPULSIÓN POR COMANDO O RESPUESTA =======

      // ========== BLOQUE QUITAR ADMIN ==========
      if (
        isGroup &&
        esComandoQuitarAdmin(texto) &&
        comandoEsParaBot({ texto, mentionedJids, botJid, botNumero })
      ) {
        let jidsADemotear = [];
        const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        if (Array.isArray(mentionedJids)) {
          jidsADemotear = mentionedJids.filter(jid => jid !== botId && jid !== jidUsuario);
        }
        const jidsDeTexto = obtenerJidsComando(texto).filter(jid => jid !== botId && jid !== jidUsuario);
        jidsADemotear = [...new Set([...jidsADemotear, ...jidsDeTexto])];

        let contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.contextInfo;
        if (
          jidsADemotear.length === 0 &&
          contextInfo &&
          contextInfo.participant &&
          contextInfo.participant !== botId &&
          contextInfo.participant !== jidUsuario
        ) {
          jidsADemotear.push(contextInfo.participant);
        }

        // Filtro extra para máxima seguridad de no auto-demotear ni demotearse a sí mismo
        jidsADemotear = jidsADemotear.filter(j => j !== botId && j !== jidUsuario);

        if (jidsADemotear.length > 0) {
          const groupMetadata = await sock.groupMetadata(jidChat);
          const botIsAdmin = groupMetadata.participants.find(
            p => p.id === botId && (p.admin === 'admin' || p.admin === 'superadmin')
          );
          if (!botIsAdmin) {
            await sock.sendMessage(jidChat, { text: "No soy admin, no puedo quitar admin." });
            return;
          }
          for (const user of jidsADemotear) {
            if (user === botId || user === jidUsuario) continue; // nunca auto-demotearse ni al que ejecuta
            // Solo quita admin si efectivamente es admin
            const esAdmin = groupMetadata.participants.find(
              p => p.id === user && (p.admin === 'admin' || p.admin === 'superadmin')
            );
            if (!esAdmin) {
              await sock.sendMessage(jidChat, { text: `@${user.split('@')[0]} no es admin.`, mentions: [user] });
              continue;
            }
            await sock.sendMessage(jidChat, { text: `Quitando admin a: @${user.split('@')[0]}`, mentions: [user] });
            try {
              await sock.groupParticipantsUpdate(jidChat, [user], 'demote');
            } catch (e) {
              await sock.sendMessage(jidChat, { text: `No pude quitar admin a @${user.split('@')[0]}` });
            }
          }
          return;
        }
      }
      // ========== FIN BLOQUE QUITAR ADMIN ==========

      // ========== BLOQUE DAR ADMIN ==========
      if (
        isGroup &&
        esComandoDarAdmin(texto) &&
        comandoEsParaBot({ texto, mentionedJids, botJid, botNumero })
      ) {
        let jidsAPromover = [];
        const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        if (Array.isArray(mentionedJids)) {
          jidsAPromover = mentionedJids.filter(jid => jid !== botId && jid !== jidUsuario);
        }
        const jidsDeTexto = obtenerJidsComando(texto).filter(jid => jid !== botId && jid !== jidUsuario);
        jidsAPromover = [...new Set([...jidsAPromover, ...jidsDeTexto])];

        let contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.contextInfo;
        if (
          jidsAPromover.length === 0 &&
          contextInfo &&
          contextInfo.participant &&
          contextInfo.participant !== botId &&
          contextInfo.participant !== jidUsuario
        ) {
          jidsAPromover.push(contextInfo.participant);
        }

        // Filtro extra para máxima seguridad de no autopromover ni promover al que ejecuta
        jidsAPromover = jidsAPromover.filter(j => j !== botId && j !== jidUsuario);

        if (jidsAPromover.length > 0) {
          const groupMetadata = await sock.groupMetadata(jidChat);
          const botIsAdmin = groupMetadata.participants.find(
            p => p.id === botId && (p.admin === 'admin' || p.admin === 'superadmin')
          );
          if (!botIsAdmin) {
            await sock.sendMessage(jidChat, { text: "No soy admin, no puedo dar admin." });
            return;
          }
          for (const user of jidsAPromover) {
            if (user === botId || user === jidUsuario) continue; // nunca autopromoverse ni al que ejecuta
            // Solo da admin si NO es admin aún
            const esAdmin = groupMetadata.participants.find(
              p => p.id === user && (p.admin === 'admin' || p.admin === 'superadmin')
            );
            if (esAdmin) {
              await sock.sendMessage(jidChat, { text: `@${user.split('@')[0]} ya es admin.`, mentions: [user] });
              continue;
            }
            await sock.sendMessage(jidChat, { text: `Dando admin a: @${user.split('@')[0]}`, mentions: [user] });
            try {
              await sock.groupParticipantsUpdate(jidChat, [user], 'promote');
            } catch (e) {
              await sock.sendMessage(jidChat, { text: `No pude dar admin a @${user.split('@')[0]}` });
            }
          }
          return;
        }
      }
      // ========== FIN BLOQUE DAR ADMIN ==========

      // Procesamiento de imagen: OCR
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
          await sock.sendMessage(msg.key.remoteJid, {
            text: '⚠️ Ocurrió un error al procesar la imagen.',
          }, { quoted: msg });
        }
        return;
      }

      function mensajeLlamaAlBot({ texto, isGroup, botJid, mentionedJids, botNumero }) {
        if (isGroup) {
          if (
            Array.isArray(mentionedJids) &&
            mentionedJids.some(jid =>
              jid.split(/[:@]/)[0] === botJid.split(/[:@]/)[0]
            )
          ) {
            return true;
          }
          if (
            texto.toLowerCase().includes("lucky") ||
            texto.replace(/[\s\+\-\(\)]/g, '').includes(botNumero)
          ) {
            return true;
          }
          return false;
        } else {
          return true;
        }
      }

      if (!mensajeLlamaAlBot({ texto, isGroup, botJid, mentionedJids, botNumero })) return;

      if (
        /cómo te llamas|cual es tu nombre|quién sos|tu nombre/i.test(texto) &&
        !texto.toLowerCase().includes("me llamo")
      ) {
        const respuesta = 'Me llamo Lucky.';
        agregarAlHistorial(jidChat, jidUsuario, 'bot', respuesta);
        await sock.sendMessage(jidChat, { text: respuesta });
        return;
      }

      if (/quién.*(te creó|es tu creador)|creador/i.test(texto) && !memoria[jidChat].creador) {
        memoria[jidChat].creador = true;
        guardarMemoria();
        const respuesta = 'Fui creado por cvalencia, un genio con mucha onda.';
        agregarAlHistorial(jidChat, jidUsuario, 'bot', respuesta);
        await sock.sendMessage(jidChat, { text: respuesta });
        return;
      }

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
          await sock.sendMessage(jidChat, {
            text: '❌ No pude descargar el video/audio. Verificá el enlace.',
          });
        }
        return;
      }

      agregarAlHistorial(jidChat, jidUsuario, 'user', texto);
      const prompt = generarPrompt(usuarioData.historial, texto);
      const respuesta = await responderConCohere(prompt);
      agregarAlHistorial(jidChat, jidUsuario, 'bot', respuesta);
      await sock.sendMessage(jidChat, { text: respuesta });

    } catch (err) {
      await sock.sendMessage(msg.key.remoteJid, {
        text: '⚠️ Hubo un error procesando tu mensaje. ¿Querés intentar de nuevo?',
      });
    }
  });

  process.on('uncaughtException', (err) => {
    console.error('❌ Error no capturado:', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Rechazo no manejado en una promesa:', reason);
  });
};
