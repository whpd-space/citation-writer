import { WHPDStore } from './db.js';
import { ESIClient, parseZkillKillmailId } from './esi.js';
import {
  activityForOffenses,
  availableOffenses,
  buildCitation,
  chargesForOffenses,
  cleanCitationText,
  formatIsk,
  formatShipTypeCounts,
  makeCitationDraft,
  sortOffensesAlphabetically,
  validateCitation
} from './citation.js';
import { formatRelativeTime, formatUtcDateTime, isoUtcDateTime } from './time.js';
import { attackerRoleForFinalBlow, classifyKillmail, combineKillmailGroups, countDistinctAttackingPilots, groupKillmails, isPodKillmail, selectInvolvedOfficer } from './killmail-groups.js';

if (window.location.hostname === '127.0.0.1') {
  window.location.replace(`http://localhost:${window.location.port}${window.location.pathname}${window.location.search}${window.location.hash}`);
}

const store = new WHPDStore();
const esi = new ESIClient(store);

const DEFAULT_SETTINGS = Object.freeze({
  senderMode: 'final-blow',
  specifiedSenderId: '',
  mailingListId: 145225352,
  autoClearAfterSend: true,
  testMode: false,
  theme: 'dark',
  layoutWidth: 'contained',
  attackerRoles: {},
  customOffenses: [],
  pageCount: 2
});

const ZKILL_RETRY_COOLDOWN = 5 * 60 * 1000;

const state = {
  characters: [],
  killmails: [],
  history: [],
  settings: { ...DEFAULT_SETTINGS },
  currentView: 'dashboard',
  statusFilter: 'pending',
  search: '',
  selectedKillmailId: null,
  bundledIncidentIds: new Set(),
  draft: null,
  syncing: false,
  importingZkill: false,
  sending: false,
  sendingMode: null,
  zkbLoadingIds: new Set(),
  toastTimer: null,
  modalResolve: null
};

function h(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function characterPortrait(characterId, size = 64) {
  return `https://images.evetech.net/characters/${Number(characterId)}/portrait?size=${size}`;
}

function typeIcon(typeId, size = 64) {
  return `https://images.evetech.net/types/${Number(typeId)}/icon?size=${size}`;
}

function utcTimeElement(value) {
  const iso = isoUtcDateTime(value);
  if (!iso) return '<span>Unknown time</span>';
  return `<time datetime="${h(iso)}" title="${h(formatRelativeTime(value))}">${h(formatUtcDateTime(value))}</time>`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function settleAppModal(accepted) {
  const modal = document.getElementById('app-modal');
  const resolve = state.modalResolve;
  state.modalResolve = null;
  if (modal.open) modal.close();
  if (resolve) resolve(Boolean(accepted));
}

function openAppModal({ title, message, confirmLabel = 'OK', cancelLabel = '', tone = 'notice' }) {
  const modal = document.getElementById('app-modal');
  if (modal.open) settleAppModal(false);

  document.getElementById('app-modal-title').textContent = title;
  document.getElementById('app-modal-message').textContent = message;
  document.getElementById('app-modal-icon').textContent = cancelLabel ? '?' : '!';
  const cancel = document.getElementById('app-modal-cancel');
  const confirm = document.getElementById('app-modal-confirm');
  cancel.hidden = !cancelLabel;
  cancel.textContent = cancelLabel || 'Cancel';
  confirm.textContent = confirmLabel;
  confirm.className = `button ${tone === 'danger' ? 'button-danger' : 'button-primary'}`;
  modal.dataset.tone = tone;

  return new Promise((resolve) => {
    state.modalResolve = resolve;
    modal.showModal();
    confirm.focus();
  });
}

function showAlert(message, { title = 'Attention', confirmLabel = 'OK', tone = 'notice' } = {}) {
  return openAppModal({ title, message, confirmLabel, tone });
}

function requestApproval(message, { title = 'Confirm action', confirmLabel = 'Continue', tone = 'notice' } = {}) {
  return openAppModal({ title, message, confirmLabel, cancelLabel: 'Cancel', tone });
}

function setWorking(message = '') {
  const element = document.getElementById('network-status');
  element.textContent = message;
  element.classList.toggle('is-working', Boolean(message));
}

function getCharacter(characterId) {
  return state.characters.find((character) => Number(character.id) === Number(characterId)) || null;
}

function managedCharacterIds() {
  return new Set(state.characters.map((character) => Number(character.id)));
}

function applyKillmailClassification(killmail, managed = managedCharacterIds()) {
  const classification = classifyKillmail(
    killmail.detail?.victim?.character_id,
    killmail.detail?.attackers || [],
    managed,
    Boolean(killmail.manualImportedAt)
  );
  killmail.direction = classification.direction;
  killmail.actionable = classification.actionable;
  return killmail;
}

function selectedKillmail() {
  return state.killmails.find((killmail) => Number(killmail.id) === Number(state.selectedKillmailId)) || null;
}

function selectedKillmailGroup() {
  const groups = groupKillmails(state.killmails.filter((killmail) => killmail.status === state.statusFilter));
  const selected = groups.find((group) => group.records.some((killmail) => Number(killmail.id) === Number(state.selectedKillmailId))) || null;
  const bundled = groups.filter((group) => state.bundledIncidentIds.has(Number(group.id)));
  return bundled.length ? combineKillmailGroups(bundled, selected?.id) : selected;
}

function groupTotalValue(group) {
  if (!group?.records?.length) return null;
  const values = group.records.map((killmail) => Number(killmail.totalValue));
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return values.reduce((total, value) => total + value, 0);
}

function finalBlowAttacker(killmail) {
  return (killmail?.detail?.attackers || []).find((attacker) => attacker.final_blow) || null;
}

function rememberedAttackerType(killmail) {
  return attackerRoleForFinalBlow(killmail, state.settings.attackerRoles);
}

function setDraftAttackerType(draft, attackerType, group) {
  const groupedKillmail = citationKillmail(group);
  const normalizedType = ['officer', 'deputy', 'fleet', 'memefleet'].includes(attackerType)
    ? attackerType
    : 'officer';
  draft.attackerType = normalizedType;
  if (normalizedType === 'fleet' || normalizedType === 'memefleet') {
    const participantCount = countDistinctAttackingPilots(group.records);
    const fleetName = normalizedType === 'memefleet' ? 'Memefleet' : 'Fleet';
    draft.officerName = `${participantCount} ${fleetName} Participants`;
  } else {
    draft.officerName = groupedKillmail.enriched?.officerName
      || groupedKillmail.enriched?.finalBlowName
      || 'Unassigned WHPD officer';
  }
  return draft;
}

function createCitationDraft(group, sender) {
  const groupedKillmail = citationKillmail(group);
  groupedKillmail.attackerType = rememberedAttackerType(group.primary);
  groupedKillmail.customOffenses = state.settings.customOffenses;
  return makeCitationDraft(groupedKillmail, sender);
}

function formatNameList(values, fallback = '') {
  const unique = [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
  return unique.length
    ? new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(unique)
    : fallback;
}

function recipientsForGroup(group) {
  const recipients = new Map();
  for (const record of group?.records || []) {
    const id = Number(record.recipientId || record.detail?.victim?.character_id);
    if (!Number.isSafeInteger(id) || id <= 0 || recipients.has(id)) continue;
    recipients.set(id, {
      id,
      name: record.enriched?.victimName || `Character ${id}`,
      corporationName: record.enriched?.victimCorporationName || ''
    });
  }
  return [...recipients.values()];
}

function citationKillmail(group) {
  if (!group) return null;
  const primary = group.primary;
  const systemNames = [...new Set(group.records.map((killmail) => killmail.enriched?.systemName).filter(Boolean))];
  const recipients = recipientsForGroup(group);
  const officers = officersForGroup(group);
  return {
    ...primary,
    totalValue: groupTotalValue(group),
    enriched: {
      ...(primary.enriched || {}),
      victimName: formatNameList(recipients.map((recipient) => recipient.name), primary.enriched?.victimName),
      victimCorporationName: formatNameList(
        recipients.map((recipient) => recipient.corporationName),
        primary.enriched?.victimCorporationName
      ),
      victimAllianceName: formatNameList(
        group.records.map((killmail) => killmail.enriched?.victimAllianceName),
        primary.enriched?.victimAllianceName
      ),
      systemName: systemNames.length
        ? new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(systemNames)
        : primary.enriched?.systemName,
      officerName: formatNameList(officers.map((officer) => officer.name), primary.enriched?.officerName),
      officerShipName: formatNameList(officers.map((officer) => officer.shipName), primary.enriched?.officerShipName),
      victimShipName: formatShipTypeCounts(
        group.records.map((killmail) => killmail.enriched?.victimShipName || 'Unknown vessel')
      )
    },
    relatedKillmails: group.records.map((killmail) => ({
      id: killmail.id,
      hash: killmail.hash,
      pilotName: killmail.enriched?.victimName || `Character ${killmail.recipientId}`,
      shipName: killmail.enriched?.victimShipName || 'Unknown vessel',
      systemName: killmail.enriched?.systemName || 'Unknown system',
      isPod: isPodKillmail(killmail)
    }))
  };
}

function senderFor(killmail) {
  if (state.settings.senderMode === 'specified') {
    return getCharacter(state.settings.specifiedSenderId);
  }
  return getCharacter(killmail?.finalBlowCharacterId);
}

function officerFor(killmail) {
  if (!killmail) return null;
  const id = Number(killmail.officerCharacterId || killmail.finalBlowCharacterId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    name: killmail.enriched?.officerName
      || getCharacter(id)?.name
      || killmail.enriched?.finalBlowName
      || `Character ${id}`,
    shipName: killmail.enriched?.officerShipName
      || killmail.enriched?.finalBlowShipName
      || 'WHPD patrol vessel'
  };
}

function officersForGroup(group) {
  const officers = new Map();
  for (const record of group?.records || []) {
    const officer = officerFor(record);
    if (officer && !officers.has(officer.id)) officers.set(officer.id, officer);
  }
  return [...officers.values()];
}

async function loadState() {
  const [characters, killmails, history, settings] = await Promise.all([
    store.getAll('characters'),
    store.getAll('killmails'),
    store.getAll('history'),
    store.getSetting('settings', DEFAULT_SETTINGS)
  ]);

  state.characters = characters.sort((a, b) => a.name.localeCompare(b.name));
  state.killmails = killmails.sort((a, b) => String(b.killmailTime || '').localeCompare(String(a.killmailTime || '')));
  state.history = history.sort((a, b) => Number(b.sentAt || 0) - Number(a.sentAt || 0));
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    attackerRoles: { ...(settings?.attackerRoles || {}) },
    customOffenses: availableOffenses(settings?.customOffenses).filter((offense) => offense.custom)
  };
  const manualImports = state.killmails.filter((killmail) => killmail.manualImportedAt && killmail.detail);
  manualImports.forEach((killmail) => applyKillmailClassification(killmail));
  await store.putMany('killmails', manualImports);
  applyAppearance();
}

function applyAppearance() {
  document.body.classList.remove('theme-dark', 'theme-light', 'theme-system');
  document.body.classList.add(`theme-${state.settings.theme}`);
  document.body.classList.remove('layout-contained', 'layout-full');
  document.body.classList.add(`layout-${state.settings.layoutWidth === 'full' ? 'full' : 'contained'}`);
}

function changeView(view) {
  state.currentView = ['dashboard', 'history', 'settings'].includes(view) ? view : 'dashboard';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  renderNavigation();
  renderVisibleView();
  renderDashboard();
  renderHistory();
  renderSettings();
}

function renderNavigation() {
  document.querySelectorAll('[data-view-target]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.viewTarget === state.currentView);
  });

  document.getElementById('nav-characters').innerHTML = state.characters.map((character) => `
    <span class="nav-character" title="${h(character.name)} is authorized">
      <img src="${characterPortrait(character.id, 64)}" alt="${h(character.name)}">
    </span>
  `).join('');

  const hasCharacters = state.characters.length > 0;
  const syncButton = document.getElementById('sync-button');
  syncButton.disabled = !hasCharacters || state.syncing;
  syncButton.textContent = state.syncing ? 'Syncing…' : 'Sync';
  document.getElementById('add-character-button').textContent = hasCharacters ? 'Add character' : 'Log in';
}

function renderVisibleView() {
  const showWelcome = state.currentView === 'dashboard' && state.characters.length === 0;
  document.getElementById('welcome-view').hidden = !showWelcome;
  document.getElementById('dashboard-view').hidden = state.currentView !== 'dashboard' || showWelcome;
  document.getElementById('history-view').hidden = state.currentView !== 'history';
  document.getElementById('settings-view').hidden = state.currentView !== 'settings';

  const loginButton = document.getElementById('welcome-login-button');
  loginButton.textContent = 'Log in with EVE Online';
}

function summaryStat(value, label) {
  return `<div class="summary-stat"><strong>${h(value)}</strong><span>${h(label)}</span></div>`;
}

function uniqueHistoryRecipientCount() {
  return new Set(state.history.flatMap((entry) => entry.recipientIds || [entry.recipientId]).filter(Boolean)).size;
}

function renderDashboard() {
  if (state.characters.length === 0) return;

  const pending = groupKillmails(state.killmails.filter((killmail) => killmail.status === 'pending')).length;
  const sent = groupKillmails(state.killmails.filter((killmail) => killmail.status === 'sent')).length;
  const cleared = groupKillmails(state.killmails.filter((killmail) => killmail.status === 'cleared')).length;
  const uniqueRecipients = uniqueHistoryRecipientCount();

  document.getElementById('summary-strip').innerHTML = [
    summaryStat(pending, 'Pending'),
    summaryStat(state.history.length, 'Delivered'),
    summaryStat(uniqueRecipients, 'Pilots cited')
  ].join('');
  document.getElementById('pending-count').textContent = pending;
  document.getElementById('sent-count').textContent = sent;
  document.getElementById('cleared-count').textContent = cleared;

  document.querySelectorAll('[data-status-filter]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.statusFilter === state.statusFilter);
  });

  const lastSync = state.killmails.reduce((latest, killmail) => Math.max(latest, Number(killmail.lastSeenAt || 0)), 0);
  const lastSyncCopy = document.getElementById('last-sync-copy');
  if (lastSync) {
    lastSyncCopy.innerHTML = `Last ESI intake ${utcTimeElement(lastSync)} across ${state.characters.length} authorized ${state.characters.length === 1 ? 'character' : 'characters'}.`;
  } else {
    lastSyncCopy.textContent = `${state.characters.length} ${state.characters.length === 1 ? 'character is' : 'characters are'} ready for the first ESI intake.`;
  }

  renderKillmailList();
  renderComposer();

  const group = selectedKillmailGroup();
  const hasDueAppraisal = group?.records.some((killmail) => {
    const retryAt = Number(killmail.zkbLookupErrorAt || 0) + ZKILL_RETRY_COOLDOWN;
    return !killmail.totalValue && !state.zkbLoadingIds.has(Number(killmail.id)) && Date.now() >= retryAt;
  });
  if (group && hasDueAppraisal) {
    queueMicrotask(() => ensureZkillValues(group.records, { notifyFailure: false }));
  }
}

function killmailMatchesSearch(killmail, query) {
  if (!query) return true;
  const haystack = [
    killmail.enriched?.victimName,
    killmail.enriched?.victimCorporationName,
    killmail.enriched?.victimShipName,
    killmail.enriched?.systemName,
    killmail.id
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

function visibleKillmailGroups() {
  const query = state.search.trim().toLowerCase();
  return groupKillmails(state.killmails.filter((killmail) => killmail.status === state.statusFilter))
    .filter((group) => group.records.some((killmail) => killmailMatchesSearch(killmail, query)));
}

function killmailGroupRecipientId(group) {
  const id = Number(group?.primary?.recipientId || group?.primary?.detail?.victim?.character_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function killmailBadge(killmail) {
  if (killmail.status === 'sent') return '<span class="badge badge-sent">Sent</span>';
  if (!killmail.detail?.victim?.character_id) return '<span class="badge badge-npc">NPC record</span>';
  if (killmail.direction === 'loss') return '<span class="badge badge-loss">WHPD loss</span>';
  if (killmail.actionable) return '<span class="badge badge-action">Actionable</span>';
  return '<span class="badge badge-loss">Assist only</span>';
}

function renderKillmailList() {
  const groups = visibleKillmailGroups();
  const visibleGroupIds = new Set(groups.map((group) => Number(group.id)));
  for (const groupId of state.bundledIncidentIds) {
    if (!visibleGroupIds.has(Number(groupId))) state.bundledIncidentIds.delete(groupId);
  }
  const bundledGroups = groups.filter((group) => state.bundledIncidentIds.has(Number(group.id)));
  const recordCount = groups.reduce((count, group) => count + group.records.length, 0);
  const resultCopy = groups.length === recordCount
    ? `${recordCount} ${recordCount === 1 ? 'incident' : 'incidents'}`
    : `${groups.length} ${groups.length === 1 ? 'incident' : 'incidents'} · ${recordCount} records`;
  document.getElementById('queue-result-count').textContent = bundledGroups.length
    ? `${resultCopy} · ${bundledGroups.length} grouped`
    : resultCopy;
  const list = document.getElementById('killmail-list');

  if (!groups.length) {
    const copy = state.killmails.length
      ? 'No combat records match this queue and search.'
      : 'Sync authorized characters to pull recent killmails from ESI.';
    list.innerHTML = `<div class="list-empty"><div><div class="empty-glyph" aria-hidden="true">⌁</div><p>${h(copy)}</p></div></div>`;
    if (!selectedKillmail() || selectedKillmail()?.status !== state.statusFilter) {
      state.selectedKillmailId = null;
      state.draft = null;
    }
    return;
  }

  let selectedGroup = groups.find((group) => group.records.some((record) => Number(record.id) === Number(state.selectedKillmailId)));
  if (bundledGroups.length && (!selectedGroup || !state.bundledIncidentIds.has(Number(selectedGroup.id)))) {
    selectedGroup = bundledGroups[0];
    state.selectedKillmailId = selectedGroup.primary.id;
    state.draft = null;
  }
  if (!selectedGroup) {
    selectedGroup = groups[0];
    state.selectedKillmailId = selectedGroup.primary.id;
    state.draft = null;
  } else if (Number(state.selectedKillmailId) !== Number(selectedGroup.primary.id)) {
    state.selectedKillmailId = selectedGroup.primary.id;
  }

  list.innerHTML = groups.map((group) => {
    const killmail = group.primary;
    const victimId = killmail.detail?.victim?.character_id;
    const victimShipId = killmail.detail?.victim?.ship_type_id;
    const victimName = killmail.enriched?.victimName || (victimId ? `Character ${victimId}` : 'Non-capsuleer vessel');
    const shipNames = group.records.map((record) => record.enriched?.victimShipName || 'Unknown ship');
    const shipName = shipNames.join(' + ');
    const systemName = killmail.enriched?.systemName || 'Unknown system';
    const totalValue = groupTotalValue(group);
    const latestRecord = group.records.at(-1) || killmail;
    const isBundled = state.bundledIncidentIds.has(Number(group.id));
    const recipientId = killmailGroupRecipientId(group);
    const bundleDisabled = state.statusFilter !== 'pending'
      || !killmail.actionable
      || !recipientId;
    const bundleTitle = state.statusFilter !== 'pending'
      ? 'Only pending incidents can be bundled for delivery.'
      : (!recipientId
          ? 'This incident has no capsuleer EVE Mail recipient.'
          : (!killmail.actionable
              ? 'This incident is not an outbound citation record.'
              : `Include this incident in a bundled citation for ${victimName}`));
    return `
      <div class="killmail-row ${Number(killmail.id) === Number(state.selectedKillmailId) ? 'is-selected' : ''} ${isBundled ? 'is-bundled' : ''} ${killmail.actionable ? '' : 'is-unactionable'} ${group.pod ? 'is-grouped' : ''}" data-killmail-id="${killmail.id}" role="button" tabindex="0">
        <label class="killmail-select" title="${h(bundleTitle)}">
          <input type="checkbox" data-incident-select="${group.id}" aria-label="${h(bundleTitle)}" ${isBundled ? 'checked' : ''} ${bundleDisabled ? 'disabled' : ''}>
        </label>
        <span class="killmail-portrait">
          <img src="${victimId ? characterPortrait(victimId, 64) : typeIcon(victimShipId, 64)}" alt="">
          <img class="ship-thumb" src="${typeIcon(victimShipId, 64)}" alt="">
        </span>
        <span class="killmail-copy">
          <strong>${h(victimName)}</strong>
          <span>${h(shipName)} · ${h(systemName)}</span>
          ${killmailBadge(killmail)}
          ${group.pod ? '<span class="badge badge-grouped">Ship + pod</span>' : ''}
        </span>
        <span class="killmail-meta">
          ${utcTimeElement(latestRecord.killmailTime)}
          <span title="${h(group.records.map((record) => `Killmail #${record.id}`).join(' + '))}">${h(formatIsk(totalValue) || (group.pod ? '2 records' : `#${killmail.id}`))}</span>
        </span>
      </div>
    `;
  }).join('');
}

async function selectKillmail(killmailId) {
  state.bundledIncidentIds.clear();
  state.selectedKillmailId = Number(killmailId);
  state.draft = null;
  renderKillmailList();
  renderComposer();

  await ensureZkillValues(selectedKillmailGroup()?.records || [], { force: true });
}

async function toggleBundledIncident(groupId, checked) {
  const groups = visibleKillmailGroups();
  const group = groups.find((item) => Number(item.id) === Number(groupId));
  if (!group) return;

  if (checked) {
    state.bundledIncidentIds.add(Number(group.id));
    state.selectedKillmailId = Number(group.primary.id);
  } else {
    state.bundledIncidentIds.delete(Number(group.id));
    const remaining = groups.find((item) => state.bundledIncidentIds.has(Number(item.id)));
    state.selectedKillmailId = Number(remaining?.primary?.id || group.primary.id);
  }

  state.draft = null;
  renderKillmailList();
  renderComposer();
  await ensureZkillValues(selectedKillmailGroup()?.records || [], { force: true });
}

async function ensureZkillValue(killmail, { force = false, notifyFailure = true } = {}) {
  if (!killmail || killmail.totalValue) return killmail?.totalValue || null;

  const killmailId = Number(killmail.id);
  if (state.zkbLoadingIds.has(killmailId)) return null;
  if (!force && Date.now() < Number(killmail.zkbLookupErrorAt || 0) + ZKILL_RETRY_COOLDOWN) return null;

  state.zkbLoadingIds.add(killmailId);
  setWorking('Appraising with zKillboard');
  if (selectedKillmailGroup()?.records.some((record) => Number(record.id) === killmailId)) renderComposer();

  try {
    const totalValue = await esi.zkillValue(killmailId);
    if (!totalValue) throw new Error('zKillboard did not return a total value for this killmail.');

    killmail.totalValue = totalValue;
    killmail.valueSource = 'zkillboard';
    killmail.zkbLookupAt = Date.now();
    delete killmail.zkbLookupError;
    delete killmail.zkbLookupErrorAt;
    await store.put('killmails', killmail);

    const selectedGroup = selectedKillmailGroup();
    if (selectedGroup?.records.some((record) => Number(record.id) === killmailId)) {
      const combinedValue = groupTotalValue(selectedGroup);
      if (state.draft && !state.draft.totalValue && combinedValue) state.draft.totalValue = formatIsk(combinedValue);
      renderKillmailList();
      renderComposer();
    }
    return totalValue;
  } catch (error) {
    console.warn(error);
    killmail.zkbLookupError = error.message;
    killmail.zkbLookupErrorAt = Date.now();
    await store.put('killmails', killmail);
    if (notifyFailure) await showAlert(
      'zKillboard appraisal was unavailable. You can retry or enter the value manually.',
      { title: 'Appraisal unavailable' }
    );
    return null;
  } finally {
    state.zkbLoadingIds.delete(killmailId);
    setWorking('');
    if (selectedKillmailGroup()?.records.some((record) => Number(record.id) === killmailId) && !killmail.totalValue) renderComposer();
  }
}

async function ensureZkillValues(killmails, { force = false, notifyFailure = true } = {}) {
  const records = [...(killmails || [])];
  await Promise.all(records.map((killmail) => ensureZkillValue(killmail, { force, notifyFailure: false })));
  const unavailable = records.some((killmail) => !killmail.totalValue);
  if (unavailable && notifyFailure) {
    await showAlert(
      'One or more zKillboard appraisals were unavailable. You can retry or enter the combined value manually.',
      { title: 'Appraisal unavailable' }
    );
  }
  return unavailable ? null : records.reduce((total, killmail) => total + Number(killmail.totalValue), 0);
}

function renderComposer() {
  const root = document.getElementById('composer-root');
  const empty = document.getElementById('composer-empty');
  const killmail = selectedKillmail();
  const group = selectedKillmailGroup() || (killmail ? { primary: killmail, pod: null, records: [killmail] } : null);
  if (!killmail) {
    root.innerHTML = '';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  const victim = killmail.detail?.victim || {};
  const sender = senderFor(killmail);
  const groupedKillmail = citationKillmail(group);
  const victimName = groupedKillmail.enriched?.victimName || 'Unknown pilot';
  const groupOfficers = officersForGroup(group);
  const officerNames = formatNameList(groupOfficers.map((officer) => officer.name), 'the involved officer');
  const groupKey = group.records.map((record) => Number(record.id)).join(':');
  const draftKey = (state.draft?.sourceKillmailIds || []).map(Number).join(':');
  if (!state.draft || draftKey !== groupKey) state.draft = createCitationDraft(group, sender);
  const attackerType = state.draft.attackerType || 'officer';
  const isFleetAttacker = attackerType === 'fleet' || attackerType === 'memefleet';

  const statusAction = killmail.status === 'pending'
    ? '<button type="button" class="button button-secondary button-small" data-action="clear-record">Clear</button>'
    : '<button type="button" class="button button-secondary button-small" data-action="restore-record">Restore to pending</button>';
  const appraisalLoading = group.records.some((record) => state.zkbLoadingIds.has(Number(record.id)));
  const totalValue = groupTotalValue(group);
  const appraisalAction = !totalValue
    ? `<button type="button" class="button button-ghost button-small" data-action="retry-zkill" ${appraisalLoading ? 'disabled' : ''}>${appraisalLoading ? 'Appraising…' : 'Get value'}</button>`
    : '';
  const appraisalValue = formatIsk(totalValue)
    || (appraisalLoading ? 'Loading from zKillboard…' : 'Unavailable · manual entry allowed');
  const incidentCount = Number(group.incidentCount) || 1;
  const bundleSummary = incidentCount > 1 ? `${incidentCount} incidents · ${group.records.length} combat records · ` : '';
  const combatRecordLinks = group.records.map((record) => {
    const label = isPodKillmail(record) ? `Pod killmail #${record.id}` : `Killmail #${record.id}`;
    return `<a href="https://zkillboard.com/kill/${record.id}/" target="_blank" rel="noopener noreferrer">${h(label)}</a>`;
  }).join(' + ');

  const senderOptions = state.characters.map((character) => `
    <option value="${character.id}" ${Number(character.id) === Number(sender?.id) ? 'selected' : ''}>${h(character.name)}</option>
  `).join('');

  root.innerHTML = `
    <div class="composer-header">
      <img src="${victim.character_id ? characterPortrait(victim.character_id, 64) : typeIcon(victim.ship_type_id, 64)}" alt="">
      <div>
        <h2>${h(victimName)}</h2>
        <p>${h(groupedKillmail.enriched?.victimCorporationName || 'Unknown corporation')} · ${h(bundleSummary)}${combatRecordLinks} · ${utcTimeElement(killmail.killmailTime)}</p>
      </div>
      <div class="composer-header-actions">
        ${appraisalAction}
        ${statusAction}
      </div>
    </div>
    <div class="record-facts">
      ${recordFact(group.records.length > 1 ? 'Systems' : 'System', groupedKillmail.enriched?.systemName || 'Unknown')}
      ${recordFact(group.records.length > 1 ? 'Destroyed ships' : 'Destroyed ship', groupedKillmail.enriched?.victimShipName || 'Unknown')}
      ${recordFact(
        isFleetAttacker ? 'Citation attackers' : (attackerType === 'deputy' ? 'Citation deputy' : (groupOfficers.length > 1 ? 'Citation officers' : 'Citation officer')),
        state.draft.officerName || 'Unknown'
      )}
      ${recordFact(group.records.every((record) => record.valueSource === 'zkillboard') ? 'zKill appraisal' : 'Total value', appraisalValue)}
    </div>
    ${state.settings.testMode ? `<div class="test-mode-notice"><strong>TEST mode</strong><span>The citation will be sent only to ${h(officerNames)}. The cited pilots and mailing list will not receive it; the incident status and delivery ledger will remain unchanged.</span></div>` : ''}
    <div class="composer-form">
      <div class="citation-fields">
        <div class="field-grid">
          <label class="composer-field">
            <span>EVE Mail sender</span>
            <select id="composer-sender" ${state.settings.senderMode === 'final-blow' ? 'disabled' : ''}>${senderOptions}</select>
          </label>
          <label class="composer-field">
            <span>Short title</span>
            <input data-draft-field="title" value="${h(state.draft.title)}" maxlength="132">
          </label>
          <label class="composer-field">
            <span>Total value</span>
            <input data-draft-field="totalValue" value="${h(state.draft.totalValue)}" placeholder="123,456,789 ISK">
          </label>
          <label class="composer-field">
            <span>${isFleetAttacker ? 'Officer ship · not used for fleets' : 'Officer ship'}</span>
            <input data-draft-field="officerShipName" value="${h(state.draft.officerShipName)}" ${isFleetAttacker ? 'disabled' : ''}>
          </label>
          <label class="composer-field">
            <span>Attacker type</span>
            <select id="attacker-type-select">
              <option value="officer" ${attackerType === 'officer' ? 'selected' : ''}>Officer</option>
              <option value="deputy" ${attackerType === 'deputy' ? 'selected' : ''}>Deputy</option>
              <option value="fleet" ${attackerType === 'fleet' ? 'selected' : ''}>Fleet</option>
              <option value="memefleet" ${attackerType === 'memefleet' ? 'selected' : ''}>Memefleet</option>
            </select>
          </label>
          <label class="composer-field">
            <span>${isFleetAttacker ? 'Attacker' : 'Officer name'}</span>
            <input data-draft-field="officerName" value="${h(state.draft.officerName)}" ${isFleetAttacker ? 'readonly' : ''}>
          </label>
        </div>
        <div class="composer-field legal-activity-field">
          <span>Activity · select offenses from the <a href="https://whpd.space/LegalLibrary.html" target="_blank" rel="noopener noreferrer">Legal Library</a></span>
          <div class="legal-checklist">
            ${renderOffenseCheckboxes(state.draft.offenseIds)}
          </div>
          <p id="activity-summary" class="activity-summary">Narrative activity: ${h(state.draft.activity || 'Select at least one offense')}</p>
        </div>
        <label class="composer-field">
          <span>Opening humor</span>
          <textarea data-draft-field="humor">${h(state.draft.humor)}</textarea>
        </label>
        <label class="composer-field">
          <span>Evidence · one bullet per line</span>
          <textarea data-draft-list="evidence">${h(state.draft.evidence.join('\n'))}</textarea>
        </label>
        <label class="composer-field">
          <span>Officer Comments · optional</span>
          <textarea data-draft-list="officerComments" placeholder="Leave blank to omit this section">${h((state.draft.officerComments || []).join('\n'))}</textarea>
        </label>
        <label class="composer-field">
          <span>Final WHPD note</span>
          <textarea data-draft-field="finalNote">${h(state.draft.finalNote)}</textarea>
        </label>
        ${senderWarning(killmail, sender, group)}
      </div>
      <div class="citation-output">
        <div class="output-label">
          <strong>Subject</strong>
          <button type="button" class="button button-ghost button-small" data-action="copy-subject">Copy</button>
        </div>
        <div id="citation-subject" class="citation-subject"></div>
        <div class="output-label" style="margin-top: 0.8rem">
          <strong>Rendered EVE Mail body</strong>
          <button type="button" class="button button-ghost button-small" data-action="copy-body">Copy HTML</button>
        </div>
        <div id="citation-preview" class="citation-preview"></div>
        <div id="citation-validation"></div>
        <div class="composer-footer">
          <p id="citation-size"></p>
          <div class="composer-footer-actions">
            <button type="button" class="button button-secondary" data-action="reset-draft">Reset draft</button>
            <button id="send-citation-button" type="button" class="button button-primary" data-action="send-citation">Send citation</button>
          </div>
        </div>
      </div>
    </div>
  `;
  refreshCitationPreview();
}

function recordFact(label, value) {
  return `<div class="record-fact"><span>${h(label)}</span><strong title="${h(value)}">${h(value)}</strong></div>`;
}

function renderOffenseCheckboxes(selectedIds = []) {
  const selected = new Set(selectedIds || []);
  const offenses = availableOffenses(state.settings.customOffenses);
  return ['Misdemeanor', 'Felony'].map((classification) => `
    <fieldset class="legal-offense-group">
      <legend>${classification === 'Misdemeanor' ? 'Misdemeanors' : 'Felonies'}</legend>
      ${sortOffensesAlphabetically(offenses.filter((offense) => offense.classification === classification)).map((offense) => `
        <label class="legal-offense ${offense.custom ? 'is-custom' : ''}">
          <input type="checkbox" data-offense-id="${h(offense.id)}" ${selected.has(offense.id) ? 'checked' : ''}>
          <span><strong>${h(offense.title)}</strong><small>${h(offense.code)}${offense.custom ? ' · Custom' : ''}</small></span>
        </label>
      `).join('')}
    </fieldset>
  `).join('');
}

function senderWarning(killmail, sender, group = null) {
  if (!sender && state.settings.senderMode === 'final-blow') {
    return '<p class="sender-warning">The final-blow character is not authorized in this browser. Add that character or choose a specified sender in Settings.</p>';
  }
  if (!sender) {
    return '<p class="sender-warning">Choose an authorized EVE Mail sender in Settings.</p>';
  }
  if (state.settings.testMode) {
    return officersForGroup(group || { records: [killmail] }).length
      ? ''
      : '<p class="sender-warning">TEST mode needs at least one involved capsuleer officer identified by the bundled records.</p>';
  }
  if (!killmail.detail?.victim?.character_id) {
    return '<p class="sender-warning">This record has no capsuleer recipient, so EVE Mail delivery is unavailable. It can still be cleared.</p>';
  }
  if (!killmail.actionable) {
    return `<p class="sender-warning">${killmail.direction === 'loss' ? 'This is a WHPD loss, not an outbound enforcement action.' : 'No authorized WHPD character appears as an attacker.'} Review carefully before clearing it.</p>`;
  }
  return '';
}

function citationErrors(killmail, sender, citation) {
  const errors = validateCitation(state.draft);
  const mailingListId = Number(state.settings.mailingListId);
  const records = selectedKillmailGroup()?.records || [killmail];
  if (records.some((record) => !record.detail?.victim?.character_id)) errors.push('Every bundled killmail must have a capsuleer recipient.');
  if (records.some((record) => !record.actionable)) errors.push('Every bundled killmail must be an outbound WHPD enforcement action.');
  if (!sender) errors.push('An authorized EVE Mail sender is required.');
  if (!Number.isSafeInteger(mailingListId) || mailingListId <= 0) errors.push('A valid mailing list ID is required for live delivery.');
  if (records.some((record) => record.status !== 'pending')) errors.push('Restore every bundled record to pending before sending it again.');
  if (citation.subject.length > 150) errors.push('The EVE Mail subject exceeds 150 characters.');
  if (citation.body.length > 8000) errors.push('The EVE Mail body exceeds 8,000 characters.');
  return errors;
}

function testCitationErrors(killmail, sender, citation) {
  const errors = validateCitation(state.draft);
  const group = selectedKillmailGroup() || { records: [killmail] };
  if (!sender) errors.push('An authorized EVE Mail sender is required.');
  if (!officersForGroup(group).length) errors.push('The bundled records do not identify an involved capsuleer officer.');
  if (citation.subject.length > 150) errors.push('The EVE Mail subject exceeds 150 characters.');
  if (citation.body.length > 8000) errors.push('The EVE Mail body exceeds 8,000 characters.');
  return errors;
}

function refreshCitationPreview() {
  const killmail = selectedKillmail();
  if (!killmail || !state.draft) return;
  const citation = buildCitation(state.draft);
  const sender = senderFor(killmail);
  const errors = state.settings.testMode
    ? testCitationErrors(killmail, sender, citation)
    : citationErrors(killmail, sender, citation);

  const subject = document.getElementById('citation-subject');
  const preview = document.getElementById('citation-preview');
  if (!subject || !preview) return;
  subject.textContent = citation.subject;
  preview.innerHTML = citation.body.replace(/\n/g, '<br>');
  document.getElementById('citation-size').textContent = `${citation.subject.length}/150 subject · ${citation.body.length}/8,000 body`;
  document.getElementById('citation-validation').innerHTML = errors.length
    ? `<ul class="validation-list">${errors.map((error) => `<li>${h(error)}</li>`).join('')}</ul>`
    : '';
  const sendButton = document.getElementById('send-citation-button');
  const testOfficerCount = officersForGroup(selectedKillmailGroup() || { records: [killmail] }).length;
  sendButton.disabled = errors.length > 0 || state.sending;
  sendButton.textContent = state.sendingMode === 'test'
    ? 'Sending TEST…'
    : (state.sendingMode === 'citation' ? 'Sending…' : (state.settings.testMode ? `Send TEST to ${testOfficerCount === 1 ? 'officer' : 'officers'}` : 'Send citation'));
}

function renderHistory() {
  const root = document.getElementById('history-root');
  const uniqueRecipients = uniqueHistoryRecipientCount();
  const senders = new Set(state.history.map((entry) => entry.senderId).filter(Boolean)).size;
  document.getElementById('history-summary').innerHTML = [
    summaryStat(state.history.length, 'Citations'),
    summaryStat(uniqueRecipients, 'Recipients'),
    summaryStat(senders, 'Mail senders')
  ].join('');

  if (!state.history.length) {
    root.innerHTML = '<div class="list-empty"><div><div class="empty-glyph" aria-hidden="true">§</div><p>No citations have been sent from this browser yet.</p></div></div>';
    return;
  }

  root.innerHTML = `
    <table class="ledger-table">
      <thead><tr><th>Recipient</th><th>Citation</th><th>EVE Mail sender</th><th>Delivered</th><th>Record</th></tr></thead>
      <tbody>
        ${state.history.map((entry) => `
          <tr>
            <td><div class="ledger-person"><img src="${characterPortrait(entry.recipientId, 64)}" alt=""><div><strong>${h(entry.recipientName)}</strong><span>${h(entry.recipientCorporationName || '')}</span>${entry.mailingListId ? `<span>Mailing list #${h(entry.mailingListId)}</span>` : ''}</div></div></td>
            <td><strong>${h(entry.subject)}</strong><span>${h(entry.systemName || '')} · ${h(entry.shipName || '')}</span></td>
            <td>${h(entry.senderName)}</td>
            <td>${utcTimeElement(entry.sentAt)}</td>
            <td>${(entry.killmailIds || [entry.killmailId]).map((killmailId) => `<a href="https://zkillboard.com/kill/${killmailId}/" target="_blank" rel="noopener noreferrer">#${killmailId}</a>`).join(' + ')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderSettings() {
  document.getElementById('theme-select').value = state.settings.theme;
  document.getElementById('layout-width-select').value = state.settings.layoutWidth;
  document.getElementById('page-count-select').value = String(state.settings.pageCount);
  document.getElementById('mailing-list-id-input').value = String(state.settings.mailingListId);
  const testModeInput = document.getElementById('test-mode-input');
  const autoClearInput = document.getElementById('auto-clear-input');
  testModeInput.checked = Boolean(state.settings.testMode);
  autoClearInput.checked = Boolean(state.settings.autoClearAfterSend);
  autoClearInput.disabled = testModeInput.checked;
  document.querySelectorAll('input[name="sender-mode"]').forEach((input) => {
    input.checked = input.value === state.settings.senderMode;
  });

  const senderSelect = document.getElementById('specified-sender-select');
  senderSelect.innerHTML = state.characters.length
    ? state.characters.map((character) => `<option value="${character.id}">${h(character.name)}</option>`).join('')
    : '<option value="">No authorized characters</option>';
  senderSelect.value = String(state.settings.specifiedSenderId || state.characters[0]?.id || '');
  senderSelect.disabled = state.settings.senderMode !== 'specified' || state.characters.length === 0;

  const characterList = document.getElementById('authorized-character-list');
  characterList.innerHTML = state.characters.map((character) => `
    <div class="character-setting">
      <img src="${characterPortrait(character.id, 64)}" alt="">
      <strong>${h(character.name)}</strong>
      <button type="button" class="button button-ghost button-small" data-remove-character="${character.id}">Remove</button>
    </div>
  `).join('');
  renderCustomOffenses();
}

function renderCustomOffenses() {
  const root = document.getElementById('custom-offense-list');
  if (!root) return;
  const customOffenses = availableOffenses(state.settings.customOffenses).filter((offense) => offense.custom);
  root.innerHTML = customOffenses.length
    ? customOffenses.map((offense) => `
      <div class="custom-offense-row">
        <span class="custom-offense-badge ${offense.classification === 'Felony' ? 'is-felony' : ''}">${h(offense.classification)}</span>
        <span class="custom-offense-copy">
          <strong>${h(offense.title)}</strong>
          <small>${h(offense.code)}</small>
        </span>
        <button type="button" class="button button-ghost button-small" data-remove-custom-offense="${h(offense.id)}">Remove</button>
      </div>
    `).join('')
    : '<p class="custom-offense-empty">No custom offenses have been added on this device.</p>';
}

async function syncAllCharacters({ quiet = false } = {}) {
  if (state.syncing || !state.characters.length) return;
  if (!esi.isConfigured()) {
    await showAlert('EVE SSO is not configured for this deployment.', { title: 'SSO unavailable' });
    return;
  }

  state.syncing = true;
  renderNavigation();
  setWorking('Starting intake');
  const descriptors = new Map();
  const failures = [];

  try {
    for (let characterIndex = 0; characterIndex < state.characters.length; characterIndex += 1) {
      const character = state.characters[characterIndex];
      setWorking(`Syncing ${characterIndex + 1}/${state.characters.length}`);
      try {
        for (let page = 1; page <= Number(state.settings.pageCount); page += 1) {
          const response = await esi.recentKillmails(character.id, page);
          const records = Array.isArray(response.data) ? response.data : [];
          records.forEach((record) => {
            const existing = descriptors.get(Number(record.killmail_id)) || {
              id: Number(record.killmail_id),
              hash: record.killmail_hash,
              sourceCharacterIds: []
            };
            if (!existing.sourceCharacterIds.includes(character.id)) existing.sourceCharacterIds.push(character.id);
            descriptors.set(existing.id, existing);
          });
          const totalPages = Number(response.headers.get('X-Pages') || 1);
          if (!records.length || page >= totalPages) break;
        }
      } catch (error) {
        console.error(error);
        failures.push(`${character.name}: ${error.message}`);
      }
    }

    const existingById = new Map(state.killmails.map((killmail) => [Number(killmail.id), killmail]));
    const pendingDetails = [];
    for (const descriptor of descriptors.values()) {
      const existing = existingById.get(descriptor.id);
      const merged = existing
        ? {
            ...existing,
            hash: descriptor.hash,
            sourceCharacterIds: [...new Set([...(existing.sourceCharacterIds || []), ...descriptor.sourceCharacterIds])],
            lastSeenAt: Date.now()
          }
        : {
            ...descriptor,
            status: 'pending',
            firstSeenAt: Date.now(),
            lastSeenAt: Date.now(),
            totalValue: null,
            zkbLookupAttempted: false
          };
      existingById.set(merged.id, merged);
      if (!merged.detail) pendingDetails.push(merged);
    }

    let completed = 0;
    await runPool(pendingDetails, 4, async (killmail) => {
      try {
        killmail.detail = await esi.killmail(killmail.id, killmail.hash);
        killmail.killmailTime = killmail.detail.killmail_time;
      } catch (error) {
        console.error(error);
        killmail.detailError = error.message;
      } finally {
        completed += 1;
        if (pendingDetails.length) setWorking(`Loading records ${completed}/${pendingDetails.length}`);
      }
    });

    const touched = [...descriptors.keys()].map((id) => existingById.get(id)).filter(Boolean);
    await enrichKillmails(touched);
    await store.putMany('killmails', touched);
    state.killmails = [...existingById.values()].sort((a, b) => String(b.killmailTime || '').localeCompare(String(a.killmailTime || '')));
    if (!quiet) {
      showToast(`Intake complete. ${descriptors.size} unique combat ${descriptors.size === 1 ? 'record' : 'records'} reviewed.`);
    }
    if (failures.length) await showAlert(
      `Some characters could not sync:\n${failures.join('\n')}`,
      { title: 'Intake incomplete' }
    );
  } finally {
    state.syncing = false;
    setWorking('');
    render();
  }
}

async function importZkillRecord(event) {
  event.preventDefault();
  if (state.importingZkill) return;
  if (state.syncing) {
    await showAlert('Wait for the current ESI intake to finish before adding a record.', { title: 'Intake in progress' });
    return;
  }

  const input = document.getElementById('zkill-import-input');
  const button = document.getElementById('zkill-import-button');
  const killmailId = parseZkillKillmailId(input.value);
  if (!killmailId) {
    await showAlert('Enter a valid zKillboard kill link or kill ID.', { title: 'Invalid combat record' });
    input.focus();
    return;
  }

  const existing = state.killmails.find((killmail) => Number(killmail.id) === killmailId);
  if (existing) {
    state.statusFilter = existing.status || 'pending';
    state.search = '';
    state.selectedKillmailId = killmailId;
    state.bundledIncidentIds.clear();
    state.draft = null;
    input.value = '';
    document.getElementById('queue-search').value = '';
    render();
    showToast(`Killmail #${killmailId} is already in the ${state.statusFilter} queue.`);
    return;
  }

  state.importingZkill = true;
  button.disabled = true;
  button.textContent = 'Adding…';
  setWorking('Importing zKillboard record');

  try {
    const imported = await esi.zkillKillmail(killmailId);
    const importedAt = Date.now();
    const killmail = {
      id: imported.id,
      hash: imported.hash,
      sourceCharacterIds: [],
      status: 'pending',
      firstSeenAt: importedAt,
      lastSeenAt: importedAt,
      manualImportedAt: importedAt,
      detail: imported.detail,
      killmailTime: imported.detail.killmail_time,
      totalValue: imported.totalValue,
      valueSource: imported.totalValue ? 'zkillboard' : null,
      zkbLookupAttempted: true,
      zkbLookupAt: importedAt
    };

    await enrichKillmails([killmail]);
    await store.put('killmails', killmail);
    state.killmails.push(killmail);
    state.killmails.sort((left, right) => Number(right.id) - Number(left.id));
    state.statusFilter = 'pending';
    state.search = '';
    state.selectedKillmailId = killmail.id;
    state.bundledIncidentIds.clear();
    state.draft = null;
    input.value = '';
    document.getElementById('queue-search').value = '';
    render();
    showToast(`Killmail #${killmail.id} added to the pending queue.`);
  } catch (error) {
    console.error(error);
    await showAlert(`Combat record was not added: ${error.message}`, { title: 'Import failed', tone: 'danger' });
  } finally {
    state.importingZkill = false;
    button.disabled = false;
    button.textContent = 'Add record';
    setWorking('');
  }
}

async function runPool(items, concurrency, worker) {
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
}

async function enrichKillmails(killmails) {
  const ids = [];
  killmails.forEach((killmail) => {
    const detail = killmail.detail;
    if (!detail) return;
    ids.push(detail.solar_system_id);
    ids.push(detail.victim?.character_id, detail.victim?.corporation_id, detail.victim?.alliance_id, detail.victim?.ship_type_id);
    (detail.attackers || []).forEach((attacker) => {
      ids.push(attacker.character_id, attacker.corporation_id, attacker.alliance_id, attacker.ship_type_id);
    });
  });
  const names = await esi.resolveNames(ids);
  const managed = managedCharacterIds();

  killmails.forEach((killmail) => {
    const detail = killmail.detail;
    if (!detail) return;
    const victim = detail.victim || {};
    const attackers = detail.attackers || [];
    const finalBlow = attackers.find((attacker) => attacker.final_blow) || {};
    const managedAttackers = attackers.filter((attacker) => managed.has(Number(attacker.character_id)));
    const involvedOfficer = selectInvolvedOfficer(attackers, managed) || {};
    const senderShips = {};
    managedAttackers.forEach((attacker) => {
      if (attacker.character_id) senderShips[String(attacker.character_id)] = names.get(Number(attacker.ship_type_id)) || 'WHPD patrol vessel';
    });

    killmail.killmailTime = detail.killmail_time;
    killmail.finalBlowCharacterId = Number(finalBlow.character_id) || null;
    killmail.officerCharacterId = Number(involvedOfficer.character_id) || killmail.officerCharacterId || null;
    applyKillmailClassification(killmail, managed);
    killmail.recipientId = Number(victim.character_id) || null;
    killmail.enriched = {
      victimName: victim.character_id ? names.get(Number(victim.character_id)) : 'Non-capsuleer vessel',
      victimCorporationName: names.get(Number(victim.corporation_id)) || '',
      victimAllianceName: names.get(Number(victim.alliance_id)) || '',
      victimShipName: names.get(Number(victim.ship_type_id)) || `Type ${victim.ship_type_id}`,
      systemName: names.get(Number(detail.solar_system_id)) || `System ${detail.solar_system_id}`,
      finalBlowName: finalBlow.character_id
        ? names.get(Number(finalBlow.character_id))
        : names.get(Number(finalBlow.corporation_id)) || 'Local defenders',
      finalBlowShipName: names.get(Number(finalBlow.ship_type_id)) || 'Unknown vessel',
      officerName: involvedOfficer.character_id
        ? names.get(Number(involvedOfficer.character_id))
        : killmail.enriched?.officerName || '',
      officerShipName: names.get(Number(involvedOfficer.ship_type_id)) || killmail.enriched?.officerShipName || '',
      senderShips
    };
  });
}

async function setKillmailStatus(status) {
  const killmail = selectedKillmail();
  const group = selectedKillmailGroup() || (killmail ? { records: [killmail] } : null);
  if (!killmail) return;
  const action = status === 'cleared' ? 'clear' : 'restore';
  const recordLabel = group.records.map((record) => `#${record.id}`).join(' and ');
  const approved = await requestApproval(
    `Are you sure you want to ${action} ${group.records.length > 1 ? 'grouped killmails' : 'killmail'} ${recordLabel}${status === 'cleared' ? ' without sending a citation' : ''}?`,
    {
      title: status === 'cleared' ? 'Clear combat record?' : 'Restore combat record?',
      confirmLabel: status === 'cleared' ? 'Clear record' : 'Restore record',
      tone: status === 'cleared' ? 'danger' : 'notice'
    }
  );
  if (!approved) return;
  group.records.forEach((record) => {
    record.status = status;
    record.statusChangedAt = Date.now();
  });
  await store.putMany('killmails', group.records);
  state.selectedKillmailId = null;
  state.bundledIncidentIds.clear();
  state.draft = null;
  const grouped = group.records.length > 1;
  showToast(status === 'cleared'
    ? `${grouped ? 'Grouped incident' : 'Combat record'} cleared without sending.`
    : `${grouped ? 'Grouped incident' : 'Combat record'} restored to pending.`);
  renderDashboard();
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(message);
  } catch (_) {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast(message);
  }
}

async function sendCitation() {
  if (state.settings.testMode) return sendTestCitation();
  const killmail = selectedKillmail();
  const group = selectedKillmailGroup() || (killmail ? { records: [killmail] } : null);
  const sender = senderFor(killmail);
  if (!killmail || !sender || state.sending) return;
  const citation = buildCitation(state.draft);
  const errors = citationErrors(killmail, sender, citation);
  if (errors.length) {
    await showAlert(errors[0], { title: 'Citation not ready' });
    return;
  }
  const mailingListId = Number(state.settings.mailingListId);
  const recipients = recipientsForGroup(group);
  const recipientIds = recipients.map((recipient) => recipient.id);
  const recordCopy = group.records.length > 1 ? ` covering ${group.records.length} combat records` : '';
  const approved = await requestApproval(
    `Send this citation${recordCopy} to ${state.draft.pilotName} and mailing list #${mailingListId} from ${sender.name}?`,
    { title: 'Send citation?', confirmLabel: 'Send citation' }
  );
  if (!approved) return;

  state.sending = true;
  state.sendingMode = 'citation';
  setWorking('Sending citation');
  refreshCitationPreview();
  try {
    const mailId = await esi.sendCitation(sender.id, recipientIds, citation.subject, citation.body, { mailingListId });
    const sentAt = Date.now();
    const entry = {
      id: `${killmail.id}:${sentAt}`,
      killmailId: killmail.id,
      killmailIds: group.records.map((record) => record.id),
      mailId: Number(mailId) || null,
      recipientId: recipientIds[0],
      recipientIds,
      recipientName: state.draft.pilotName,
      recipientNames: recipients.map((recipient) => recipient.name),
      recipientCorporationName: state.draft.corporationName,
      senderId: sender.id,
      senderName: sender.name,
      mailingListId,
      subject: citation.subject,
      systemName: state.draft.systemName,
      shipName: state.draft.destroyedShipName,
      sentAt
    };
    group.records.forEach((record) => {
      record.status = state.settings.autoClearAfterSend ? 'sent' : 'pending';
      record.lastSentAt = sentAt;
      record.lastRecipientId = record.recipientId;
      record.lastRecipientIds = recipientIds;
      record.lastSenderId = sender.id;
    });
    await Promise.all([
      store.put('history', entry),
      store.putMany('killmails', group.records)
    ]);
    state.history.unshift(entry);
    state.selectedKillmailId = null;
    state.bundledIncidentIds.clear();
    state.draft = null;
    showToast(`Citation sent to ${entry.recipientName} and mailing list #${mailingListId} from ${entry.senderName}.`);
  } catch (error) {
    console.error(error);
    await showAlert(`Citation was not sent: ${error.message}`, { title: 'Delivery failed', tone: 'danger' });
  } finally {
    state.sending = false;
    state.sendingMode = null;
    setWorking('');
    render();
  }
}

async function sendTestCitation() {
  const killmail = selectedKillmail();
  const group = selectedKillmailGroup() || (killmail ? { records: [killmail] } : null);
  const sender = senderFor(killmail);
  const officers = officersForGroup(group);
  if (!killmail || !sender || !officers.length || state.sending) return;

  const citation = buildCitation(state.draft);
  const errors = testCitationErrors(killmail, sender, citation);
  if (errors.length) {
    await showAlert(errors[0], { title: 'Test citation not ready' });
    return;
  }
  const officerNames = formatNameList(officers.map((officer) => officer.name));
  const approved = await requestApproval(
    `Send a test copy of this citation to ${officerNames} from ${sender.name}? The combat records will remain unchanged.`,
    { title: 'Send test citation?', confirmLabel: 'Send test' }
  );
  if (!approved) return;

  state.sending = true;
  state.sendingMode = 'test';
  setWorking('Sending test citation');
  refreshCitationPreview();
  try {
    await esi.sendCitation(sender.id, officers.map((officer) => officer.id), citation.subject, citation.body);
    showToast(`Test citation sent to ${officerNames} from ${sender.name}.`);
  } catch (error) {
    console.error(error);
    await showAlert(`Test citation was not sent: ${error.message}`, { title: 'Test delivery failed', tone: 'danger' });
  } finally {
    state.sending = false;
    state.sendingMode = null;
    setWorking('');
    refreshCitationPreview();
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const senderMode = document.querySelector('input[name="sender-mode"]:checked')?.value || 'final-blow';
  const mailingListId = Number(document.getElementById('mailing-list-id-input').value);
  if (!Number.isSafeInteger(mailingListId) || mailingListId <= 0) {
    await showAlert('Enter a valid mailing list ID.', { title: 'Invalid mailing list' });
    return;
  }
  state.settings = {
    senderMode,
    specifiedSenderId: document.getElementById('specified-sender-select').value,
    mailingListId,
    autoClearAfterSend: document.getElementById('auto-clear-input').checked,
    testMode: document.getElementById('test-mode-input').checked,
    theme: document.getElementById('theme-select').value,
    layoutWidth: document.getElementById('layout-width-select').value,
    attackerRoles: { ...(state.settings.attackerRoles || {}) },
    customOffenses: availableOffenses(state.settings.customOffenses).filter((offense) => offense.custom),
    pageCount: Number(document.getElementById('page-count-select').value) || 2
  };
  await store.setSetting('settings', state.settings);
  applyAppearance();
  document.getElementById('settings-status').textContent = 'Saved on this device.';
  state.draft = null;
  render();
  showToast('Settings saved.');
}

function customOffenseId() {
  if (typeof crypto.randomUUID === 'function') return `custom-${crypto.randomUUID()}`;
  const values = crypto.getRandomValues(new Uint32Array(2));
  return `custom-${Date.now()}-${values[0].toString(16)}${values[1].toString(16)}`;
}

async function addCustomOffense() {
  const classification = document.getElementById('custom-offense-classification').value === 'Felony'
    ? 'Felony'
    : 'Misdemeanor';
  const titleInput = document.getElementById('custom-offense-title');
  const codeInput = document.getElementById('custom-offense-code');
  const title = cleanCitationText(titleInput.value);
  const code = cleanCitationText(codeInput.value);
  if (!title || !code) {
    await showAlert('Enter both an offense title and a citation code or statute.', { title: 'Incomplete custom offense' });
    (!title ? titleInput : codeInput).focus();
    return;
  }

  const duplicate = availableOffenses(state.settings.customOffenses).some((offense) => (
    offense.title.toLowerCase() === title.toLowerCase() && offense.code.toLowerCase() === code.toLowerCase()
  ));
  if (duplicate) {
    await showAlert('That offense title and citation code already exist.', { title: 'Duplicate offense' });
    return;
  }

  const offense = { id: customOffenseId(), classification, title, code };
  state.settings.customOffenses = [...(state.settings.customOffenses || []), offense];
  await store.setSetting('settings', state.settings);
  state.draft = null;
  titleInput.value = '';
  codeInput.value = '';
  renderCustomOffenses();
  showToast(`${classification} added to the citation checklist.`);
}

async function removeCustomOffense(offenseId) {
  const offense = availableOffenses(state.settings.customOffenses)
    .find((item) => item.custom && item.id === offenseId);
  if (!offense) return;
  const approved = await requestApproval(
    `Remove “${offense.title}” from this device? Existing ledger entries will not be changed.`,
    { title: 'Remove custom offense?', confirmLabel: 'Remove offense', tone: 'danger' }
  );
  if (!approved) return;

  state.settings.customOffenses = (state.settings.customOffenses || [])
    .filter((item) => item.id !== offense.id);
  await store.setSetting('settings', state.settings);
  state.draft = null;
  renderCustomOffenses();
  showToast(`${offense.classification} removed.`);
}

async function removeCharacter(characterId) {
  const character = getCharacter(characterId);
  if (!character) return;
  const approved = await requestApproval(
    `Remove ${character.name} from this browser? Citation history and killmail states will be kept.`,
    { title: 'Remove authorized character?', confirmLabel: 'Remove character', tone: 'danger' }
  );
  if (!approved) return;
  await store.delete('characters', character.id);
  state.characters = state.characters.filter((item) => item.id !== character.id);
  if (Number(state.settings.specifiedSenderId) === Number(character.id)) {
    state.settings.specifiedSenderId = state.characters[0]?.id || '';
    await store.setSetting('settings', state.settings);
  }
  const detailedKillmails = state.killmails.filter((killmail) => killmail.detail);
  await enrichKillmails(detailedKillmails);
  await store.putMany('killmails', detailedKillmails);
  state.draft = null;
  render();
  showToast(`${character.name} was removed from this browser.`);
}

async function clearPending() {
  const pending = state.killmails.filter((killmail) => killmail.status === 'pending');
  if (!pending.length) return showAlert('There are no pending killmails to clear.', { title: 'Nothing to clear' });
  const approved = await requestApproval(
    `Clear all ${pending.length} pending killmails without sending citations?`,
    { title: 'Clear every pending record?', confirmLabel: 'Clear all records', tone: 'danger' }
  );
  if (!approved) return;
  pending.forEach((killmail) => {
    killmail.status = 'cleared';
    killmail.statusChangedAt = Date.now();
  });
  await store.putMany('killmails', pending);
  state.selectedKillmailId = null;
  state.bundledIncidentIds.clear();
  state.draft = null;
  render();
  showToast(`${pending.length} pending killmails cleared.`);
}

async function eraseAllData() {
  const approved = await requestApproval(
    'Erase every authorized character, token, killmail, citation record, and setting stored by this app on this device? This cannot be undone.',
    { title: 'Erase all local data?', confirmLabel: 'Erase everything', tone: 'danger' }
  );
  if (!approved) return;
  await store.destroy();
  window.location.reload();
}

function bindEvents() {
  const modal = document.getElementById('app-modal');
  document.getElementById('app-modal-confirm').addEventListener('click', () => settleAppModal(true));
  document.getElementById('app-modal-cancel').addEventListener('click', () => settleAppModal(false));
  document.getElementById('app-modal-close').addEventListener('click', () => settleAppModal(false));
  modal.addEventListener('cancel', (event) => {
    event.preventDefault();
    settleAppModal(false);
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) settleAppModal(false);
  });

  document.addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-view-target]');
    if (viewButton) {
      const view = viewButton.dataset.viewTarget;
      if (view === 'settings' || state.characters.length || view !== 'dashboard') changeView(view);
      else changeView('dashboard');
      return;
    }

    const statusButton = event.target.closest('[data-status-filter]');
    if (statusButton) {
      state.statusFilter = statusButton.dataset.statusFilter;
      state.selectedKillmailId = null;
      state.bundledIncidentIds.clear();
      state.draft = null;
      renderDashboard();
      return;
    }

    if (event.target.closest('.killmail-select')) return;

    const row = event.target.closest('[data-killmail-id]');
    if (row) {
      await selectKillmail(row.dataset.killmailId);
      return;
    }

    const remove = event.target.closest('[data-remove-character]');
    if (remove) {
      await removeCharacter(Number(remove.dataset.removeCharacter));
      return;
    }

    const removeCustomOffenseButton = event.target.closest('[data-remove-custom-offense]');
    if (removeCustomOffenseButton) {
      await removeCustomOffense(removeCustomOffenseButton.dataset.removeCustomOffense);
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'clear-record') return setKillmailStatus('cleared');
    if (action === 'restore-record') return setKillmailStatus('pending');
    if (action === 'retry-zkill') return ensureZkillValues(selectedKillmailGroup()?.records || [selectedKillmail()].filter(Boolean), { force: true });
    if (action === 'reset-draft') {
      const killmail = selectedKillmail();
      const group = selectedKillmailGroup() || (killmail ? { primary: killmail, records: [killmail] } : null);
      if (!group) return;
      state.draft = createCitationDraft(group, senderFor(killmail));
      renderComposer();
      return;
    }
    if (action === 'copy-subject') return copyText(buildCitation(state.draft).subject, 'Citation subject copied.');
    if (action === 'copy-body') return copyText(buildCitation(state.draft).body, 'Citation HTML copied.');
    if (action === 'send-citation') return sendCitation();
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'queue-search') {
      state.search = event.target.value;
      state.selectedKillmailId = null;
      state.bundledIncidentIds.clear();
      state.draft = null;
      renderDashboard();
      return;
    }

    if (!state.draft) return;
    const field = event.target.dataset.draftField;
    const list = event.target.dataset.draftList;
    if (field) {
      state.draft[field] = cleanCitationText(event.target.value);
      refreshCitationPreview();
    }
    if (list) {
      state.draft[list] = event.target.value.split(/\r?\n/).map(cleanCitationText).filter(Boolean);
      refreshCitationPreview();
    }
  });

  document.addEventListener('change', async (event) => {
    if (event.target.matches('[data-incident-select]')) {
      await toggleBundledIncident(event.target.dataset.incidentSelect, event.target.checked);
      return;
    }
    if (event.target.id === 'attacker-type-select' && state.draft) {
      const group = selectedKillmailGroup();
      if (!group) return;
      const attackerType = event.target.value;
      setDraftAttackerType(state.draft, attackerType, group);
      if (attackerType === 'officer' || attackerType === 'deputy') {
        const finalBlow = finalBlowAttacker(group.primary);
        const characterId = Number(group.primary?.finalBlowCharacterId || finalBlow?.character_id);
        if (Number.isSafeInteger(characterId) && characterId > 0) {
          state.settings.attackerRoles = {
            ...(state.settings.attackerRoles || {}),
            [String(characterId)]: attackerType
          };
          await store.setSetting('settings', state.settings);
        }
      }
      renderComposer();
      return;
    }
    if (event.target.matches('[data-offense-id]') && state.draft) {
      state.draft.offenseIds = [...document.querySelectorAll('[data-offense-id]:checked')]
        .map((input) => input.dataset.offenseId);
      state.draft.activity = activityForOffenses(state.draft.offenseIds, state.settings.customOffenses);
      state.draft.charges = chargesForOffenses(state.draft.offenseIds, state.settings.customOffenses);
      const summary = document.getElementById('activity-summary');
      if (summary) summary.textContent = `Narrative activity: ${state.draft.activity || 'Select at least one offense'}`;
      refreshCitationPreview();
      return;
    }
    const field = event.target.dataset.draftField;
    if (field && state.draft) {
      state.draft[field] = cleanCitationText(event.target.value);
      refreshCitationPreview();
    }
    if (event.target.matches('input[name="sender-mode"]')) {
      document.getElementById('specified-sender-select').disabled = event.target.value !== 'specified';
    }
    if (event.target.id === 'test-mode-input') {
      document.getElementById('auto-clear-input').disabled = event.target.checked;
    }
    if (event.target.id === 'composer-sender') {
      const sender = getCharacter(event.target.value);
      state.settings.specifiedSenderId = sender?.id || '';
      renderComposer();
    }
  });

  document.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter' && event.target.matches('#custom-offense-title, #custom-offense-code')) {
      event.preventDefault();
      await addCustomOffense();
      return;
    }
    if (event.target.matches('input, select, textarea, button, a')) return;
    const row = event.target.closest('[data-killmail-id]');
    if (!row || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    await selectKillmail(row.dataset.killmailId);
  });

  document.getElementById('sync-button').addEventListener('click', () => syncAllCharacters());
  document.getElementById('add-character-button').addEventListener('click', () => beginLogin());
  document.getElementById('welcome-login-button').addEventListener('click', () => beginLogin());
  document.getElementById('settings-add-character-button').addEventListener('click', () => beginLogin());
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('add-custom-offense-button').addEventListener('click', addCustomOffense);
  document.getElementById('zkill-import-form').addEventListener('submit', importZkillRecord);
  document.getElementById('clear-pending-button').addEventListener('click', clearPending);
  document.getElementById('clear-all-data-button').addEventListener('click', eraseAllData);
}

async function beginLogin() {
  if (!esi.isConfigured()) {
    await showAlert('EVE SSO is not configured for this deployment.', { title: 'SSO unavailable' });
    return;
  }
  try {
    await esi.beginAuthorization();
  } catch (error) {
    await showAlert(error.message, { title: 'Authorization failed', tone: 'danger' });
  }
}

async function init() {
  bindEvents();
  await loadState();
  render();

  const params = new URLSearchParams(window.location.search);
  const authorized = params.get('authorized');
  if (authorized) {
    history.replaceState(null, '', '/');
    showToast(`${authorized} is now authorized.`);
  }

  const newestSync = state.killmails.reduce((latest, killmail) => Math.max(latest, Number(killmail.lastSeenAt || 0)), 0);
  if (state.characters.length && esi.isConfigured() && Date.now() - newestSync > 5 * 60 * 1000) {
    syncAllCharacters({ quiet: true }).catch((error) => {
      console.error(error);
      showAlert(`Automatic intake failed: ${error.message}`, { title: 'Automatic intake failed', tone: 'danger' });
    });
  }
}

init().catch((error) => {
  console.error(error);
  setWorking('');
  showAlert(`The citation desk could not start: ${error.message}`, { title: 'Startup failed', tone: 'danger' });
});
