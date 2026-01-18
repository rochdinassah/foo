// author: rochdi nassah

'use strict';

exports.get_request_id = function () {
  return '1759'+rand(111111111, 999999999)+'.'+randomString(6);
};

exports.generate_cfuvid = function () {
  return randomString(43, { extra: '_.' })+'-17589389'+rand(10000, 99999)+'-0.0.1.1-604800000';
};