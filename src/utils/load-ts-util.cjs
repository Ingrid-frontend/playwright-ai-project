'use strict';

const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

function loadTsUtil(filename) {
  return tsxRequire(path.join(__dirname, filename), __filename);
}

module.exports = { loadTsUtil };
