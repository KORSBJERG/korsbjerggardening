import {execFileSync} from 'node:child_process';
const scripts=['build-custom','test-custom','test-access','test-attendance','test-commerce','test-front','test-seo','test-pdf-mail','test-cloudflare','test-maps','test-microsoft-login','test-smtp2go'];
for(const script of scripts)execFileSync(process.execPath,['scripts/'+script+'.mjs'],{stdio:'inherit'});
console.log('All Gardening checks passed.');
