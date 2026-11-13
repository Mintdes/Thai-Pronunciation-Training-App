const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// ชั่วคราว: ปิด custom polyfill เพื่อทดสอบ
 const defaultGetPolyfills = config.serializer.getPolyfills || (() => []);
 config.serializer.getPolyfills = (options) => [
   ...defaultGetPolyfills(options),
   path.resolve(__dirname, 'polyfills/dom-exception.js'),
 ];

module.exports = config;