if (typeof global.DOMException === 'undefined') {
  function DOMException(message, name) {
    var error = new Error(message);
    error.name = name || 'Error';
    // ให้ instanceof Error ยังทำงานถูกต้อง โดยไม่ผ่าน Babel native-super helper
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(error, DOMException.prototype);
    }
    return error;
  }
  DOMException.prototype = Object.create(Error.prototype);
  DOMException.prototype.constructor = DOMException;

  global.DOMException = DOMException;
}