// author: rochdi nassah

'use strict';

const rochdi = require('rochdi');
const helpers = require('./lib/helpers');
const Connection = require('./lib/connection');
const settings = require('./settings');

const { Http2Client, Logger } = rochdi;

const { get_request_id, generate_cfuvid } = helpers;

const fn = new Intl.NumberFormat().format;

const url = 'https://websockets.kick.com/viewer/v1/token';
const headers = {
  Host: 'websockets.kick.com',
  Cookie: '',
  'Cache-Control': 'max-age=0',
  'X-Request-Id': '',
  'Sec-Ch-Ua-Platform': '"Linux"',
  'Sec-Ch-Ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
  'Sec-Ch-Ua-Mobile': '?0',
  'User-Agent': 'mozilla',
  Accept: 'application/json',
  'X-Client-Token': 'e1393935a959b4020a4491574f6490129f678acdaa92760471263db43487f823',
  Origin: 'https://kick.com',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Referer: 'https://kick.com/',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9,fr-FR;q=0.8,fr;q=0.7',
  Priority: 'u=1, i'
};

// class Client extends rochdi.Client {
class Client extends require('node:events') {
  constructor(address) {
    super(address);

    this.logger = new Logger({ prefix: 'app-client' });

    this.http2_client = new Http2Client({ logger: this.logger });

    this.ok_count = 0;
    this.err_count = 0;

    this.pool = new Map();
    this.drop_count = 0;
    this.handshake_size = 1/0;
    this.servers_size = 1;

    this.on('Open', this.onConnectionOpen);
    this.on('SettingMessage', this.onSettingMessage);
    this.on('PingMessage', this.onPingMessage);

    this.channel_id = '15108912';
    this.pool_limit = 8e3;
    this.createTokens(50);
    this.loop_interval_id = setInterval(this.createTokens.bind(this), 23e3, 50);

    setInterval(this.handshake.bind(this), 15e3);
    setInterval(this.ping.bind(this), 3e4);
  }
  
  onConnectionOpen() {
    this.sendMessage('StatMessage', { stat: this.stat });
  }

  onSettingMessage(data) {
    const { logger, pool } = this;
    const { channel_id, pool_limit, handshake_size } = data;

    if (void 0 !== channel_id && this.channel_id !== (this.channel_id = channel_id))
      pool.forEach(connection => {
        connection.disconnect();
        connection.channel_id = channel_id;
        connection.handshake();
      });

    if (this.handshake_size !== handshake_size && -1 !== handshake_size)
      this.resizeHandshakeSize(handshake_size);

    if (this.pool_limit !== (this.pool_limit = pool_limit)) {
      clearInterval(this.loop_interval_id);
      this.createTokens(50);
      this.loop_interval_id = setInterval(this.createTokens.bind(this), 23e3, 50);
    }

    logger.verbose('setting ok | channel_id: %s, pool_limit: %d, handshake_size: %d', channel_id, pool_limit, handshake_size);
  }
  
  createToken() {
    headers['Cookie'] = format('_cfuvid=%s', generate_cfuvid());
    headers['X-Request-Id'] = get_request_id();
    
    return this.http2_client.get(url, { headers, cipher: 'AES128-GCM-SHA256' }).then(res => {
      const { status_code, data } = res;
      
      if (200 !== status_code)
        return false;

      const { token } = data.data, cookies = [];

      for (const cookie of res.headers['set-cookie'])
        cookies.push(/([a-zA-Z0-9._-]+\=[a-zA-Z0-9._-]+)\;/.exec(cookie)[1]);

      return { token, cookie: cookies.join('; ') };
    });
  }

  createTokens(size = 10) {
    const { pool_limit, pool, channel_id, logger } = this;

    if (pool_limit <= pool.size)
        return;

    for (var i = 0, p = []; size > i; ++i)
      p.push(this.createToken());
    Promise.all(p).then(results => {
      results.forEach(result => {
        if (!result)
          return this.err_count++;

        this.ok_count++;

        const { token, cookie } = result;
        const connection = new Connection({ token, cookie, channel_id });
        connection.on('close', (code, buff) => {
          this.drop_count++;
          pool.delete(connection.id);
          this.getNonConnectedConnections()[0]?.handshake();
          logger.warn('connection close | code: %d, buff: %s', code, String(buff));
        });
        connection.on('open', pool.set.bind(pool, connection.id, connection));
      });
      logger.verbose('pool(%d) | ok: %d, err: %d', pool.size, this.ok_count, this.err_count);
    });
  }

  resizeHandshakeSize(new_size) {
    const { logger } = this;

    let is_up = new_size > this.handshake_size;
    const diff = Math.abs(new_size-this.handshake_size);
    const connections = is_up ? this.getNonConnectedConnections() : this.getConnectedConnections();
    connections.slice(0, diff).forEach(connection => is_up ? connection.handshake() : connection.disconnect());

    logger.verbose('handshake_size change from "%s" to "%s"', fn(this.handshake_size), fn(this.handshake_size = new_size));
  }
  
  getConnectedConnections() {
    return Array.from(this.pool.values()).filter(c => c.connected);
  }

  getNonConnectedConnections() {
    return Array.from(this.pool.values()).filter(c => !c.connected);
  }

  onPingMessage() {
    const { stat } = this;
    this.sendMessage('StatMessage', { stat });
  }

  get stat() {
    const { channel_id, handshake_size, pool, drop_count, ok_count, err_count } = this;
    return {
      channel_id,
      handshake_size,
      pool_size: pool.size,
      drop_count,
      ok_count,
      err_count
    };
  }

  handshake() {
    const { pool, handshake_size } = this;
    if (!handshake_size || !pool.size)
      return;
    Array.from(pool.values()).slice(0, handshake_size).forEach(connection => connection.handshake());
  }

  ping() {
    const { pool, stat } = this;
    pool.forEach(connection => connection.ping());
    // setTimeout(() => this.sendMessage('StatMessage', { stat }), 2e3);
  }
}

// const client = new Client(settings.server_url).run();
const client = new Client(settings.server_url);