export const POD_PAIR_WINDOW_MS = 15 * 60 * 1000;
export const DEPUTY_CORPORATION_ID = 98653604;

const POD_TYPE_IDS = new Set([670, 33328]);

function killmailTimestamp(killmail) {
  const timestamp = Date.parse(killmail?.killmailTime || killmail?.detail?.killmail_time || '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function victimId(killmail) {
  const id = Number(killmail?.recipientId || killmail?.detail?.victim?.character_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function isPodKillmail(killmail) {
  const typeId = Number(killmail?.detail?.victim?.ship_type_id);
  const shipName = String(killmail?.enriched?.victimShipName || '').trim().toLowerCase();
  return POD_TYPE_IDS.has(typeId) || shipName === 'pod' || shipName.startsWith('capsule');
}

export function selectInvolvedOfficer(attackers, managedCharacterIds) {
  const managed = managedCharacterIds instanceof Set
    ? managedCharacterIds
    : new Set(managedCharacterIds || []);
  const involved = (attackers || []).filter((attacker) => managed.has(Number(attacker.character_id)));
  return involved.find((attacker) => attacker.final_blow)
    || [...involved].sort((left, right) => Number(right.damage_done || 0) - Number(left.damage_done || 0))[0]
    || null;
}

export function countDistinctAttackingPilots(killmails) {
  const characterIds = new Set();
  for (const killmail of killmails || []) {
    for (const attacker of killmail?.detail?.attackers || []) {
      const characterId = Number(attacker?.character_id);
      if (Number.isSafeInteger(characterId) && characterId > 0) characterIds.add(characterId);
    }
  }
  return characterIds.size;
}

export function attackerRoleForFinalBlow(killmail, rememberedRoles = {}) {
  const finalBlow = (killmail?.detail?.attackers || []).find((attacker) => attacker.final_blow) || {};
  const characterId = Number(killmail?.finalBlowCharacterId || finalBlow.character_id);
  const rememberedRole = rememberedRoles?.[String(characterId)];
  if (rememberedRole === 'officer' || rememberedRole === 'deputy') return rememberedRole;
  return Number(finalBlow.corporation_id) === DEPUTY_CORPORATION_ID ? 'deputy' : 'officer';
}

export function classifyKillmail(victimCharacterId, attackers, managedCharacterIds, manuallyImported = false) {
  const managed = managedCharacterIds instanceof Set
    ? managedCharacterIds
    : new Set(managedCharacterIds || []);
  const victimId = Number(victimCharacterId);
  const hasCapsuleerVictim = Number.isSafeInteger(victimId) && victimId > 0;
  if (hasCapsuleerVictim && managed.has(victimId)) {
    return { direction: 'loss', actionable: false };
  }

  const hasManagedAttacker = (attackers || []).some((attacker) => managed.has(Number(attacker.character_id)));
  const direction = hasManagedAttacker || (manuallyImported && hasCapsuleerVictim) ? 'action' : 'assist';
  return { direction, actionable: hasCapsuleerVictim && direction === 'action' };
}

export function groupKillmails(killmails, pairWindowMs = POD_PAIR_WINDOW_MS) {
  const chronological = [...(killmails || [])].sort((left, right) => {
    const timeDifference = (killmailTimestamp(left) ?? 0) - (killmailTimestamp(right) ?? 0);
    if (timeDifference) return timeDifference;
    return Number(isPodKillmail(left)) - Number(isPodKillmail(right));
  });
  const groups = [];
  const latestShipByVictim = new Map();

  for (const killmail of chronological) {
    const recipientId = victimId(killmail);
    const timestamp = killmailTimestamp(killmail);
    const priorGroup = recipientId ? latestShipByVictim.get(recipientId) : null;
    const priorTimestamp = priorGroup ? killmailTimestamp(priorGroup.primary) : null;
    const elapsed = timestamp !== null && priorTimestamp !== null ? timestamp - priorTimestamp : Infinity;

    if (isPodKillmail(killmail) && priorGroup && elapsed >= 0 && elapsed <= pairWindowMs) {
      priorGroup.pod = killmail;
      priorGroup.records.push(killmail);
      priorGroup.latestTime = timestamp;
      priorGroup.highestKillmailId = Math.max(priorGroup.highestKillmailId, Number(killmail.id) || 0);
      latestShipByVictim.delete(recipientId);
      continue;
    }

    const group = {
      id: Number(killmail.id),
      primary: killmail,
      pod: null,
      records: [killmail],
      latestTime: timestamp ?? 0,
      highestKillmailId: Number(killmail.id) || 0
    };
    groups.push(group);

    if (recipientId && !isPodKillmail(killmail)) latestShipByVictim.set(recipientId, group);
  }

  return groups.sort((left, right) => right.highestKillmailId - left.highestKillmailId);
}

export function combineKillmailGroups(groups, preferredGroupId = null) {
  const uniqueGroups = [];
  const seenGroupIds = new Set();
  for (const group of groups || []) {
    const groupId = Number(group?.id);
    if (!Number.isSafeInteger(groupId) || seenGroupIds.has(groupId)) continue;
    seenGroupIds.add(groupId);
    uniqueGroups.push(group);
  }
  if (!uniqueGroups.length) return null;

  const preferred = uniqueGroups.find((group) => Number(group.id) === Number(preferredGroupId)) || uniqueGroups[0];
  const recordIds = new Set();
  const records = uniqueGroups.flatMap((group) => group.records || []).filter((record) => {
    const recordId = Number(record?.id);
    if (!Number.isSafeInteger(recordId) || recordIds.has(recordId)) return false;
    recordIds.add(recordId);
    return true;
  });

  return {
    id: preferred.id,
    primary: preferred.primary,
    pod: uniqueGroups.length === 1 ? preferred.pod : null,
    records,
    latestTime: Math.max(...uniqueGroups.map((group) => Number(group.latestTime) || 0)),
    highestKillmailId: Math.max(...uniqueGroups.map((group) => Number(group.highestKillmailId) || 0)),
    incidentIds: uniqueGroups.map((group) => Number(group.id)),
    incidentCount: uniqueGroups.length,
    isManualBundle: uniqueGroups.length > 1
  };
}
