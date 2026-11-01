const { execFileSync } = require('node:child_process')
const path = require('node:path')

// electron-builder skips signing when mac.identity is null. Apple Silicon still
// needs a valid ad-hoc signature for the app bundle, so apply one before the
// DMG/ZIP are created.
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  // A real Developer ID build is signed later by electron-builder. This hook
  // only supplies the ad-hoc signature needed by local/unsigned builds.
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    return
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
