'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createJournal}=require('../checkpoint');
test('provisional progress is allowlisted and cannot present lifecycle-only work as a complete outcome',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e2e33-progress-'));t.after(()=>fs.rmSync(dir,{recursive:true}));
 const journal=createJournal(dir,{source:{gitSha:'a'.repeat(40),fingerprint:`sha256:${'b'.repeat(64)}`,dirty:true,token:'PRIVATE_VALUE'}});
 const r={scenarioId:'competent-001',category:'competent',variant:'competent',status:'CONFORMANT',lifecycleStatus:'CONFORMANT',
  rawAnswer:'PRIVATE_VALUE',token:'PRIVATE_VALUE',observed:{privatePrompt:'PRIVATE_VALUE'},marketplace:{status:'CONFORMANT',compactJws:'PRIVATE_VALUE'}};
 journal.write('lifecycle',r);journal.write('final',r);journal.close();
 const text=fs.readFileSync(path.join(dir,'progress.jsonl'),'utf8');assert.ok(!text.includes('PRIVATE_VALUE'));
 const rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(rows[1].scenario.status,'UNMEASURED');assert.equal(rows[1].scenario.lifecycleStatus,'CONFORMANT');
 assert.equal(rows[2].scenario.status,'CONFORMANT');assert.ok(rows.every(r=>r.scope==='PROVISIONAL_NOT_ACCEPTANCE_EVIDENCE'));
});
test('progress never overwrites an earlier run and closes safely on interruption',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e2e33-progress-'));t.after(()=>fs.rmSync(dir,{recursive:true}));
 const j=createJournal(dir);assert.throws(()=>createJournal(dir),/EEXIST/);
 assert.throws(()=>j.write('unknown',{}));j.close();j.close();assert.equal(j.write('lifecycle',{}),false);
 if(process.platform!=='win32')assert.equal(fs.statSync(path.join(dir,'progress.jsonl')).mode&0o777,0o600);
});
