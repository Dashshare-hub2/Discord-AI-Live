const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  EndBehaviorType, 
  StreamType,
  getVoiceConnection
} = require('@discordjs/voice');
const WebSocket = require('ws');
const prism = require('prism-media');
const http = require('http');
const { Readable } = require('stream');
require('dotenv').config();

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 Bot Gemini Live đang chạy!');
});

server.listen(PORT, () => {
  console.log(`🌐 Server web đang chạy tại port: ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Mời bot vào phòng thoại để nói chuyện với Gemini'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Rời khỏi phòng thoại'),
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`✅ BOT ĐÃ ONLINE: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('🔄 Đang đăng ký Slash Commands...');
    
    const guilds = await client.guilds.fetch();
    for (const [guildId] of guilds) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { body: commands }
      );
    }
    console.log('🎉 Đăng ký Slash Commands thành công! Hãy gõ /join trong Discord.');
  } catch (error) {
    console.error('❌ Lỗi đăng ký Slash Command:', error);
  }
});

client.on('guildCreate', async (guild) => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guild.id),
      { body: commands }
    );
  } catch (err) {
    console.error(`Không thể nạp lệnh cho server ${guild.name}:`, err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, guild } = interaction;

  if (commandName === 'join') {
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ Bạn phải vào một Kênh Thoại (Voice Channel) trước!', ephemeral: true });
    }

    await interaction.deferReply();

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    const geminiWs = new WebSocket(geminiWsUrl);

    geminiWs.on('open', () => {
      console.log('🌐 Đã kết nối với Gemini Live API WebSocket');
      geminiWs.send(JSON.stringify({
        setup: {
          model: 'models/gemini-2.0-flash-exp',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Puck' },
              },
            },
          },
        },
      }));
    });

    geminiWs.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        const base64Audio = response?.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
          const audioBuffer = Buffer.from(base64Audio, 'base64');
          const audioStream = Readable.from(audioBuffer);
          const pcmResource = createAudioResource(audioStream, { inputType: StreamType.Raw });
          player.play(pcmResource);
        }
      } catch (err) {
        console.error('Lỗi Gemini Audio:', err);
      }
    });

    const receiver = connection.receiver;
    receiver.speaking.on('start', (userId) => {
      if (userId === client.user.id) return;

      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 300 },
      });

      const pcmDecoder = new prism.opus.Decoder({ rate: 16000, channels: 1, frameSize: 960 });
      const pcmStream = opusStream.pipe(pcmDecoder);

      pcmStream.on('data', (chunk) => {
        if (geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{ mimeType: 'audio/pcm', data: chunk.toString('base64') }],
            },
          }));
        }
      });
    });

    await interaction.editReply('🎙️ Bot đã tham gia! Hãy nói chuyện trực tiếp với Gemini.');
  }

  if (commandName === 'leave') {
    const connection = getVoiceConnection(guild.id);
    if (connection) {
      connection.destroy();
      await interaction.reply('👋 Đã rời kênh thoại.');
    } else {
      await interaction.reply({ content: 'Bot hiện không ở trong kênh thoại nào.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
