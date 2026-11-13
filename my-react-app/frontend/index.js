// index.js – บรรทัดบนสุด ก่อนอะไรทั้งหมด
// ใช้ require() แทน import เพื่อบังคับให้ polyfill นี้รันก่อน
// เพราะ import จะถูก hoist ขึ้นไปรันก่อนเสมอ ทำให้ react-native
// core ไปเรียกใช้ DOMException ก่อนที่ polyfill จะทันตั้งค่า
if (typeof global.DOMException === 'undefined') {
  global.DOMException = class DOMException extends Error {
    constructor(message, name = 'Error') {
      super(message);
      this.name = name;
    }
  };
}

const { registerRootComponent } = require('expo');
const App = require('./App').default;

// registerRootComponent(App) เทียบเท่ากับการเรียก AppRegistry.registerComponent('main', () => App)
// และตั้งค่าให้ทั้ง Expo Go และ native build โหลด root component ถูกต้อง
registerRootComponent(App);