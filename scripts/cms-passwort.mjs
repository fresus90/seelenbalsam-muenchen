#!/usr/bin/env node
/*
 * Erzeugt eine Zeile fuer die Variable CMS_USERS (Admin-Panel-Login).
 *
 *   node scripts/cms-passwort.mjs tamara
 *   node scripts/cms-passwort.mjs tamara "mein sicheres Passwort"
 *
 * Ohne Passwort-Argument wird ein sicheres Passwort erzeugt und angezeigt.
 * Das Passwort selbst wird nirgends gespeichert - nur der Hash wandert
 * nach Cloudflare. Siehe docs/ADMIN-SETUP.md.
 */

// Cloudflare Workers laesst hoechstens 100000 Runden zu.
const ITERATIONS = 100000;

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function wuerfelPasswort(laenge = 20) {
  // Ohne leicht verwechselbare Zeichen (0/O, 1/l/I)
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const grenze = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < laenge) {
    const raw = new Uint8Array(laenge * 2);
    crypto.getRandomValues(raw);
    for (const v of raw) {
      if (out.length >= laenge) break;
      if (v < grenze) out += alphabet[v % alphabet.length];
    }
  }
  return out;
}

async function hash(passwort, salt) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passwort), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256
  );
  return new Uint8Array(bits);
}

const [, , benutzer, passwortArg] = process.argv;

if (!benutzer || benutzer === '--help' || benutzer === '-h') {
  console.log('Aufruf: node scripts/cms-passwort.mjs <benutzername> [passwort]');
  console.log('Ohne Passwort wird eines erzeugt.');
  process.exit(benutzer ? 0 : 1);
}

if (/[:\s]/.test(benutzer)) {
  console.error('Der Benutzername darf keine Leerzeichen und keinen Doppelpunkt enthalten.');
  process.exit(1);
}

const passwort = passwortArg || wuerfelPasswort();
if (passwort.length < 10) {
  console.error('Bitte ein Passwort mit mindestens 10 Zeichen verwenden.');
  process.exit(1);
}

const salt = new Uint8Array(16);
crypto.getRandomValues(salt);
const digest = await hash(passwort, salt);
const zeile = benutzer.toLowerCase() + ':pbkdf2$' + ITERATIONS + '$' + b64url(salt) + '$' + b64url(digest);

console.log('');
console.log('  Benutzername : ' + benutzer.toLowerCase());
console.log('  Passwort     : ' + passwort);
if (!passwortArg) console.log('                 (erzeugt - jetzt notieren, es wird nicht gespeichert)');
console.log('');
console.log('  Diese Zeile in Cloudflare unter CMS_USERS eintragen:');
console.log('');
console.log('  ' + zeile);
console.log('');
