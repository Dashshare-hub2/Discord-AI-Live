const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  EndBehaviorType, 
  StreamType 
} = require('@discordjs/voice');
const WebSocket = require('ws');
const prism = require('prism-media');
const http = require('http');
const { Readable } = require('stream');
require('dotenv').config();

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 Discord Gemini Live Bot đang hoạt động ở port ' + PORT);
});

server.listen(PORT, () => {
  console.log(`🌐 Web server đang lắng nghe tại cổng: ${PORT}`);
});


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});
 
const commands = [
  new SlashCommandBuilder().setName('join').setDescription('Mời bot vào kênh thoại/cuộc gọi riêng'),
  new SlashCommandBuilder().setName('leave').setDescription('Rời khỏi kênh thoại'),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`🤖 Bot đã sẵn sàng: ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Đã đăng ký Slash Commands.');
  } catch (error) {
    console.error('Xảy ra lỗi đăng ký lệnh:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, guild } = interaction;

  if (commandName === 'join') {
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ Bạn phải ở trong một Kênh thoại trước!', ephemeral: true });
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
      
  
      const setupConfig = {
        setup: {
          model: 'models/gemini-2.0-flash-exp',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Puck', // Các giọng khả dụng: Puck, Charon, Kore, Fenrir, Aoede
                },
              },
            },
          },
        },
      };
      geminiWs.send(JSON.stringify(setupConfig));
    });

    geminiWs.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        
        const base64Audio = response?.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
          const audioBuffer = Buffer.from(base64Audio, 'base64');
          
          const audioStream = Readable.from(audioBuffer);
          const pcmResource = createAudioResource(audioStream, {
            inputType: StreamType.Raw,
          });

          player.play(pcmResource);
        }
      } catch (err) {
        console.error('Lỗi xử lý phản hồi từ Gemini:', err);
      }
    });


    const receiver = connection.receiver;
    receiver.speaking.on('start', (userId) => {
      if (userId === client.user.id) return; 

      console.log(`🎤 Đang nhận âm thanh từ User ID: ${userId}`);

      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 300 },
      });


      const pcmDecoder = new prism.opus.Decoder({ rate: 16000, channels: 1, frameSize: 960 });
      const pcmStream = opusStream.pipe(pcmDecoder);

      pcmStream.on('data', (chunk) => {
        if (geminiWs.readyState === WebSocket.OPEN) {
          const audioPayload = {
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: 'audio/pcm',
                  data: chunk.toString('base64'),
                },
              ],
            },
          };
          geminiWs.send(JSON.stringify(audioPayload));
        }
      });
    });

    await interaction.editReply('🎙️ Đã tham gia cuộc gọi! Bạn có thể bắt đầu nói chuyện với Gemini.');
  }

  if (commandName === 'leave') {
    const { getVoiceConnection } = require('@discordjs/voice');
    const connection = getVoiceConnection(guild.id);
    
    if (connection) {
      connection.destroy();
      await interaction.reply('👋 Đã rời cuộc gọi.');
    } else {
      await interaction.reply({ content: 'Bot không nằm trong kênh thoại nào.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
