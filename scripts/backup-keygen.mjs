// Creates the backup key pair (npm run backup:keygen [-- --out <file>]).
//
// The PRIVATE key goes into a file outside this project (default: your home
// folder) and is never printed. Keep that file somewhere safe and offline as
// well (a USB stick, a password manager): without it, backups can't be read.
// The PUBLIC key (age1…) is printed: it goes into the GitHub repository
// variable BACKUP_AGE_RECIPIENT. It can only encrypt, never decrypt.
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { parseArgs } from './lib/backup.mjs';

const args = parseArgs(process.argv.slice(2));
const file = resolve(typeof args.out === 'string' ? args.out : join(homedir(), 'fresh-move-backup-key.txt'));
const rel = relative(process.cwd(), file);
// (On Windows, a path on another drive comes back absolute: that's outside.)
const inProject = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
if (inProject) throw new Error(`refusing to write the private key inside the project (${file}): choose a path outside it`);
if (existsSync(file)) throw new Error(`${file} already exists: not overwriting a key (backups made with it need it)`);

const identity = await generateX25519Identity();
const recipient = await identityToRecipient(identity);
await writeFile(file, `# Fresh Move backup key, created ${new Date().toISOString()}\n# public key: ${recipient}\n${identity}\n`, { mode: 0o600 });
console.log(`Private key written to: ${file}`);
console.log('Keep a second copy offline. Without it, backups cannot be read.');
console.log('');
console.log('Public key (put it in GitHub → Settings → Secrets and variables → Actions → Variables → BACKUP_AGE_RECIPIENT):');
console.log(recipient);
