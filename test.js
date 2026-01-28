'use strict';

const rochdi = require('rochdi');
const Connection = require('./lib/connection');
const tls = require('node:tls');

const { Logger, Http2Client } = rochdi;

const logger = new Logger({ prefix: 'test' });
const http2_client = new Http2Client({ logger });

const o = {};
const channel_name_id = process.argv[2];

function init(channel_name_id) {
    const url = 'https://kick.com/'+channel_name_id;
    const headers = {
      'Host': 'kick.com',
      // 'Upgrade-Insecure-Requests': '1',
      'User-Agent': 'mozilla',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'en-US,en;q=0.9',
      'Priority': 'u=0, i'
    };
    
    return http2_client.get(url, { headers }).then(res => {
      const { status_code, data } = res;
      if (200 !== status_code) {
        logger.warn('init: request error, http(%d), retrying...', status_code);
        return new Promise(resolve => setTimeout(() => resolve(init.call(this, channel_name_id)), 2e3));
      }
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
      return this;
    });
}

function currentViewers(stream_id) {
  const url = 'https://kick.com/current-viewers?ids[]='+stream_id;
  const headers = {
    'Host': 'kick.com',
    'Cookie': '',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua-Full-Version-List': '"Chromium";v="140.0.7339.185", "Not=A?Brand";v="24.0.0.0", "Google Chrome";v="140.0.7339.185"',
    'Sec-Ch-Ua-Platform': 'Linux',
    'Sec-Ch-Ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    'Sec-Ch-Ua-Bitness': '"64"',
    'Sec-Ch-Ua-Model': '""',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Arch': '"x86"',
    'Sec-Ch-Ua-Full-Version': '"140.0.7339.185"',
    'Accept': 'application/json',
    'User-Agent': '',
    'Sec-Ch-Ua-Platform-Version': '"6.14.0"',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9,fr-FR;q=0.8,fr;q=0.7',
    'If-Modified-Since': 'Tue, 14 Oct 2025 16:18:45 GMT',
    'Priority': 'u=1, i'    
  };
  return http2_client.get(url, { headers, cipher }).then(res => {
    const { status_code, data } = res;
    const resHeaders = res.headers;

    const b = {};

    for (const k of ['last-modified', 'cf-cache-status']) {
      b[k] = resHeaders[k];
    }

    log(randomString(8), b, data);

    setTimeout(currentViewers.bind(void 0, stream_id), 512);
  });
}

init.call(o, channel_name_id).then(result => {
  exit(result);
});