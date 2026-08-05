import { createMetaWhatsAppProvider } from './metaWhatsappProvider.js'

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

  return createMetaWhatsAppProvider(providerConfig.metaWhatsApp)
}
