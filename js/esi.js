import { APP_CONFIG } from './config.js';

const OAUTH_PREFIX = 'whpd:oauth:';
const ZKILL_SUBMISSION_INTERVAL_MS = 1000;
const UNCONFIGURED_CLIENT_IDS = new Set([
  '',
  '--LOCAL-CLIENT-ID--',
  '--PRODUCTION-CLIENT-ID--'
]);

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('EVE SSO returned an invalid access token.');
  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return JSON.parse(atob(padded));
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

export function extractZkillValue(payload) {
  const item = Array.isArray(payload) ? payload[0] : payload;
  const totalValue = Number(item?.zkb?.totalValue ?? item?.totalValue);
  return Number.isFinite(totalValue) && totalValue > 0 ? totalValue : null;
}

export function parseZkillKillmailId(value) {
  const input = String(value || '').trim();
  if (/^\d+$/.test(input)) {
    const id = Number(input);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  try {
    const url = new URL(input);
    if (!['zkillboard.com', 'www.zkillboard.com'].includes(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(/^\/(?:kill|api\/killID)\/(\d+)\/?$/i);
    const id = Number(match?.[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch (_) {
    return null;
  }
}

export function extractZkillKillmail(payload, expectedKillmailId = null) {
  const item = Array.isArray(payload) ? payload[0] : payload;
  const killmailId = Number(item?.killmail_id);
  if (!Number.isSafeInteger(killmailId) || killmailId <= 0) {
    throw new Error('zKillboard did not return a valid killmail.');
  }
  if (expectedKillmailId && killmailId !== Number(expectedKillmailId)) {
    throw new Error('zKillboard returned a different killmail than requested.');
  }
  if (!item?.victim || !Array.isArray(item?.attackers) || !item?.killmail_time || !item?.solar_system_id) {
    throw new Error('zKillboard returned an incomplete killmail.');
  }

  const { zkb = {}, ...detail } = item;
  const totalValue = Number(zkb.totalValue);
  return {
    id: killmailId,
    hash: typeof zkb.hash === 'string' ? zkb.hash : '',
    detail,
    totalValue: Number.isFinite(totalValue) && totalValue > 0 ? totalValue : null
  };
}

export function extractCharacterMatch(payload, requestedName) {
  const characters = Array.isArray(payload?.characters) ? payload.characters : [];
  const normalizedName = String(requestedName || '').trim().toLowerCase();
  const match = characters.find((character) => String(character?.name || '').trim().toLowerCase() === normalizedName);
  const id = Number(match?.id);
  if (!match || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`No EVE character named "${String(requestedName || '').trim()}" was found.`);
  }
  return { id, name: String(match.name).trim() };
}

export const MAX_MAIL_RECIPIENTS = 50;

function normalizedMailRecipientIds(recipientIds) {
  const requestedIds = Array.isArray(recipientIds) ? recipientIds : [recipientIds];
  const normalizedRecipientIds = [...new Set(requestedIds.map(Number))];
  if (!normalizedRecipientIds.length || normalizedRecipientIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('At least one valid EVE Mail recipient ID is required.');
  }
  return normalizedRecipientIds;
}

function normalizedMailingListId(mailingListId) {
  if (mailingListId === null || mailingListId === undefined || mailingListId === '') return null;
  const normalized = Number(mailingListId);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error('A valid EVE Mail mailing list ID is required.');
  }
  return normalized;
}

export function buildMailRecipients(recipientIds, mailingListId = null) {
  const normalizedRecipientIds = normalizedMailRecipientIds(recipientIds);
  const normalizedMailingList = normalizedMailingListId(mailingListId);

  const recipients = normalizedRecipientIds.map((recipientId) => ({
    recipient_id: recipientId,
    recipient_type: 'character'
  }));
  if (normalizedMailingList !== null) {
    recipients.push({ recipient_id: normalizedMailingList, recipient_type: 'mailing_list' });
  }
  if (recipients.length > MAX_MAIL_RECIPIENTS) {
    throw new Error(`EVE Mail supports at most ${MAX_MAIL_RECIPIENTS} recipients per message.`);
  }

  return recipients;
}

export function buildMailRecipientBatches(recipientIds, mailingListId = null) {
  const normalizedRecipientIds = normalizedMailRecipientIds(recipientIds);
  const normalizedMailingList = normalizedMailingListId(mailingListId);
  const batches = [];
  let offset = 0;

  if (normalizedMailingList !== null) {
    const firstBatchSize = MAX_MAIL_RECIPIENTS - 1;
    batches.push({
      recipientIds: normalizedRecipientIds.slice(0, firstBatchSize),
      mailingListId: normalizedMailingList
    });
    offset = firstBatchSize;
  }

  while (offset < normalizedRecipientIds.length) {
    batches.push({
      recipientIds: normalizedRecipientIds.slice(offset, offset + MAX_MAIL_RECIPIENTS),
      mailingListId: null
    });
    offset += MAX_MAIL_RECIPIENTS;
  }

  return batches;
}

export class ESIError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = 'ESIError';
    this.status = status;
    this.payload = payload;
  }
}

export function isInvalidCharacterGrant(error) {
  const errorCode = String(error?.payload?.error || '').trim().toLowerCase();
  const message = String(error?.message || '').trim().toLowerCase();
  return errorCode === 'invalid_grant'
    || message.includes('invalid refresh token')
    || message.includes('character grant missing/expired')
    || message.includes('has no refresh token');
}

export class ESIClient {
  constructor(store) {
    this.store = store;
    this.zkillSubmissionQueue = Promise.resolve();
    this.lastZkillSubmissionAt = 0;
  }

  async queueZkillSubmission(submit, interval = ZKILL_SUBMISSION_INTERVAL_MS) {
    const queued = this.zkillSubmissionQueue.then(async () => {
      const wait = Math.max(0, this.lastZkillSubmissionAt + interval - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastZkillSubmissionAt = Date.now();
      return submit();
    });
    this.zkillSubmissionQueue = queued.catch(() => {});
    return queued;
  }

  get clientId() {
    if (window.location.hostname === 'localhost') return APP_CONFIG.localClientId;
    if (window.location.hostname === APP_CONFIG.productionHost) return APP_CONFIG.productionClientId;
    return APP_CONFIG.productionClientId || APP_CONFIG.localClientId;
  }

  isConfigured() {
    return !UNCONFIGURED_CLIENT_IDS.has(String(this.clientId || '').trim());
  }

  get callbackUrl() {
    if (window.location.hostname === 'localhost') return APP_CONFIG.localCallbackUrl;
    if (window.location.hostname === APP_CONFIG.productionHost) return APP_CONFIG.productionCallbackUrl;
    return `${window.location.origin}/callback`;
  }

  async beginAuthorization() {
    if (!this.isConfigured()) throw new Error('EVE SSO is not configured for this deployment.');

    const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
    const verifier = base64Url(verifierBytes);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = base64Url(new Uint8Array(digest));
    const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));

    sessionStorage.setItem(`${OAUTH_PREFIX}verifier`, verifier);
    sessionStorage.setItem(`${OAUTH_PREFIX}state`, state);

    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: this.callbackUrl,
      client_id: this.clientId,
      scope: APP_CONFIG.scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state
    });

    window.location.assign(`${APP_CONFIG.ssoAuthorizeUrl}?${params}`);
  }

  async handleAuthorizationCallback(search = window.location.search) {
    const params = new URLSearchParams(search);
    const expectedState = sessionStorage.getItem(`${OAUTH_PREFIX}state`);
    const verifier = sessionStorage.getItem(`${OAUTH_PREFIX}verifier`);
    const error = params.get('error');

    if (error) throw new Error(params.get('error_description') || `EVE SSO declined authorization: ${error}`);
    if (!expectedState || params.get('state') !== expectedState) throw new Error('EVE SSO state validation failed. Start the login again.');
    if (!verifier || !params.get('code')) throw new Error('The EVE SSO callback is missing its authorization code.');

    const token = await this.requestToken({
      grant_type: 'authorization_code',
      code: params.get('code'),
      client_id: this.clientId,
      code_verifier: verifier
    });

    const claims = decodeJwtPayload(token.access_token);
    const subject = String(claims.sub || '');
    const characterId = Number(subject.replace('CHARACTER:EVE:', ''));
    if (!Number.isSafeInteger(characterId) || characterId <= 0) throw new Error('The EVE access token did not identify a character.');

    const character = {
      id: characterId,
      name: claims.name || `Character ${characterId}`,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (Number(token.expires_in || 1200) - 30) * 1000,
      scopes: String(claims.scp || APP_CONFIG.scopes.join(' ')).split(/\s+/).filter(Boolean),
      addedAt: Date.now()
    };

    await this.store.put('characters', character);
    sessionStorage.removeItem(`${OAUTH_PREFIX}state`);
    sessionStorage.removeItem(`${OAUTH_PREFIX}verifier`);
    return character;
  }

  async requestToken(fields) {
    const response = await fetch(APP_CONFIG.ssoTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields)
    });
    const payload = await parseResponse(response);
    if (!response.ok || !payload?.access_token) {
      throw new ESIError(payload?.error_description || payload?.error || 'EVE SSO token request failed.', response.status, payload);
    }
    return payload;
  }

  async accessToken(characterId, forceRefresh = false) {
    const character = await this.store.get('characters', Number(characterId));
    if (!character) throw new Error('That sending character is no longer logged in.');
    if (!forceRefresh && character.accessToken && character.expiresAt > Date.now()) return character.accessToken;
    if (!character.refreshToken) throw new Error(`${character.name} has no refresh token. Add the character again.`);

    const token = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: character.refreshToken,
      client_id: this.clientId
    });

    const updated = {
      ...character,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || character.refreshToken,
      expiresAt: Date.now() + (Number(token.expires_in || 1200) - 30) * 1000
    };
    await this.store.put('characters', updated);
    return updated.accessToken;
  }

  async request(path, options = {}) {
    const method = options.method || 'GET';
    const headers = {
      Accept: 'application/json',
      'X-Compatibility-Date': APP_CONFIG.compatibilityDate,
      'X-User-Agent': APP_CONFIG.userAgent,
      ...(options.headers || {})
    };

    if (options.characterId) {
      headers.Authorization = `Bearer ${await this.accessToken(options.characterId, options.forceRefresh)}`;
    }

    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const url = path.startsWith('http') ? path : `${APP_CONFIG.esiBaseUrl}${path}`;
    const response = await fetch(url, { method, headers, body });

    if (response.status === 401 && options.characterId && !options.forceRefresh) {
      return this.request(path, { ...options, forceRefresh: true });
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') || 0);
      throw new ESIError(`ESI rate limit reached. Try again in ${retryAfter || 'a few'} seconds.`, 429);
    }

    const payload = await parseResponse(response);
    if (!response.ok) {
      const message = payload?.error || payload?.message || `ESI request failed with status ${response.status}.`;
      throw new ESIError(message, response.status, payload);
    }

    return { data: payload, headers: response.headers, status: response.status };
  }

  async recentKillmails(characterId, page = 1) {
    return this.request(`/characters/${characterId}/killmails/recent?page=${page}`, { characterId });
  }

  async killmail(killmailId, hash) {
    const encodedHash = encodeURIComponent(hash);
    const response = await this.request(`/killmails/${killmailId}/${encodedHash}`);
    return response.data;
  }

  async resolveNames(ids) {
    const normalized = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
    const resolved = new Map();
    const missing = [];

    for (const id of normalized) {
      const cached = await this.store.get('names', id);
      if (cached) resolved.set(id, cached.name);
      else missing.push(id);
    }

    for (let index = 0; index < missing.length; index += 1000) {
      const chunk = missing.slice(index, index + 1000);
      if (!chunk.length) continue;
      try {
        const response = await this.request('/universe/names', { method: 'POST', body: chunk });
        const records = (response.data || []).map((item) => ({
          id: Number(item.id),
          name: item.name,
          category: item.category,
          cachedAt: Date.now()
        }));
        await this.store.putMany('names', records);
        records.forEach((record) => resolved.set(record.id, record.name));
      } catch (error) {
        console.warn('Unable to resolve one or more ESI names.', error);
      }
    }

    normalized.forEach((id) => {
      if (!resolved.has(id)) resolved.set(id, `ID ${id}`);
    });
    return resolved;
  }

  async characterByName(name) {
    const requestedName = String(name || '').trim();
    if (!requestedName) throw new Error('Enter an EVE character name.');

    const lookup = await this.request('/universe/ids', { method: 'POST', body: [requestedName] });
    const character = extractCharacterMatch(lookup.data, requestedName);
    const profile = (await this.request(`/characters/${character.id}`)).data || {};
    const names = await this.resolveNames([profile.corporation_id, profile.alliance_id]);

    return {
      id: character.id,
      name: profile.name || character.name,
      corporationName: names.get(Number(profile.corporation_id)) || '',
      allianceName: names.get(Number(profile.alliance_id)) || ''
    };
  }

  async zkillValue(killmailId, killmailHash = '', {
    retryDelay = 3000,
    submissionInterval = ZKILL_SUBMISSION_INTERVAL_MS
  } = {}) {
    const normalizedId = Number(killmailId);
    if (!Number.isSafeInteger(normalizedId) || normalizedId <= 0) {
      throw new Error('A valid killmail ID is required for zKillboard appraisal.');
    }

    const normalizedHash = String(killmailHash || '').trim();
    if (!/^[a-f0-9]{40}$/i.test(normalizedHash)) {
      throw new Error('The killmail has no valid hash to submit to zKillboard.');
    }

    const fetchValue = async () => {
      const response = await fetch(`https://zkillboard.com/api/killID/${normalizedId}/`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`zKillboard value lookup returned ${response.status}.`);
      return extractZkillValue(await response.json());
    };

    try {
      const response = await this.queueZkillSubmission(
        () => fetch(`https://zkillboard.com/api/killmail/add/${normalizedId}/${encodeURIComponent(normalizedHash)}/`, {
          method: 'POST',
          headers: { Accept: 'application/json' }
        }),
        submissionInterval
      );
      // zKillboard documents 408 as accepted but still processing.
      if (!response.ok && response.status !== 408) {
        throw new Error(`zKillboard killmail submission returned ${response.status}.`);
      }
    } catch (error) {
      throw new Error(`Unable to submit killmail to zKillboard: ${error.message}`);
    }

    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      try {
        const totalValue = await fetchValue();
        if (totalValue) return totalValue;
        lastError = new Error('zKillboard did not return a total value for this killmail.');
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`zKillboard appraisal remained unavailable after 5 retries: ${lastError.message}`);
  }

  async zkillKillmail(killmailId) {
    const normalizedId = Number(killmailId);
    if (!Number.isSafeInteger(normalizedId) || normalizedId <= 0) {
      throw new Error('A valid killmail ID is required for zKillboard import.');
    }

    const response = await fetch(`https://zkillboard.com/api/killID/${normalizedId}/`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`zKillboard import returned ${response.status}.`);
    return extractZkillKillmail(await response.json(), normalizedId);
  }

  async sendCitation(senderId, recipientIds, subject, body, { mailingListId = null } = {}) {
    const response = await this.request(`/characters/${senderId}/mail`, {
      method: 'POST',
      characterId: senderId,
      body: {
        approved_cost: 10001,
        recipients: buildMailRecipients(recipientIds, mailingListId),
        subject,
        body
      }
    });
    return response.data;
  }

  async sendCitationCopies(senderId, recipientIds, subject, body, { mailingListId = null } = {}) {
    const batches = buildMailRecipientBatches(recipientIds, mailingListId);
    const mailIds = [];
    for (const batch of batches) {
      try {
        mailIds.push(await this.sendCitation(senderId, batch.recipientIds, subject, body, {
          mailingListId: batch.mailingListId
        }));
      } catch (error) {
        if (mailIds.length) {
          throw new Error(`${mailIds.length} of ${batches.length} EVE Mail batches were sent before delivery failed: ${error.message}`);
        }
        throw error;
      }
    }
    return mailIds;
  }
}
