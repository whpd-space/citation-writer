import { WHPDStore } from './db.js';
import { ESIClient, parseZkillKillmailId } from './esi.js';
import { backupCounts, createBackup, parseBackup } from './backup.js';
import {
  activityForOffenses,
  applyCitationTemplate,
  availableOffenses,
  buildCitation,
  citationTemplateUsesOffenses,
  citationTemplates,
  chargesForOffenses,
  cleanCitationText,
  DEFAULT_CITATION_TEMPLATE_ID,
  findCitationTemplate,
  formatIsk,
  formatShipTypeCounts,
  isProtectedCitationTemplateId,
  makeCitationDraft,
  makeManualCitationDraft,
  normalizeCitationTemplate,
  sortOffensesAlphabetically,
  validateCitation
} from './citation.js';
import { formatRelativeTime, formatUtcDateTime, isoUtcDateTime } from './time.js';
import { attackerRoleForFinalBlow, citationDeliveryRecipientIds, classifyKillmail, combineKillmailGroups, countDistinctAttackingPilots, distinctAttackingPilotIds, groupKillmails, isPodKillmail, selectInvolvedOfficer } from './killmail-groups.js';

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
  citationTemplateId: DEFAULT_CITATION_TEMPLATE_ID,
  citationTemplates: [],
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
  manualCitation: null,
  draft: null,
  syncing: false,
  importingZkill: false,
  sending: false,
  sendingMode: null,
  zkbLoadingIds: new Set(),
  toastTimer: null,
  modalResolve: null,
  editingTemplateId: null,
  templateEditorDraft: null
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
  if (state.manualCitation) return state.manualCitation;
  return state.killmails.find((killmail) => Number(killmail.id) === Number(state.selectedKillmailId)) || null;
}

function selectedKillmailGroup() {
  if (state.manualCitation) {
    return { id: 'manual', primary: state.manualCitation, pod: null, records: [state.manualCitation], incidentCount: 1 };
  }
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
  if (group?.primary?.manualCitation) {
    if (normalizedType === 'fleet' || normalizedType === 'memefleet') {
      draft.officerName = normalizedType === 'memefleet' ? 'Memefleet Participants' : 'Fleet Participants';
    } else if (!cleanCitationText(draft.officerName) || /fleet participants$/i.test(draft.officerName)) {
      draft.officerName = groupedKillmail.enriched?.officerName || senderFor(group.primary)?.name || '';
    }
    return draft;
  }
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
  const template = findCitationTemplate(state.settings.citationTemplates, state.settings.citationTemplateId);
  return makeCitationDraft(groupedKillmail, sender, undefined, Math.random, template);
}

function createManualCitationDraft(sender) {
  const template = findCitationTemplate(state.settings.citationTemplates, state.settings.citationTemplateId);
  return makeManualCitationDraft(sender, [], Math.random, state.settings.customOffenses, template);
}

function generatedSubjectForDraft(draft) {
  const generated = { ...draft };
  delete generated.subject;
  delete generated.subjectOverride;
  return buildCitation(generated).subject;
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

function isFleetAttackerType(attackerType) {
  return attackerType === 'fleet' || attackerType === 'memefleet';
}

function deliveryRecipientIdsForGroup(group, attackerType) {
  return citationDeliveryRecipientIds(
    group?.records,
    recipientsForGroup(group).map((recipient) => recipient.id),
    attackerType
  );
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
  if (killmail?.manualCitation) {
    return getCharacter(killmail.senderId)
      || (state.settings.senderMode === 'specified' ? getCharacter(state.settings.specifiedSenderId) : null)
      || state.characters[0]
      || null;
  }
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

function recipientNameForGroup(group, characterId) {
  const id = Number(characterId);
  const citedRecipient = recipientsForGroup(group).find((recipient) => recipient.id === id);
  if (citedRecipient) return citedRecipient.name;

  for (const record of group?.records || []) {
    const attackerName = record.enriched?.attackerNames?.[String(id)];
    if (attackerName) return attackerName;
  }

  return officersForGroup(group).find((officer) => officer.id === id)?.name
    || getCharacter(id)?.name
    || `Character ${id}`;
}

function citationRecipientsForComposer(group, killmail, sender, attackerType) {
  const manual = Boolean(killmail?.manualCitation);
  const citedIds = new Set(recipientsForGroup(group).map((recipient) => recipient.id));
  const fleetIds = new Set(isFleetAttackerType(attackerType) && !manual
    ? distinctAttackingPilotIds(group?.records)
    : []);
  let characterIds;

  if (state.settings.testMode) {
    characterIds = manual
      ? [Number(sender?.id)].filter((id) => Number.isSafeInteger(id) && id > 0)
      : (isFleetAttackerType(attackerType)
          ? [...fleetIds]
          : officersForGroup(group).map((officer) => officer.id));
  } else {
    characterIds = deliveryRecipientIdsForGroup(group, attackerType);
  }

  return {
    testMode: state.settings.testMode,
    characters: characterIds.map((id) => ({
      id,
      name: recipientNameForGroup(group, id),
      role: state.settings.testMode
        ? 'Test recipient'
        : (citedIds.has(id) ? 'Cited pilot' : (fleetIds.has(id) ? 'Fleet copy' : 'Recipient'))
    })),
    mailingListId: state.settings.testMode ? null : Number(state.settings.mailingListId)
  };
}

function renderCitationRecipients(group, killmail, sender, attackerType) {
  const recipients = citationRecipientsForComposer(group, killmail, sender, attackerType);
  const characterRecipients = recipients.characters.length
    ? recipients.characters.map((recipient) => `
        <div class="citation-recipient">
          <strong>${h(recipient.name)}</strong>
          <small>${h(recipient.role)} · Character #${recipient.id}</small>
        </div>
      `).join('')
    : '<div class="citation-recipient is-missing"><strong>No character recipient available</strong><small>Resolve the recipient requirements before sending.</small></div>';
  const hasMailingList = Number.isSafeInteger(recipients.mailingListId) && recipients.mailingListId > 0;
  const mailingListRecipient = recipients.testMode
    ? ''
    : `<div class="citation-recipient ${hasMailingList ? '' : 'is-missing'}">
        <strong>${hasMailingList ? `Mailing list #${recipients.mailingListId}` : 'Mailing list not configured'}</strong>
        <small>${hasMailingList ? 'Live citation copy' : 'A valid mailing list is required before sending.'}</small>
      </div>`;

  return `
    <section class="citation-recipients-field" aria-labelledby="citation-recipients-label">
      <div class="citation-recipients-heading">
        <span id="citation-recipients-label">EVE Mail recipients</span>
        <strong>${recipients.testMode ? 'TEST delivery' : 'Live delivery'}</strong>
      </div>
      <div class="citation-recipient-list">${characterRecipients}${mailingListRecipient}</div>
      <small class="citation-recipients-help">${recipients.testMode
        ? 'Only the test recipients shown here will receive this citation.'
        : 'Every character and mailing list shown here will receive this citation.'}</small>
    </section>
  `;
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
    customOffenses: availableOffenses(settings?.customOffenses).filter((offense) => offense.custom),
    citationTemplates: citationTemplates(settings?.citationTemplates)
  };
  state.settings.citationTemplateId = findCitationTemplate(
    state.settings.citationTemplates,
    settings?.citationTemplateId
  ).id;
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
  state.currentView = ['dashboard', 'history', 'templates', 'settings'].includes(view) ? view : 'dashboard';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  renderNavigation();
  renderVisibleView();
  renderDashboard();
  renderHistory();
  renderCitationTemplates();
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
  document.getElementById('templates-view').hidden = state.currentView !== 'templates';
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
  if (group && !group.primary?.manualCitation && hasDueAppraisal) {
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
    if (!state.manualCitation && (!selectedKillmail() || selectedKillmail()?.status !== state.statusFilter)) {
      state.selectedKillmailId = null;
      state.draft = null;
    }
    return;
  }

  if (!state.manualCitation) {
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
  state.manualCitation = null;
  state.bundledIncidentIds.clear();
  state.selectedKillmailId = Number(killmailId);
  state.draft = null;
  renderKillmailList();
  renderComposer();

  await ensureZkillValues(selectedKillmailGroup()?.records || [], { force: true });
}

function beginManualCitation() {
  const sender = (state.settings.senderMode === 'specified' && getCharacter(state.settings.specifiedSenderId))
    || state.characters[0]
    || null;
  state.selectedKillmailId = null;
  state.bundledIncidentIds.clear();
  state.manualCitation = {
    manualCitation: true,
    id: null,
    recipientId: null,
    senderId: sender?.id || null,
    status: 'pending',
    actionable: true,
    direction: 'action',
    finalBlowCharacterId: sender?.id || null,
    officerCharacterId: sender?.id || null,
    detail: { victim: {} },
    enriched: {
      victimName: '',
      victimCorporationName: '',
      victimAllianceName: '',
      victimShipName: '',
      systemName: '',
      officerName: sender?.name || '',
      officerShipName: ''
    }
  };
  state.draft = createManualCitationDraft(sender);
  renderKillmailList();
  renderComposer();
  queueMicrotask(() => document.querySelector('[data-draft-field="pilotName"]')?.focus());
}

async function toggleBundledIncident(groupId, checked) {
  state.manualCitation = null;
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
    const totalValue = await esi.zkillValue(killmailId, killmail.hash);
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
  const manual = Boolean(killmail.manualCitation);
  const victim = killmail.detail?.victim || {};
  const sender = senderFor(killmail);
  if (manual && !state.draft) state.draft = createManualCitationDraft(sender);
  const groupedKillmail = citationKillmail(group);
  const victimName = manual
    ? (state.draft.pilotName || 'New manual citation')
    : (groupedKillmail.enriched?.victimName || 'Unknown pilot');
  const groupOfficers = manual ? [sender].filter(Boolean) : officersForGroup(group);
  const groupKey = group.records.map((record) => Number(record.id)).join(':');
  const draftKey = (state.draft?.sourceKillmailIds || []).map(Number).join(':');
  if (!manual && (!state.draft || draftKey !== groupKey)) state.draft = createCitationDraft(group, sender);
  const attackerType = state.draft.attackerType || 'officer';
  const isFleetAttacker = isFleetAttackerType(attackerType);
  const officerNames = formatNameList(groupOfficers.map((officer) => officer.name), 'the involved officer');
  const testRecipientSummary = isFleetAttacker && !manual
    ? `${distinctAttackingPilotIds(group.records).length} involved ${attackerType === 'memefleet' ? 'memefleet' : 'fleet'} participants`
    : officerNames;

  const statusAction = manual
    ? '<button type="button" class="button button-secondary button-small" data-action="cancel-manual-citation">Cancel</button>'
    : (killmail.status === 'pending'
    ? '<button type="button" class="button button-secondary button-small" data-action="clear-record">Clear</button>'
    : '<button type="button" class="button button-secondary button-small" data-action="restore-record">Restore to pending</button>');
  const appraisalLoading = !manual && group.records.some((record) => state.zkbLoadingIds.has(Number(record.id)));
  const totalValue = groupTotalValue(group);
  const appraisalAction = !manual && !totalValue
    ? `<button type="button" class="button button-ghost button-small" data-action="retry-zkill" ${appraisalLoading ? 'disabled' : ''}>${appraisalLoading ? 'Appraising…' : 'Get value'}</button>`
    : '';
  const appraisalValue = formatIsk(totalValue)
    || (appraisalLoading ? 'Loading from zKillboard…' : 'Unavailable · manual entry allowed');
  const incidentCount = Number(group.incidentCount) || 1;
  const bundleSummary = incidentCount > 1 ? `${incidentCount} incidents · ${group.records.length} combat records · ` : '';
  const combatRecordLinks = manual ? '' : group.records.map((record) => {
    const label = isPodKillmail(record) ? `Pod killmail #${record.id}` : `Killmail #${record.id}`;
    return `<a href="https://zkillboard.com/kill/${record.id}/" target="_blank" rel="noopener noreferrer">${h(label)}</a>`;
  }).join(' + ');

  const manualRecipientId = Number(killmail.recipientId);
  const hasManualRecipient = Number.isSafeInteger(manualRecipientId) && manualRecipientId > 0;
  const manualFields = manual ? `
    <div class="manual-citation-fields">
      <div class="manual-recipient-field">
        <label class="composer-field">
          <span>Recipient pilot</span>
          <input data-draft-field="pilotName" value="${h(state.draft.pilotName)}" placeholder="Exact EVE character name" autocomplete="off">
        </label>
        <button id="resolve-manual-recipient" type="button" class="button ${hasManualRecipient ? 'button-secondary' : 'button-primary'}" data-action="resolve-manual-recipient" ${killmail.resolvingRecipient ? 'disabled' : ''}>${killmail.resolvingRecipient ? 'Finding…' : (hasManualRecipient ? 'Verified' : 'Find pilot')}</button>
      </div>
      <p id="manual-recipient-status" class="manual-recipient-status ${hasManualRecipient ? 'is-verified' : ''}">${hasManualRecipient ? `EVE Mail recipient verified as ${h(killmail.resolvedName || state.draft.pilotName)} · Character #${manualRecipientId}` : 'Find the exact character before sending.'}</p>
      <div class="field-grid">
        <label class="composer-field">
          <span>Corporation</span>
          <input data-draft-field="corporationName" value="${h(state.draft.corporationName)}" placeholder="Pilot corporation">
        </label>
        <label class="composer-field">
          <span>Alliance · optional</span>
          <input data-draft-field="allianceName" value="${h(state.draft.allianceName)}" placeholder="Pilot alliance">
        </label>
        <label class="composer-field">
          <span>System</span>
          <input data-draft-field="systemName" value="${h(state.draft.systemName)}" placeholder="J123456">
        </label>
        <label class="composer-field">
          <span>Destroyed ship</span>
          <input data-draft-field="destroyedShipName" value="${h(state.draft.destroyedShipName)}" placeholder="Venture">
        </label>
      </div>
    </div>
  ` : '';

  const senderOptions = state.characters.map((character) => `
    <option value="${character.id}" ${Number(character.id) === Number(sender?.id) ? 'selected' : ''}>${h(character.name)}</option>
  `).join('');
  const availableTemplates = citationTemplates(state.settings.citationTemplates);
  const draftTemplateExists = availableTemplates.some((template) => template.id === state.draft.templateId);
  const templateOptions = `${draftTemplateExists ? '' : '<option value="" selected>Current draft · template unavailable</option>'}${availableTemplates.map((template) => `
    <option value="${h(template.id)}" ${template.id === state.draft.templateId ? 'selected' : ''}>${h(template.name)}</option>
  `).join('')}`;
  const draftTemplate = state.draft.citationTemplate || findCitationTemplate(availableTemplates, state.draft.templateId);
  const templateSource = `${draftTemplate.subject}\n${draftTemplate.sections.map((section) => section.body).join('\n')}`;
  const usesOffenseSelection = citationTemplateUsesOffenses(draftTemplate);
  const usesNarrativeActivity = /\{\{\s*(?:openingNarrative|activity)\s*\}\}/.test(templateSource);
  const usesShortTitle = /\{\{\s*title\s*\}\}/.test(draftTemplate.subject);
  const templateSectionEditors = draftTemplate.sections
    .filter((section) => section.editor !== 'none')
    .map((section) => `
      <label class="composer-field">
        <span>${h(section.name)}${section.optional ? ' · optional' : ''}${section.editor === 'list' ? ' · one bullet per line' : ''}</span>
        <textarea data-draft-section-id="${h(section.id)}" data-draft-section-editor="${h(section.editor)}" ${section.optional ? 'placeholder="Leave blank to omit this section"' : ''}>${h(state.draft.sectionValues?.[section.id] || '')}</textarea>
      </label>
    `).join('');
  const shortTitleField = usesShortTitle ? `
    <label class="composer-field">
      <span>Short title</span>
      <input data-draft-field="title" value="${h(state.draft.title)}" maxlength="132">
    </label>
  ` : '';
  const offenseSelection = usesOffenseSelection ? `
    <div class="composer-field legal-activity-field">
      <span>Charges${usesNarrativeActivity ? ' & activity' : ''} · select offenses from the <a href="https://whpd.space/LegalLibrary.html" target="_blank" rel="noopener noreferrer">Legal Library</a></span>
      <div class="legal-checklist">
        ${renderOffenseCheckboxes(state.draft.offenseIds)}
      </div>
      ${usesNarrativeActivity ? `<p id="activity-summary" class="activity-summary">Narrative activity: ${h(state.draft.activity || 'Select at least one offense')}</p>` : ''}
    </div>
  ` : '';

  root.innerHTML = `
    <div class="composer-header">
      <img src="${manual ? (hasManualRecipient ? characterPortrait(manualRecipientId, 64) : 'https://whpd.space/images/whpd.png') : (victim.character_id ? characterPortrait(victim.character_id, 64) : typeIcon(victim.ship_type_id, 64))}" alt="">
      <div>
        <h2>${h(victimName)}</h2>
        <p>${manual ? 'Manual citation · no combat record attached' : `${h(groupedKillmail.enriched?.victimCorporationName || 'Unknown corporation')} · ${h(bundleSummary)}${combatRecordLinks} · ${utcTimeElement(killmail.killmailTime)}`}</p>
      </div>
      <div class="composer-header-actions">
        ${appraisalAction}
        ${statusAction}
      </div>
    </div>
    ${manual ? '<div class="manual-mode-notice"><strong>Manual citation</strong><span>Enter the incident details below. A killmail and zKillboard evidence link are not required.</span></div>' : `<div class="record-facts">
      ${recordFact(group.records.length > 1 ? 'Systems' : 'System', groupedKillmail.enriched?.systemName || 'Unknown')}
      ${recordFact(group.records.length > 1 ? 'Destroyed ships' : 'Destroyed ship', groupedKillmail.enriched?.victimShipName || 'Unknown')}
      ${recordFact(
        isFleetAttacker ? 'Citation attackers' : (attackerType === 'deputy' ? 'Citation deputy' : (groupOfficers.length > 1 ? 'Citation officers' : 'Citation officer')),
        state.draft.officerName || 'Unknown'
      )}
      ${recordFact(group.records.every((record) => record.valueSource === 'zkillboard') ? 'zKill appraisal' : 'Total value', appraisalValue)}
    </div>`}
    ${state.settings.testMode ? `<div class="test-mode-notice"><strong>TEST mode</strong><span>The citation will be sent only to ${h(testRecipientSummary)}. The mailing list and any cited pilots outside that group will not receive it; the incident status and delivery ledger will remain unchanged.</span></div>` : ''}
    <div class="composer-form">
      <div class="citation-fields">
        ${manualFields}
        <label class="composer-field citation-template-picker">
          <span>Citation template</span>
          <select id="citation-template-select">${templateOptions}</select>
          <small>Applies the template and rebuilds the section-specific composer boxes below.</small>
        </label>
        <label class="composer-field citation-subject-field">
          <span>EVE Mail subject</span>
          <input data-draft-field="subject" value="${h(state.draft.subject || '')}" maxlength="132" required>
          <small>Required. Initially generated by the selected template and editable for this citation.</small>
        </label>
        ${renderCitationRecipients(group, killmail, sender, attackerType)}
        <div class="field-grid">
          <label class="composer-field">
            <span>EVE Mail sender</span>
            <select id="composer-sender" ${!manual && state.settings.senderMode === 'final-blow' ? 'disabled' : ''}>${senderOptions}</select>
          </label>
          ${shortTitleField}
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
            <input data-draft-field="officerName" value="${h(state.draft.officerName)}" ${isFleetAttacker && !manual ? 'readonly' : ''}>
          </label>
        </div>
        ${offenseSelection}
        ${templateSectionEditors}
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
  if (killmail?.manualCitation) {
    if (!sender) return '<p class="sender-warning">Choose an authorized EVE Mail sender before sending.</p>';
    if (state.settings.testMode) return '';
    if (!Number.isSafeInteger(Number(killmail.recipientId)) || Number(killmail.recipientId) <= 0) {
      return '<p class="sender-warning">Find and verify the recipient pilot before sending.</p>';
    }
    return '';
  }
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
  if (killmail?.manualCitation) {
    const recipientId = Number(killmail.recipientId);
    if (!Number.isSafeInteger(recipientId) || recipientId <= 0) errors.push('Find and verify the recipient pilot before sending.');
  } else {
    if (records.some((record) => !record.detail?.victim?.character_id)) errors.push('Every bundled killmail must have a capsuleer recipient.');
    if (records.some((record) => !record.actionable)) errors.push('Every bundled killmail must be an outbound WHPD enforcement action.');
    if (records.some((record) => record.status !== 'pending')) errors.push('Restore every bundled record to pending before sending it again.');
  }
  if (!sender) errors.push('An authorized EVE Mail sender is required.');
  if (!Number.isSafeInteger(mailingListId) || mailingListId <= 0) errors.push('A valid mailing list ID is required for live delivery.');
  if (citation.subject.length > 150) errors.push('The EVE Mail subject exceeds 150 characters.');
  if (citation.body.length > 8000) errors.push('The EVE Mail body exceeds 8,000 characters.');
  return errors;
}

function testCitationErrors(killmail, sender, citation) {
  const errors = validateCitation(state.draft);
  const group = selectedKillmailGroup() || { records: [killmail] };
  if (!sender) errors.push('An authorized EVE Mail sender is required.');
  if (!killmail?.manualCitation && isFleetAttackerType(state.draft?.attackerType)) {
    if (!distinctAttackingPilotIds(group.records).length) {
      errors.push('The bundled records do not identify an involved capsuleer fleet participant.');
    }
  } else if (!killmail?.manualCitation && !officersForGroup(group).length) {
    errors.push('The bundled records do not identify an involved capsuleer officer.');
  }
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
  const fleetTest = !killmail.manualCitation && isFleetAttackerType(state.draft?.attackerType);
  const testRecipientCount = fleetTest
    ? distinctAttackingPilotIds((selectedKillmailGroup() || { records: [killmail] }).records).length
    : (killmail.manualCitation
    ? (sender ? 1 : 0)
    : officersForGroup(selectedKillmailGroup() || { records: [killmail] }).length);
  sendButton.disabled = errors.length > 0 || state.sending;
  sendButton.textContent = state.sendingMode === 'test'
    ? 'Sending TEST…'
    : (state.sendingMode === 'citation' ? 'Sending…' : (state.settings.testMode
        ? `Send TEST to ${fleetTest ? `${testRecipientCount} participants` : (testRecipientCount === 1 ? 'officer' : 'officers')}`
        : 'Send citation'));
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
            <td>${entry.manual || !(entry.killmailIds || [entry.killmailId]).filter(Boolean).length
              ? '<span class="badge badge-npc">Manual</span>'
              : (entry.killmailIds || [entry.killmailId]).filter(Boolean).map((killmailId) => `<a href="https://zkillboard.com/kill/${killmailId}/" target="_blank" rel="noopener noreferrer">#${killmailId}</a>`).join(' + ')}</td>
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

function renderCitationTemplates() {
  const root = document.getElementById('citation-template-list');
  const editor = document.getElementById('citation-template-editor');
  if (!root || !editor) return;
  const templates = citationTemplates(state.settings.citationTemplates);
  root.innerHTML = templates.map((template) => {
    const isDefault = template.id === DEFAULT_CITATION_TEMPLATE_ID;
    const isProtected = isProtectedCitationTemplateId(template.id);
    const badgeLabel = isDefault ? 'Default' : (isProtected ? 'Built-in' : 'Custom');
    const editableCount = template.sections.filter((section) => section.editor !== 'none').length;
    return `
      <div class="citation-template-row">
        <span class="citation-template-badge ${isDefault ? 'is-standard' : (isProtected ? 'is-built-in' : '')}">${badgeLabel}</span>
        <span class="citation-template-copy">
          <strong>${h(template.name)}</strong>
          <small>${template.sections.length} sections · ${editableCount} composer ${editableCount === 1 ? 'box' : 'boxes'}${isProtected ? ' · cannot be removed' : ''}</small>
        </span>
        <span class="citation-template-actions">
          <button type="button" class="button button-ghost button-small" data-edit-citation-template="${h(template.id)}">Edit</button>
          ${isProtected ? '' : `<button type="button" class="button button-ghost button-small" data-remove-citation-template="${h(template.id)}">Remove</button>`}
        </span>
      </div>
    `;
  }).join('');

  const editingId = state.editingTemplateId;
  editor.hidden = !editingId;
  if (!editingId) return;
  const isNew = editingId === 'new';
  const template = state.templateEditorDraft;
  if (!template) return;
  document.getElementById('citation-template-editor-title').textContent = isNew ? 'New template' : `Edit ${template.name}`;
  document.getElementById('citation-template-name').value = template.name;
  document.getElementById('citation-template-subject').value = template.subject;
  document.getElementById('citation-template-section-list').innerHTML = template.sections.map((section, index) => `
    <article class="template-section-card" data-template-section-id="${h(section.id)}">
      <div class="template-section-card-heading">
        <span class="template-section-order">${index + 1}</span>
        <strong>${h(section.name || 'Untitled section')}</strong>
        <span class="template-section-actions">
          <button type="button" class="button button-ghost button-small" data-template-section-action="up" data-template-section-id="${h(section.id)}" ${index === 0 ? 'disabled' : ''} aria-label="Move ${h(section.name || 'section')} up">↑</button>
          <button type="button" class="button button-ghost button-small" data-template-section-action="down" data-template-section-id="${h(section.id)}" ${index === template.sections.length - 1 ? 'disabled' : ''} aria-label="Move ${h(section.name || 'section')} down">↓</button>
          <button type="button" class="button button-ghost button-small" data-template-section-action="remove" data-template-section-id="${h(section.id)}">Remove</button>
        </span>
      </div>
      <div class="template-section-grid">
        <label class="field">
          <span>Section name</span>
          <input data-template-section-field="name" data-template-section-id="${h(section.id)}" maxlength="100" value="${h(section.name)}">
        </label>
        <label class="field">
          <span>Composer editor</span>
          <select data-template-section-field="editor" data-template-section-id="${h(section.id)}">
            <option value="none" ${section.editor === 'none' ? 'selected' : ''}>None · fixed section</option>
            <option value="text" ${section.editor === 'text' ? 'selected' : ''}>Paragraph</option>
            <option value="list" ${section.editor === 'list' ? 'selected' : ''}>One bullet per line</option>
          </select>
        </label>
        <label class="field template-section-body-field">
          <span>Section layout / EVE HTML</span>
          <textarea data-template-section-field="body" data-template-section-id="${h(section.id)}" maxlength="12000">${h(section.body)}</textarea>
        </label>
        <label class="field template-section-default-field ${section.editor === 'none' ? 'is-disabled' : ''}">
          <span>Default editable value</span>
          <textarea data-template-section-field="defaultValue" data-template-section-id="${h(section.id)}" maxlength="4000" ${section.editor === 'none' ? 'disabled' : ''}>${h(section.defaultValue)}</textarea>
        </label>
      </div>
      <label class="toggle-row template-section-optional ${section.editor === 'none' ? 'is-disabled' : ''}">
        <input type="checkbox" data-template-section-field="optional" data-template-section-id="${h(section.id)}" ${section.optional ? 'checked' : ''} ${section.editor === 'none' ? 'disabled' : ''}>
        <span><strong>Optional section</strong><small>Omit this entire section when its composer box is blank.</small></span>
      </label>
    </article>
  `).join('');
  document.getElementById('save-citation-template-button').textContent = isNew ? 'Create template' : 'Save changes';
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
    state.manualCitation = null;
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
    state.manualCitation = null;
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
    const attackerNames = {};
    managedAttackers.forEach((attacker) => {
      if (attacker.character_id) senderShips[String(attacker.character_id)] = names.get(Number(attacker.ship_type_id)) || 'WHPD patrol vessel';
    });
    attackers.forEach((attacker) => {
      const characterId = Number(attacker.character_id);
      if (Number.isSafeInteger(characterId) && characterId > 0) {
        attackerNames[String(characterId)] = names.get(characterId) || `Character ${characterId}`;
      }
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
      senderShips,
      attackerNames
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

function clearResolvedManualRecipient() {
  if (!state.manualCitation) return;
  state.manualCitation.recipientId = null;
  state.manualCitation.resolvedName = '';
  state.manualCitation.detail.victim.character_id = null;
  const status = document.getElementById('manual-recipient-status');
  if (status) {
    status.classList.remove('is-verified');
    status.textContent = 'Find the exact character before sending.';
  }
  const button = document.getElementById('resolve-manual-recipient');
  if (button) {
    button.className = 'button button-primary';
    button.textContent = 'Find pilot';
  }
}

async function resolveManualRecipient() {
  const manual = state.manualCitation;
  if (!manual || manual.resolvingRecipient) return;
  const pilotName = cleanCitationText(state.draft?.pilotName);
  if (!pilotName) {
    await showAlert('Enter the recipient pilot’s exact EVE character name.', { title: 'Recipient required' });
    document.querySelector('[data-draft-field="pilotName"]')?.focus();
    return;
  }

  manual.resolvingRecipient = true;
  setWorking('Finding EVE character');
  renderComposer();
  try {
    const character = await esi.characterByName(pilotName);
    if (state.manualCitation !== manual || !state.draft
      || cleanCitationText(state.draft.pilotName).toLowerCase() !== pilotName.toLowerCase()) return;
    manual.recipientId = character.id;
    manual.resolvedName = character.name;
    manual.detail.victim.character_id = character.id;
    manual.enriched.victimName = character.name;
    manual.enriched.victimCorporationName = character.corporationName;
    manual.enriched.victimAllianceName = character.allianceName;
    const priorGeneratedSubject = generatedSubjectForDraft(state.draft);
    const shouldRefreshSubject = state.draft.subject === priorGeneratedSubject;
    state.draft.pilotName = character.name;
    state.draft.corporationName = character.corporationName || state.draft.corporationName;
    state.draft.allianceName = character.allianceName || state.draft.allianceName;
    if (shouldRefreshSubject) state.draft.subject = generatedSubjectForDraft(state.draft);
    showToast(`${character.name} verified as the EVE Mail recipient.`);
  } catch (error) {
    if (state.manualCitation !== manual) return;
    clearResolvedManualRecipient();
    await showAlert(error.message, { title: 'Pilot not found', tone: 'danger' });
  } finally {
    manual.resolvingRecipient = false;
    if (state.manualCitation === manual) {
      setWorking('');
      renderComposer();
    } else if (!state.manualCitation?.resolvingRecipient) {
      setWorking('');
    }
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
  const deliveryRecipientIds = deliveryRecipientIdsForGroup(group, state.draft.attackerType);
  const citedRecipientIds = new Set(recipientIds);
  const copyRecipientIds = deliveryRecipientIds.filter((recipientId) => !citedRecipientIds.has(recipientId));
  const manual = Boolean(killmail.manualCitation);
  const recordCopy = !manual && group.records.length > 1 ? ` covering ${group.records.length} combat records` : '';
  const fleetLabel = state.draft.attackerType === 'memefleet' ? 'memefleet' : 'fleet';
  const copyDestination = copyRecipientIds.length
    ? `, ${copyRecipientIds.length} involved ${fleetLabel} ${copyRecipientIds.length === 1 ? 'participant' : 'participants'},`
    : '';
  const approved = await requestApproval(
    `Send this citation${recordCopy} to ${state.draft.pilotName}${copyDestination} and mailing list #${mailingListId} from ${sender.name}?`,
    { title: 'Send citation?', confirmLabel: 'Send citation' }
  );
  if (!approved) return;

  state.sending = true;
  state.sendingMode = 'citation';
  setWorking('Sending citation');
  refreshCitationPreview();
  try {
    const mailIds = await esi.sendCitationCopies(sender.id, deliveryRecipientIds, citation.subject, citation.body, { mailingListId });
    const sentAt = Date.now();
    const entry = {
      id: manual ? `manual:${recipientIds[0]}:${sentAt}` : `${killmail.id}:${sentAt}`,
      killmailId: manual ? null : killmail.id,
      killmailIds: manual ? [] : group.records.map((record) => record.id),
      manual,
      mailId: Number(mailIds[0]) || null,
      mailIds: mailIds.map(Number).filter(Number.isFinite),
      recipientId: recipientIds[0],
      recipientIds,
      copyRecipientIds,
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
    if (!manual) {
      group.records.forEach((record) => {
        record.status = state.settings.autoClearAfterSend ? 'sent' : 'pending';
        record.lastSentAt = sentAt;
        record.lastRecipientId = record.recipientId;
        record.lastRecipientIds = recipientIds;
        record.lastCopyRecipientIds = copyRecipientIds;
        record.lastSenderId = sender.id;
      });
    }
    await Promise.all([
      store.put('history', entry),
      ...(manual ? [] : [store.putMany('killmails', group.records)])
    ]);
    state.history.unshift(entry);
    state.manualCitation = null;
    state.selectedKillmailId = null;
    state.bundledIncidentIds.clear();
    state.draft = null;
    showToast(`Citation sent to ${entry.recipientName}${copyDestination} and mailing list #${mailingListId} from ${entry.senderName}.`);
  } catch (error) {
    console.error(error);
    await showAlert(`Citation delivery failed: ${error.message}`, { title: 'Delivery failed', tone: 'danger' });
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
  const officers = killmail?.manualCitation ? [sender].filter(Boolean) : officersForGroup(group);
  const fleetTest = !killmail?.manualCitation && isFleetAttackerType(state.draft?.attackerType);
  const recipientIds = fleetTest
    ? distinctAttackingPilotIds(group?.records)
    : officers.map((officer) => officer.id);
  if (!killmail || !sender || !recipientIds.length || state.sending) return;

  const citation = buildCitation(state.draft);
  const errors = testCitationErrors(killmail, sender, citation);
  if (errors.length) {
    await showAlert(errors[0], { title: 'Test citation not ready' });
    return;
  }
  const recipientDescription = fleetTest
    ? `${recipientIds.length} involved ${state.draft.attackerType === 'memefleet' ? 'memefleet' : 'fleet'} participants`
    : formatNameList(officers.map((officer) => officer.name));
  const approved = await requestApproval(
    `Send a test copy of this citation to ${recipientDescription} from ${sender.name}? The combat records will remain unchanged.`,
    { title: 'Send test citation?', confirmLabel: 'Send test' }
  );
  if (!approved) return;

  state.sending = true;
  state.sendingMode = 'test';
  setWorking('Sending test citation');
  refreshCitationPreview();
  try {
    await esi.sendCitationCopies(sender.id, recipientIds, citation.subject, citation.body);
    showToast(`Test citation sent to ${recipientDescription} from ${sender.name}.`);
  } catch (error) {
    console.error(error);
    await showAlert(`Test citation delivery failed: ${error.message}`, { title: 'Test delivery failed', tone: 'danger' });
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
    citationTemplateId: findCitationTemplate(
      state.settings.citationTemplates,
      state.settings.citationTemplateId
    ).id,
    citationTemplates: citationTemplates(state.settings.citationTemplates),
    pageCount: Number(document.getElementById('page-count-select').value) || 2
  };
  await store.setSetting('settings', state.settings);
  applyAppearance();
  document.getElementById('settings-status').textContent = 'Saved on this device.';
  state.manualCitation = null;
  state.draft = null;
  render();
  showToast('Settings saved.');
}

function citationTemplateId() {
  if (typeof crypto.randomUUID === 'function') return `template-${crypto.randomUUID()}`;
  const values = crypto.getRandomValues(new Uint32Array(2));
  return `template-${Date.now()}-${values[0].toString(16)}${values[1].toString(16)}`;
}

function citationTemplateSectionId() {
  if (typeof crypto.randomUUID === 'function') return `section-${crypto.randomUUID()}`;
  const values = crypto.getRandomValues(new Uint32Array(2));
  return `section-${Date.now()}-${values[0].toString(16)}${values[1].toString(16)}`;
}

function beginCitationTemplate(templateId = 'new') {
  const existing = templateId === 'new'
    ? null
    : citationTemplates(state.settings.citationTemplates).find((template) => template.id === templateId);
  if (templateId !== 'new' && !existing) return;
  state.editingTemplateId = templateId;
  state.templateEditorDraft = existing
    ? { ...existing, sections: existing.sections.map((section) => ({ ...section })) }
    : {
      id: 'new',
      name: '',
      subject: 'Citation Issued: {{title}}',
      sections: [{
        id: citationTemplateSectionId(),
        name: 'New section',
        body: '{{contentWhite}}',
        editor: 'text',
        defaultValue: '',
        optional: false
      }]
    };
  renderCitationTemplates();
  document.getElementById('citation-template-name')?.focus();
}

function addCitationTemplateSection() {
  if (!state.templateEditorDraft) return;
  state.templateEditorDraft.sections.push({
    id: citationTemplateSectionId(),
    name: 'New section',
    body: '{{contentWhite}}',
    editor: 'text',
    defaultValue: '',
    optional: false
  });
  renderCitationTemplates();
}

async function updateCitationTemplateSection(sectionId, action) {
  const sections = state.templateEditorDraft?.sections;
  if (!sections) return;
  const index = sections.findIndex((section) => section.id === sectionId);
  if (index === -1) return;
  if (action === 'remove') {
    if (sections.length === 1) {
      await showAlert('A citation template must contain at least one section.', { title: 'Section required' });
      return;
    }
    sections.splice(index, 1);
  } else if (action === 'up' && index > 0) {
    [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
  } else if (action === 'down' && index < sections.length - 1) {
    [sections[index + 1], sections[index]] = [sections[index], sections[index + 1]];
  }
  renderCitationTemplates();
}

async function saveCitationTemplate() {
  const editingId = state.editingTemplateId;
  const editorDraft = state.templateEditorDraft;
  if (!editingId || !editorDraft) return;
  const isNew = editingId === 'new';
  const candidate = normalizeCitationTemplate({
    id: isNew ? citationTemplateId() : editingId,
    name: editorDraft.name,
    subject: editorDraft.subject,
    sections: editorDraft.sections
  });
  if (!candidate) {
    await showAlert('Enter a template name and subject, and ensure every section has a unique ID, name, and section layout.', { title: 'Incomplete template' });
    return;
  }

  const templates = citationTemplates(state.settings.citationTemplates);
  const duplicate = templates.some((template) => (
    template.id !== candidate.id && template.name.toLowerCase() === candidate.name.toLowerCase()
  ));
  if (duplicate) {
    await showAlert('A citation template with that name already exists.', { title: 'Duplicate template' });
    return;
  }

  const next = isNew
    ? [...templates, candidate]
    : templates.map((template) => (template.id === candidate.id ? candidate : template));
  state.settings.citationTemplates = citationTemplates(next);
  await store.setSetting('settings', state.settings);
  state.editingTemplateId = null;
  state.templateEditorDraft = null;
  renderCitationTemplates();
  showToast(isNew ? `${candidate.name} created.` : `${candidate.name} updated.`);
}

async function removeCitationTemplate(templateId) {
  if (isProtectedCitationTemplateId(templateId)) {
    const protectedTemplate = findCitationTemplate(state.settings.citationTemplates, templateId);
    await showAlert(`The ${protectedTemplate.name} template is always available and cannot be removed.`, { title: 'Built-in template protected' });
    return;
  }
  const template = citationTemplates(state.settings.citationTemplates)
    .find((item) => item.id === templateId);
  if (!template) return;
  const approved = await requestApproval(
    `Remove “${template.name}” from this device? Existing citation ledger entries will not be changed.`,
    { title: 'Remove citation template?', confirmLabel: 'Remove template', tone: 'danger' }
  );
  if (!approved) return;

  state.settings.citationTemplates = citationTemplates(
    state.settings.citationTemplates.filter((item) => item.id !== template.id)
  );
  if (state.settings.citationTemplateId === template.id) {
    state.settings.citationTemplateId = DEFAULT_CITATION_TEMPLATE_ID;
  }
  if (state.editingTemplateId === template.id) state.editingTemplateId = null;
  if (state.editingTemplateId === null) state.templateEditorDraft = null;
  await store.setSetting('settings', state.settings);
  renderCitationTemplates();
  showToast(`${template.name} removed.`);
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
  state.manualCitation = null;
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
  state.manualCitation = null;
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
  state.manualCitation = null;
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
  state.manualCitation = null;
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

function backupFileName(exportedAt) {
  const timestamp = exportedAt.replace(/[:.]/g, '-');
  return `whpd-citation-writer-backup-${timestamp}.json`;
}

async function exportAllData() {
  const approved = await requestApproval(
    'Download an unencrypted backup of every setting, template, combat record, ledger entry, and cache? Authorized characters and EVE SSO credentials are excluded. Keep the file private.',
    { title: 'Export everything?', confirmLabel: 'Download backup' }
  );
  if (!approved) return;

  setWorking('Creating backup');
  try {
    const backup = createBackup(await store.snapshot());
    const json = `${JSON.stringify(backup, null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName(backup.exportedAt);
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const counts = backupCounts(backup);
    showToast(`Backup downloaded: ${counts.killmails} combat records and ${counts.history} ledger entries.`);
  } catch (error) {
    console.error(error);
    await showAlert(`The backup could not be created: ${error.message}`, { title: 'Export failed', tone: 'danger' });
  } finally {
    setWorking('');
  }
}

function resetTransientStateAfterImport() {
  state.statusFilter = 'pending';
  state.search = '';
  state.selectedKillmailId = null;
  state.bundledIncidentIds.clear();
  state.manualCitation = null;
  state.draft = null;
  state.editingTemplateId = null;
  state.templateEditorDraft = null;
}

async function importAllData(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;

  setWorking('Checking backup');
  try {
    const backup = parseBackup(await file.text());
    const counts = backupCounts(backup);
    setWorking('');
    const approved = await requestApproval(
      `Restore the backup from ${formatUtcDateTime(backup.exportedAt)}? It contains ${counts.killmails} combat ${counts.killmails === 1 ? 'record' : 'records'} and ${counts.history} ledger ${counts.history === 1 ? 'entry' : 'entries'}. This will replace every local setting, template, record, ledger entry, and cache, and sign out all authorized characters on this device.`,
      { title: 'Replace all local data?', confirmLabel: 'Restore backup', tone: 'danger' }
    );
    if (!approved) return;

    setWorking('Restoring backup');
    await store.replaceAll(backup.stores);
    resetTransientStateAfterImport();
    await loadState();
    render();
    document.getElementById('settings-status').textContent = `Restored backup from ${formatUtcDateTime(backup.exportedAt)}.`;
    showToast(`Backup restored. Authorize your EVE characters again to resume syncing and sending.`);
  } catch (error) {
    console.error(error);
    await showAlert(`The backup was not imported: ${error.message}`, { title: 'Import failed', tone: 'danger' });
  } finally {
    input.value = '';
    setWorking('');
  }
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
      state.manualCitation = null;
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

    const editCitationTemplateButton = event.target.closest('[data-edit-citation-template]');
    if (editCitationTemplateButton) {
      beginCitationTemplate(editCitationTemplateButton.dataset.editCitationTemplate);
      return;
    }

    const removeCitationTemplateButton = event.target.closest('[data-remove-citation-template]');
    if (removeCitationTemplateButton) {
      await removeCitationTemplate(removeCitationTemplateButton.dataset.removeCitationTemplate);
      return;
    }

    const templateSectionAction = event.target.closest('[data-template-section-action]');
    if (templateSectionAction) {
      await updateCitationTemplateSection(
        templateSectionAction.dataset.templateSectionId,
        templateSectionAction.dataset.templateSectionAction
      );
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'clear-record') return setKillmailStatus('cleared');
    if (action === 'restore-record') return setKillmailStatus('pending');
    if (action === 'retry-zkill') return ensureZkillValues(selectedKillmailGroup()?.records || [selectedKillmail()].filter(Boolean), { force: true });
    if (action === 'resolve-manual-recipient') return resolveManualRecipient();
    if (action === 'cancel-manual-citation') {
      state.manualCitation = null;
      state.draft = null;
      renderDashboard();
      return;
    }
    if (action === 'reset-draft') {
      const killmail = selectedKillmail();
      const group = selectedKillmailGroup() || (killmail ? { primary: killmail, records: [killmail] } : null);
      if (!group) return;
      if (killmail.manualCitation) {
        clearResolvedManualRecipient();
        state.draft = createManualCitationDraft(senderFor(killmail));
      } else {
        state.draft = createCitationDraft(group, senderFor(killmail));
      }
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
      state.manualCitation = null;
      state.draft = null;
      renderDashboard();
      return;
    }

    if (event.target.id === 'citation-template-name' && state.templateEditorDraft) {
      state.templateEditorDraft.name = event.target.value;
      return;
    }

    if (event.target.id === 'citation-template-subject' && state.templateEditorDraft) {
      state.templateEditorDraft.subject = event.target.value;
      return;
    }

    const templateSectionField = event.target.dataset.templateSectionField;
    if (templateSectionField && state.templateEditorDraft) {
      const section = state.templateEditorDraft.sections
        .find((item) => item.id === event.target.dataset.templateSectionId);
      if (section && ['name', 'body', 'defaultValue'].includes(templateSectionField)) {
        section[templateSectionField] = event.target.value;
      }
      return;
    }

    if (!state.draft) return;
    const draftSectionId = event.target.dataset.draftSectionId;
    if (draftSectionId) {
      const value = event.target.dataset.draftSectionEditor === 'list'
        ? event.target.value.split(/\r?\n/).map(cleanCitationText).filter(Boolean).join('\n')
        : cleanCitationText(event.target.value);
      state.draft.sectionValues = { ...(state.draft.sectionValues || {}), [draftSectionId]: value };
      refreshCitationPreview();
      return;
    }
    const field = event.target.dataset.draftField;
    const list = event.target.dataset.draftList;
    if (field) {
      const priorGeneratedSubject = field === 'subject' ? '' : generatedSubjectForDraft(state.draft);
      const shouldRefreshSubject = field !== 'subject' && state.draft.subject === priorGeneratedSubject;
      state.draft[field] = cleanCitationText(event.target.value);
      if (shouldRefreshSubject) {
        state.draft.subject = generatedSubjectForDraft(state.draft);
        const subjectInput = document.querySelector('[data-draft-field="subject"]');
        if (subjectInput) subjectInput.value = state.draft.subject;
      }
      if (field === 'pilotName' && state.manualCitation
        && cleanCitationText(event.target.value).toLowerCase() !== String(state.manualCitation.resolvedName || '').toLowerCase()) {
        clearResolvedManualRecipient();
      }
      refreshCitationPreview();
    }
    if (list) {
      state.draft[list] = event.target.value.split(/\r?\n/).map(cleanCitationText).filter(Boolean);
      refreshCitationPreview();
    }
  });

  document.addEventListener('change', async (event) => {
    const templateSectionField = event.target.dataset.templateSectionField;
    if (templateSectionField && state.templateEditorDraft) {
      const section = state.templateEditorDraft.sections
        .find((item) => item.id === event.target.dataset.templateSectionId);
      if (section) {
        if (templateSectionField === 'optional') section.optional = event.target.checked;
        if (templateSectionField === 'editor') {
          section.editor = ['none', 'text', 'list'].includes(event.target.value) ? event.target.value : 'none';
          if (section.editor === 'none') section.optional = false;
        }
        renderCitationTemplates();
      }
      return;
    }
    if (event.target.matches('[data-incident-select]')) {
      await toggleBundledIncident(event.target.dataset.incidentSelect, event.target.checked);
      return;
    }
    if (event.target.id === 'attacker-type-select' && state.draft) {
      const group = selectedKillmailGroup();
      if (!group) return;
      const attackerType = event.target.value;
      const priorGeneratedSubject = generatedSubjectForDraft(state.draft);
      const shouldRefreshSubject = state.draft.subject === priorGeneratedSubject;
      setDraftAttackerType(state.draft, attackerType, group);
      if (shouldRefreshSubject) state.draft.subject = generatedSubjectForDraft(state.draft);
      if (!group.primary?.manualCitation && (attackerType === 'officer' || attackerType === 'deputy')) {
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
    if (event.target.id === 'citation-template-select' && state.draft) {
      const template = findCitationTemplate(state.settings.citationTemplates, event.target.value);
      state.settings.citationTemplateId = template.id;
      await store.setSetting('settings', state.settings);
      state.draft = applyCitationTemplate(state.draft, template);
      renderComposer();
      showToast(`${template.name} applied.`);
      return;
    }
    if (event.target.matches('[data-offense-id]') && state.draft) {
      const priorGeneratedSubject = generatedSubjectForDraft(state.draft);
      const shouldRefreshSubject = state.draft.subject === priorGeneratedSubject;
      state.draft.offenseIds = [...document.querySelectorAll('[data-offense-id]:checked')]
        .map((input) => input.dataset.offenseId);
      state.draft.activity = activityForOffenses(state.draft.offenseIds, state.settings.customOffenses);
      state.draft.charges = chargesForOffenses(state.draft.offenseIds, state.settings.customOffenses);
      if (shouldRefreshSubject) {
        state.draft.subject = generatedSubjectForDraft(state.draft);
        const subjectInput = document.querySelector('[data-draft-field="subject"]');
        if (subjectInput) subjectInput.value = state.draft.subject;
      }
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
      if (state.manualCitation) {
        state.manualCitation.senderId = sender?.id || null;
        state.manualCitation.finalBlowCharacterId = sender?.id || null;
        state.manualCitation.officerCharacterId = sender?.id || null;
      } else {
        state.settings.specifiedSenderId = sender?.id || '';
      }
      renderComposer();
    }
  });

  document.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter' && event.target.id === 'citation-template-name') {
      event.preventDefault();
      await saveCitationTemplate();
      return;
    }
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
  document.getElementById('new-citation-button').addEventListener('click', beginManualCitation);
  document.getElementById('add-character-button').addEventListener('click', () => beginLogin());
  document.getElementById('welcome-login-button').addEventListener('click', () => beginLogin());
  document.getElementById('settings-add-character-button').addEventListener('click', () => beginLogin());
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('new-citation-template-button').addEventListener('click', () => beginCitationTemplate());
  document.getElementById('add-citation-template-section-button').addEventListener('click', addCitationTemplateSection);
  document.getElementById('cancel-citation-template-button').addEventListener('click', () => {
    state.editingTemplateId = null;
    state.templateEditorDraft = null;
    renderCitationTemplates();
  });
  document.getElementById('save-citation-template-button').addEventListener('click', saveCitationTemplate);
  document.getElementById('add-custom-offense-button').addEventListener('click', addCustomOffense);
  document.getElementById('zkill-import-form').addEventListener('submit', importZkillRecord);
  document.getElementById('export-all-data-button').addEventListener('click', exportAllData);
  document.getElementById('import-all-data-button').addEventListener('click', () => {
    document.getElementById('import-all-data-input').click();
  });
  document.getElementById('import-all-data-input').addEventListener('change', importAllData);
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
