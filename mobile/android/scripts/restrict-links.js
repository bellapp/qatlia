#!/usr/bin/env node
/**
 * Limits the links the Android app opens to the pages that do not sell
 * (spec 2026-11-14, lot 2). Bubblewrap makes the app intercept every
 * qatlia.ma link, so a /credits link received on WhatsApp would open in the
 * app, where buying is hidden. With this retouch it opens in the browser.
 *
 * Android can only allow paths, not exclude one. Bubblewrap has no setting for
 * this: run `node scripts/restrict-links.js` after every `bubblewrap update`.
 */
const fs = require('node:fs');
const path = require('node:path');

const APP_LINK_PATHS = ['/atelier', '/history', '/account', '/panels'];

const FILTER = /(<intent-filter android:autoVerify="true">[\s\S]*?<data android:scheme="https"\s+android:host="@string\/hostName")\s*\/>([\s\S]*?<\/intent-filter>)/;
const PATH_LINE = /\n\s*<data android:pathPrefix="[^"]*"\s*\/>/g;

function restrictLinks(xml) {
  const match = FILTER.exec(xml);
  if (!match) throw new Error('restrict-links: the verified https intent-filter of the launcher activity was not found');
  const indent = '                ';
  const paths = APP_LINK_PATHS.map((p) => `\n${indent}<data android:pathPrefix="${p}" />`).join('');
  const rest = match[2].replace(PATH_LINE, '');
  return xml.replace(FILTER, `${match[1]} />${paths}${rest}`);
}

module.exports = { APP_LINK_PATHS, restrictLinks };

if (require.main === module) {
  const file = path.join(__dirname, '..', 'app', 'src', 'main', 'AndroidManifest.xml');
  fs.writeFileSync(file, restrictLinks(fs.readFileSync(file, 'utf8')));
  console.log(`App links limited to ${APP_LINK_PATHS.join(', ')} in ${path.relative(process.cwd(), file)}`);
}
