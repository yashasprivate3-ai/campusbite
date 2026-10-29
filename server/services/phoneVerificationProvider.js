import { createMetaWhatsAppProvider } from './metaWhatsappProvider.js'
import { createMsg91AccessTokenVerifier } from './msg91AccessToken.js'

function createDevelopmentProvider(config) {
  if (config.isProduction) {
    throw new Error('The development OTP provider cannot run in production.')
  }

  return Object.freeze({
    name: 'development',
    async deliver({ code }) {
      if (code !== config.developmentCode) {
        throw new Error('Development OTP delivery received an invalid code.')
      }

      // Development delivery is intentionally silent. The private code is read
      // from the ignored local environment and is never logged or returned.
    },
  })
}

export function createPhoneVerificationProvider(config, isProduction) {
  const providerConfig = { ...config, isProduction }

  if (config.provider === 'development') {
    return createDevelopmentProvider(providerConfig)
  }

  if (config.provider === 'meta-whatsapp') {
    return createMetaWhatsAppProvider(providerConfig.metaWhatsApp)
  }

  if (config.provider === 'msg91') {
    return Object.freeze({
      name: 'msg91',
      verifyAccessToken: createMsg91AccessTokenVerifier(config.msg91),
    })
  }

  throw new Error('Unsupported phone verification provider.')
}
