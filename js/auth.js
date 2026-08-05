import { WHPDStore } from './db.js';
import { ESIClient } from './esi.js';

if (window.location.hostname === '127.0.0.1') {
  window.location.replace(`http://localhost:${window.location.port}${window.location.pathname}${window.location.search}${window.location.hash}`);
}

async function authorize() {
  const title = document.getElementById('auth-title');
  const message = document.getElementById('auth-message');
  const returnLink = document.getElementById('auth-return');
  const spinner = document.querySelector('.auth-spinner');

  try {
    const store = new WHPDStore();
    const esi = new ESIClient(store);
    const character = await esi.handleAuthorizationCallback();
    title.textContent = 'Authorization complete';
    message.textContent = `${character.name} was added to the WHPD citation desk.`;
    window.location.replace(`/?authorized=${encodeURIComponent(character.name)}`);
  } catch (error) {
    console.error(error);
    title.textContent = 'Authorization failed';
    message.textContent = error?.message || 'EVE SSO could not be completed.';
    spinner.hidden = true;
    returnLink.hidden = false;
  }
}

authorize();
