// Offline preparation only: never uploads customer data or executes SQL.
import {readFile,writeFile} from 'node:fs/promises';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/prepare-state-import.mjs <backup.json> <work/import.sql>');
const backup=JSON.parse(await readFile(input,'utf8'));
if(backup.format!=='korsbjerg-portal-state-v1'||!backup.state||!['gardens','tasks','logs','messages','quotes','tools','notifications'].every(k=>Array.isArray(backup.state[k])))throw Error('Invalid portal backup');
const raw=JSON.stringify(backup.state);if(new TextEncoder().encode(raw).length>500000)throw Error('Backup exceeds current state size limit');
await writeFile(output,"-- Contains private customer data. Do not commit or share.\n-- Fails if the target already has business data; never overwrites.\nINSERT INTO portal_state (id,data,version,updated_at) VALUES ('business','"+raw.replaceAll("'","''")+"',1,"+Date.now()+");\n");
console.log('Prepared offline state import. Review it before applying to an empty target database.');
