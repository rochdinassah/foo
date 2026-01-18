// author: rochdi nassah

'use strict';

require('rochdi');

const WebSocket = require('ws');

const ws_base_url = 'https://websockets.kick.com/viewer/v1/connect?token=';
const headers = {
  'Host': 'websockets.kick.com',
  'Connection': 'Upgrade',
  'Pragma': 'no-cache',
  'Cache-Control': 'no-cache',
  'User-Agent': 'mozilla',
  'Upgrade': 'websocket',
  'Origin': 'https://kick.com',
  'Sec-Websocket-Version': '13',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9,fr-FR;q=0.8,fr;q=0.7',
  'Cookie': '',
  'Sec-Websocket-Key': ''
};

var counter = 0;

class Connection extends WebSocket {
  constructor(opts = {}) {
    const { token, cookie, channel_id } = opts;

    headers['Cookie'] = cookie;
    super(ws_base_url+token, { headers });

    this.id = counter++;
    this.channel_id = channel_id;

    this.on('error', this.onError);
    // this.on('close', this.onClose);
    // this.on('open', this.onOpen);
    // this.on('message', this.onMessage);
  }

  onError(err) {
    if (/403/.test(err.message))
      log(403);
    log('connection error', err.code);
  }

  onClose(code, buff) {}

  onOpen() {}

  onMessage(msg) {}

  write(payload, callback) {
    return this.send(JSON.stringify(payload), callback);
  }
}

Connection.prototype.triggerChannelPoints = function (livestream_id) {
  const { channel_id } = this;
  this.write({ type: 'user_event', data: { message: { name: 'tracking.user.watch.livestream', channel_id, livestream_id }}});
};

Connection.prototype.handshake = function () {
  this.connected = true;
  this.write({ type: 'channel_handshake', data: { message: { channelId: this.channel_id }}});
};

Connection.prototype.disconnect = function () {
  this.connected = false;
  this.write({ type: 'channel_disconnect', data: { message: { channelId: this.channel_id }}});
};

Connection.prototype.ping = function () {
  this.write({ type: 'ping' });
};

module.exports = Connection;