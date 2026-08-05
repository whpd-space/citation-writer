export const APP_CONFIG = Object.freeze({
  appName: 'WHPD Citation Writer',
  version: '0.1.0',
  userAgent: 'WHPD-Citation-Writer/0.1.0 (+https://whpd.space)',
  compatibilityDate: '2026-08-04',
  esiBaseUrl: 'https://esi.evetech.net',
  ssoAuthorizeUrl: 'https://login.eveonline.com/v2/oauth/authorize/',
  ssoTokenUrl: 'https://login.eveonline.com/v2/oauth/token',
  // Public EVE SSO application IDs, selected automatically by hostname in
  // the same manner as PodMail and SkillQ. These are not secrets.
  localClientId: '82e9470fcfab49e0baf9df8e3ea0620f',
  productionClientId: '30cb230d2c4a4e248485d6687f804aec',
  localCallbackUrl: 'http://localhost:39614/callback',
  productionCallbackUrl: 'https://cw.whpd.space/callback',
  productionHost: 'cw.whpd.space',
  scopes: [
    'publicData',
    'esi-killmails.read_killmails.v1',
    'esi-mail.send_mail.v1'
  ]
});
