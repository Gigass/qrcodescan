const fs = require('fs')

function readIfExists(filePath) {
  if (!filePath) return undefined
  try {
    return fs.readFileSync(filePath)
  } catch (e) {
    return undefined
  }
}

const sslKey = readIfExists(process.env.SSL_KEY_FILE)
const sslCert = readIfExists(process.env.SSL_CRT_FILE)

module.exports = {
  devServer: {
    host: '0.0.0.0',
    port: 5173,
    https: sslKey && sslCert ? { key: sslKey, cert: sslCert } : true,
  },
}
