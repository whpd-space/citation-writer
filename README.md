# WHPD Citation Writer

Create, send, and track Wormhole Police citations from EVE Online combat records.

Open the app at [cw.whpd.space](https://cw.whpd.space).

## Using the citation desk

1. Log in with one or more EVE characters.
2. Select **Sync** to load recent combat records, or add a zKillboard link manually.
3. Select one record or check several records to combine them into one citation.
4. Choose the applicable misdemeanors and felonies.
5. Review the citation, add optional Officer Comments, and send it.
6. Use the Ledger to see which pilots have already received citations.

## Features

- Supports multiple authorized EVE characters.
- Groups a ship kill with the pilot's following pod loss.
- Combines multiple pilots and combat records into one citation.
- Retrieves kill values from zKillboard.
- Includes in-game killmail and zKillboard links.
- Provides the full WHPD Legal Library as an alphabetical checklist.
- Supports your own custom misdemeanors and felonies.
- Provides reusable citation templates with user-defined, ordered sections and composer boxes.
- Lets you restyle or replace the complete EVE Mail body with safe HTML while keeping subjects plain text.
- Keeps WHPD Squizz Standard and WHPD Minimal available as protected built-in templates.
- Supports Officer, Deputy, Fleet, and Memefleet attribution.
- Sends Fleet and Memefleet citation copies to every involved capsuleer attacker.
- Can send from the final-blow character or a designated character.
- Sends live citations to the configured mailing list.
- Provides TEST mode for sending citations only to the involved officers or fleet participants.
- Tracks sent and cleared records in a local ledger.
- Displays all dates and times in UTC.
- Offers dark, light, and system themes with centered or full-width layouts.
- Exports and restores a complete portable backup of settings, templates, combat records, ledger history, and caches without SSO credentials.

## Settings

Settings lets you:

- Choose the EVE Mail sender.
- Change the mailing list ID.
- Enable TEST mode.
- Add or remove custom offenses.
- Change the theme and layout width.
- Export everything to a JSON backup or replace local data from a backup.
- Remove authorized characters or erase all local app data.

## Templates

The Templates tab lets you create, review, edit, and remove citation templates. Each template defines a required plain-text subject format, ordered sections, EVE HTML layout, optionality, and whether it creates a paragraph, bullet-list, or fixed section. Every draft receives a required, editable subject generated from its template. In the composer, the complete generated message body can also be styled or replaced with safe EVE HTML, including fixed template content. WHPD Squizz Standard remains the default, while WHPD Minimal provides a one-line citation with no extra composer boxes. Both built-ins can be edited but cannot be removed.

## Your data

Characters, settings, combat records, and citation history stay in the current browser. Clearing the browser's site data or selecting **Erase all local app data** removes them.

Use **Export everything** in Settings to download all portable local app data. Backup files are unencrypted, but authorized characters and EVE SSO credentials are never included. **Import backup** validates the file, replaces all local data in the current browser, and signs out locally authorized characters; authorize them again after restoring.

Clearing a combat record only removes it from the pending citation queue. It does not delete the EVE killmail.

## License

[Zero-Clause BSD](LICENSE): use it however you want.
