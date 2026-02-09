// author: rochdi nassah

'use strict';

const rochdi = require('rochdi');
const settings = require('./settings');

const { CommandManager, Http2Client, Discord, Logger } = rochdi;

const { port } = settings;

const fn = new Intl.NumberFormat().format;

class Server extends rochdi.Server {
  constructor(opts = {}) {
    super(opts);

    startTimer('boot');
    startTimer('uptime');

    this._channel_id = '15108912';
    this._stream_id = void 0;
    this._handshake_size = -1;
    this._pool_limit = settings.pool_limit ?? 8e3;

    this.viewer_count = -1;

    this.pool_size = 0;
    this.drop_count = 0;
    this.ok_count = 0;
    this.err_count = 0;

    const logger = this.logger = new Logger({ prefix: 'app-server' });

    this.http2_client = new Http2Client({ logger });
    this.command_manager = new CommandManager({ logger }).run();
    
    this.on('Attach', this.onAttach);
    this.on('Detach', this.onDetach);
    this.on('Error', this.onError);

    this.on('ViewerCountChange', this.onViewerCountChange);
    this.on('SettingChange', this.onSettingChange);
    this.on('StatMessage', this.onStatMessage);

    this.discord = new Discord(process.env.DISCORD_BOT_TOKEN, { logger: this.logger });

    this.discord.on('Ready', this.onDiscordReady.bind(this));
    this.discord.on('Resumed', this.onDiscordResumedMessage.bind(this));
  }

  run() {
    this.discord.connect();
    super.run();
  }

  onError(err) {
    exit('ERROR!!!!', err);
  }

  onDiscordReady() {
    const { discord } = this;

    const guild = discord.getGuild('console');

    if (!guild)
      exit('missing guild "console"');

    guild.getChannel('kick').on('Message', this.onDiscordMessage.bind(this));

    this.notify(format('server ready | took %s', endTimer('boot')));
    this.emit('Ready');
  }

  onDiscordResumedMessage() {
    this.notify('discord session resumed');
  }

  notify(content, embeds = []) {
    const { discord, logger } = this;

    if (!discord.ready)
      return;

    return discord.guild_manager.getGuild('console').getChannel('kick').sendMessage(content, { embeds }).then(() => {
      logger.verbose('notification ok');
    });
  }

  onDiscordMessage(msg) {
    const { command_manager, discord } = this;
    const { author, content, channel_id, guild_id } = msg;

    if (discord.user.id === author.id)
      return;

    const match = /([a-z0-9_-]+)\s?([a-z0-9_-]+)?\s?([a-z0-9_-]+)?/i.exec(content);

    if (match) {
      const cmd = match[1].toLowerCase();
      const args = match.slice(2);
      if (command_manager.eventNames().includes(cmd))
        discord.api_manager.post('/channels/'+channel_id+'/typing').then(() => command_manager.emit(cmd, ...args));
    }
  }

  async debug() {
    const { clients } = this;

    const promises = [], timeouts = [];

    clients.forEach(client => {
      promises.push(new Promise(resolve => {
        timeouts.push(resolve);
        client.once('StatMessage', resolve);
        client.sendMessage('PingMessage', {});
      }));
    });

    const timeout_id = setTimeout(() => {
      timeouts.forEach(resolve => resolve());
      this.notify('global ping timeout triggered');
    }, 4e3);

    Promise.all(promises).then(async () => {
      clearTimeout(timeout_id);

      var t_pool_size = 0, t_drop_count = 0, t_ok_count = 0, t_err_count = 0;

      clients.forEach(client => {
        const { pool_size, drop_count, ok_count, err_count } = client.stat;
        t_pool_size += pool_size;
        t_drop_count += drop_count;
        t_ok_count += ok_count;
        t_err_count += err_count;
      });

      this.pool_size = t_pool_size;
      this.drop_count = t_drop_count;
      this.ok_count = t_ok_count;
      this.err_count = t_err_count;

      const { pool_size, drop_count, handshake_size, global_pool_limit, ok_count, err_count } = this;
      const { channel_name_id, channel_id, stream_id } = this;
      
      let viewer_count = -1;
      if (stream_id)
        viewer_count = await this.fetchViewerCount(false);

      const content = format(
        'target: %s\nchannel_id: %s\nstream_id: %s\n\nviewers: %s\npool: (%s/%s)\nhandshake_size: %s\n\
servers: %s\ndrop_count: %s\nok_count: %s\nerr_count: %s\n\nuptime: %s',
        channel_name_id,
        channel_id,
        stream_id,
        fn(viewer_count),
        fn(pool_size),
        fn(global_pool_limit),
        fn(handshake_size),
        fn(clients.size),
        fn(drop_count),
        fn(ok_count),
        fn(err_count),
        getTimer('uptime')
      );

      this.notify(content);
    });
  }

  onAttach(client) {
    client.stat = {
      pool_size: 0,
      drop_count: 0,
      ok_count: 0,
      err_count: 0
    };
    this.notify(format('server attach | curr servers size: %d', this.clients.size));
    this.publishSetting();
  }

  onDetach(client) {
    this.notify(format('detach server(%d), curr servers size: %d', 1+client.id, this.clients.size));
    this.publishSetting();
  }

  publishSetting() {
    const { channel_id, pool_limit, handshake_size, clients } = this;
    const per_server_handshake_size = Math.ceil(handshake_size/clients.size);
    clients.forEach(client => {
      client.sendMessage('SettingMessage', {
        channel_id,
        pool_limit,
        handshake_size: per_server_handshake_size
      });
    });
  }

  init(channel_name_id) {
    const { logger, http2_client } = this;

    const url = 'https://kick.com/'+channel_name_id;
    const headers = {
      'Host': 'kick.com',
      'User-Agent': '',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      'Priority': 'u=0, i'
    };
    
    return http2_client.get(url, { headers, cipher: 'DHE-RSA-AES128-SHA' }).then(res => {
      const { status_code, data } = res;

      if (200 !== status_code)
        return logger.warn('init: request error, http(%d)', status_code), false;

      const channel_id_pattern = /channel_id\\":([0-9]+)/;
      const stream_id_pattern = /livestream\\"\:\{\\"id\\"\:([0-9]+)/;
      const viewer_count_pattern = /viewer_count\\":([0-9]+)/;
      const channel_id_match = channel_id_pattern.exec(data);
      const stream_id_match = stream_id_pattern.exec(data);
      const viewer_count_match = viewer_count_pattern.exec(data);
      
      if (!channel_id_match || !stream_id_match)
        return false;

      this.channel_name_id = channel_name_id;
      this._channel_id = channel_id_match[1];
      this._stream_id = stream_id_match[1];
      this.viewer_count = parseInt(viewer_count_match[1]);
      clearInterval(this.viewer_count_sync_interval_id);
      this.viewer_count_sync_interval_id = setInterval(this.fetchViewerCount.bind(this), 1e3);
      return this.emit('settingChange'), this.ready = true;
    });
  }

  fetchViewerCount(retry = true) {
    const url = 'https://kick.com/current-viewers?ids[]='+this.stream_id;
    return this.http2_client.get(url, { headers: { 'User-Agent': 'Mozilla' } }).then(res => {
      const { status_code, data } = res;
      try {
        const viewer_count = data[0].viewers;
        if (this.viewer_count !== viewer_count)
          this.emit('ViewerCountChange', viewer_count);
        return viewer_count;
      } catch {
        return !retry ? -1 : new Promise(resolve => setTimeout(() => resolve(this.fetchViewerCount()), rand(900, 1200)));
      }
    });
  }
  
  onViewerCountChange(new_count) {
    const { viewer_count, viewer_count_sync_interval_id, debugLoopIntervalId } = this;

    let is_up;
    if (viewer_count < new_count)
      is_up = true;

    const diff = Math.abs(viewer_count-new_count);

    clearInterval(viewer_count_sync_interval_id);
    if (!debugLoopIntervalId)
      this.debugLoopIntervalId = setInterval(this.fetchViewerCount.bind(this), 64e3);

    this.notify(format('**viewer count update: %s | %s%s**', fn(new_count), is_up ? '+' : '-', fn(diff)));
    this.viewer_count = new_count;
  }

  onSettingChange() {
    this.publishSetting();
    this.debug();
  }

  onStatMessage(client, data) {
    client.stat = data.stat;
    if (-1 === this.handshake_size && -1 < client.stat.handshake_size)
      this.handshake_size = this.clients.size*client.stat.handshake_size;
    if (void 0 === this.channel_id && void 0 !== client.stat.channel_id)
      this.channel_id = client.stat.channel_id;
  }

  get channel_id() {
    return this._channel_id;
  }

  set channel_id(id) {
    if (this._channel_id !== (this._channel_id = id))
      this.emit('SettingChange');
  }

  get stream_id() {
    return this._stream_id;
  }

  set stream_id(id) {
    if (this._stream_id !== (this._stream_id = id)) {
      clearInterval(this.viewer_count_sync_interval_id);
      this.viewer_count_sync_interval_id = setInterval(this.fetchViewerCount.bind(this), 1e3);
      this.emit('SettingChange');
    }
  }

  get global_pool_limit() {
    return this.clients.size*this.pool_limit;
  }
  
  get pool_limit() {
    return this._pool_limit;
  }

  set pool_limit(limit) {
    if (this._pool_limit !== (this._pool_limit = limit))
      this.emit('SettingChange');
  }

  set handshake_size(size) {
    if (this._handshake_size !== (this._handshake_size = size))
      this.emit('SettingChange');
  }

  get handshake_size() {
    return this._handshake_size;
  }
}

const server = new Server({ port });

server.run();

server.on('Ready', () => {
  const { command_manager, discord } = server;
  const { interaction_manager } = discord;

  // interaction start
  interaction_manager.on('Interaction::ping', interaction => {
    interaction_manager.respondInteraction({
      id: interaction.id,
      token: interaction.token,
      data: {
        content: 'pong (kick)'
      }
    });
  });
  command_manager.on('ping', server.debug.bind(server));
  // interaction end

  // command start
  command_manager.on('init', channel_name_id => {
    if (void 0 === channel_name_id)
      return server.notify('command error, usage: init <channel_name_id>', 'error');
    server.init(channel_name_id).then(ok => {
      if (!ok)
        return server.notify(format('init error for "%s"', channel_name_id), 'error');
      const { channel_id, stream_id, viewer_count } = server
      server.notify(
        format('init ok | name: %s, viewers: %s, channel_id: %d, stream_id: %d', channel_name_id, fn(viewer_count), channel_id, stream_id)
      );
    });
  });
  command_manager.on('resize', (type, size) => {
    if (!(size = parseInt(size)))
      return server.notify('command error, usage resize <type> <size>');
    switch (type) {
      case 'pool': server.pool_limit = size; break;
      case 'handshake': server.handshake_size = size; break;
      default: server.notify(format('command error, "%s" type is unknown', type));
    }
  });
  command_manager.on('stream_id', stream_id => {
    if (!stream_id)
      return server.notify(format('stream_id: %s', server.stream_id));
    server.stream_id = stream_id;
  });
  command_manager.on('channel_id', channel_id => {
    if (!channel_id)
      return server.notify(format('channel_id: %s', server.channel_id));
    server.channel_id = channel_id;
  });
  command_manager.on('viewers', () => {
    server.fetchViewerCount().then(count => server.notify(format('viewers: %s', fn(count))));
  });
  command_manager.on('restart', () => {
    server.notify('restarting...');
    setTimeout(() => process.exit(1), 1e3);
  });
  // command end
});